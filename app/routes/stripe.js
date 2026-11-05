'use strict';

const express = require('express');
const fs = require('fs');
const { mutateState } = require('../lib/db');
const stripe = require('../lib/stripe-connector');
const { getTokenFile, loadTokens, saveTokens } = require('../lib/token-store');

const router = express.Router();
const MAX_SECRET_BYTES = 1024;
const RESTRICTED_KEY_RE = /^rk_(?:test|live)_[A-Za-z0-9]+$/;
const WEBHOOK_SECRET_RE = /^whsec_[A-Za-z0-9]+$/;
const ALLOWED_CREDENTIAL_FIELDS = new Set([
    'restrictedKey',
    'webhookSigningSecret',
]);

function masterKeyConfigured() {
    return (
        typeof process.env.SYNC_MASTER_KEY === 'string' &&
        /^[0-9a-fA-F]{64}$/.test(process.env.SYNC_MASTER_KEY)
    );
}

function noStore(res) {
    res.set('Cache-Control', 'no-store');
}

const STRIPE_SYNC_ERROR_CODES = new Set([
    'unauthorized',
    'rate_limited',
    'provider_error',
]);

function stripeCredentialsMatch(current, snapshot) {
    return (
        current &&
        current.restrictedKey === snapshot.restrictedKey &&
        current.webhookSigningSecret === snapshot.webhookSigningSecret
    );
}

function saveStripeSyncTokensIfCurrent(snapshot, updates) {
    const current = loadTokens('stripe');
    if (!stripeCredentialsMatch(current, snapshot)) return false;
    saveTokens('stripe', { ...current, ...updates });
    return true;
}

function connectionChangedResponse(res) {
    return res.status(409).json({
        error: 'Stripe connection changed during sync. Retry.',
        code: 'connection_changed',
    });
}

function recordStripeStorageFailure(tokens, at, fetched, skipped) {
    return saveStripeSyncTokensIfCurrent(tokens, {
        lastSyncOutcome: {
            at,
            ok: false,
            partial: false,
            fetched,
            added: 0,
            skipped,
            errorCode: 'storage_error',
        },
    });
}

function stripeStatus() {
    const configured = masterKeyConfigured();
    if (!configured) {
        return {
            configured: false,
            connected: false,
            webhookConfigured: false,
            lastUpdated: null,
            lastSyncedAt: null,
            lastSyncOutcome: null,
        };
    }

    const tokens = loadTokens('stripe');
    const connected =
        typeof tokens?.restrictedKey === 'string' &&
        RESTRICTED_KEY_RE.test(tokens.restrictedKey);
    const webhookConfigured =
        typeof tokens?.webhookSigningSecret === 'string' &&
        WEBHOOK_SECRET_RE.test(tokens.webhookSigningSecret);

    return {
        configured,
        connected,
        webhookConfigured,
        lastUpdated: tokens?._tokenLastUpdated || null,
        lastSyncedAt: tokens?.lastSyncedAt || null,
        lastSyncOutcome: tokens?.lastSyncOutcome || null,
    };
}

function invalidSecret(value, pattern) {
    return (
        typeof value !== 'string' ||
        !value.trim() ||
        Buffer.byteLength(value.trim(), 'utf8') > MAX_SECRET_BYTES ||
        !pattern.test(value.trim())
    );
}

router.get('/stripe/status', (req, res) => {
    noStore(res);
    return res.json(stripeStatus());
});

router.post('/stripe/credentials', (req, res) => {
    noStore(res);

    if (!masterKeyConfigured()) {
        return res.status(503).json({
            error: 'SYNC_MASTER_KEY must be configured to store Stripe credentials.',
        });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res
            .status(400)
            .json({ error: 'Invalid Stripe credentials payload.' });
    }
    if (Object.keys(body).some((key) => !ALLOWED_CREDENTIAL_FIELDS.has(key))) {
        return res
            .status(400)
            .json({ error: 'Unexpected Stripe credentials field.' });
    }
    if (invalidSecret(body.restrictedKey, RESTRICTED_KEY_RE)) {
        return res.status(400).json({
            error: 'restrictedKey must be a valid restricted Stripe key.',
        });
    }

    const hasWebhookSecret = Object.prototype.hasOwnProperty.call(
        body,
        'webhookSigningSecret',
    );
    let webhookSigningSecret;
    if (hasWebhookSecret) {
        if (invalidSecret(body.webhookSigningSecret, WEBHOOK_SECRET_RE)) {
            return res.status(400).json({
                error: 'webhookSigningSecret must be a valid Stripe webhook secret.',
            });
        }
        webhookSigningSecret = body.webhookSigningSecret.trim();
    }

    const tokenFile = getTokenFile('stripe');
    const fileExists = fs.existsSync(tokenFile);
    const existing = loadTokens('stripe');
    if (fileExists && !existing) {
        return res.status(500).json({
            error: 'Stored Stripe credentials could not be read; refusing to overwrite them.',
        });
    }
    if (existing) {
        const existingKeyValid =
            typeof existing.restrictedKey === 'string' &&
            RESTRICTED_KEY_RE.test(existing.restrictedKey);
        const existingWebhookValid =
            existing.webhookSigningSecret == null ||
            (typeof existing.webhookSigningSecret === 'string' &&
                WEBHOOK_SECRET_RE.test(existing.webhookSigningSecret));
        if (!existingKeyValid || !existingWebhookValid) {
            return res.status(500).json({
                error: 'Stored Stripe credentials are invalid; refusing to overwrite them.',
            });
        }
    }

    const restrictedKey = body.restrictedKey.trim();
    const sameKey = existing?.restrictedKey === restrictedKey;
    const tokens = {
        restrictedKey,
        ...(hasWebhookSecret
            ? { webhookSigningSecret }
            : existing?.webhookSigningSecret
              ? { webhookSigningSecret: existing.webhookSigningSecret }
              : {}),
        configuredAt:
            sameKey && typeof existing.configuredAt === 'string'
                ? existing.configuredAt
                : new Date().toISOString(),
        ...(sameKey
            ? {
                  lastSyncedAt: existing.lastSyncedAt,
                  resumeFrom: existing.resumeFrom,
                  lastSyncOutcome: existing.lastSyncOutcome,
              }
            : {}),
    };

    try {
        saveTokens('stripe', tokens);
    } catch {
        return res.status(500).json({
            error: 'Failed to store Stripe credentials securely.',
        });
    }

    return res.json(stripeStatus());
});

router.post('/stripe/sync', async (req, res) => {
    noStore(res);

    if (!masterKeyConfigured()) {
        return res.status(503).json({
            error: 'SYNC_MASTER_KEY must be configured to sync Stripe.',
        });
    }

    const tokens = loadTokens('stripe');
    if (
        typeof tokens?.restrictedKey !== 'string' ||
        !RESTRICTED_KEY_RE.test(tokens.restrictedKey)
    ) {
        return res.status(401).json({
            error: 'Stripe is not connected. Connect Stripe first.',
        });
    }

    let result;
    try {
        result = await stripe.fetchBalanceTransactions({
            key: tokens.restrictedKey,
            cursor:
                typeof tokens.resumeFrom === 'string'
                    ? tokens.resumeFrom
                    : null,
        });
    } catch {
        result = { error: 'provider_error' };
    }

    const errorCode = result?.error
        ? STRIPE_SYNC_ERROR_CODES.has(result.error)
            ? result.error
            : 'provider_error'
        : !Array.isArray(result?.entries)
          ? 'provider_error'
          : null;
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    const skipped = Array.isArray(result?.skipped) ? result.skipped.length : 0;
    const partial =
        result?.partial === true || Boolean(errorCode && entries.length > 0);
    const at = new Date().toISOString();

    if (errorCode && entries.length === 0 && !partial) {
        const outcome = {
            at,
            ok: false,
            partial: false,
            fetched: 0,
            added: 0,
            skipped,
            errorCode,
        };
        try {
            if (
                !saveStripeSyncTokensIfCurrent(tokens, {
                    lastSyncOutcome: outcome,
                })
            ) {
                return connectionChangedResponse(res);
            }
        } catch {
            return res.status(500).json({
                error: 'Failed to record Stripe sync outcome.',
            });
        }

        const status = {
            unauthorized: 401,
            rate_limited: 429,
            provider_error: 502,
        }[errorCode];
        return res
            .status(status || 502)
            .json({ error: 'Stripe sync failed.', code: errorCode });
    }

    let added = 0;
    let writeOk;
    try {
        writeOk = await mutateState((state) => {
            if (!stripeCredentialsMatch(loadTokens('stripe'), tokens)) {
                const error = new Error(
                    'Stripe connection changed during sync.',
                );
                error.code = 'stripe_connection_changed';
                throw error;
            }
            if (state.sideGigLedger == null) state.sideGigLedger = [];
            if (!Array.isArray(state.sideGigLedger)) {
                throw new Error('Invalid side-gig ledger.');
            }
            const ids = new Set(
                state.sideGigLedger
                    .map((entry) => entry?.id)
                    .filter((id) => typeof id === 'string'),
            );
            for (const entry of entries) {
                if (
                    !entry ||
                    typeof entry.id !== 'string' ||
                    !entry.id.startsWith('stripe-txn_') ||
                    entry.platform !== 'Stripe'
                ) {
                    throw new Error('Invalid mapped Stripe entry.');
                }
                if (ids.has(entry.id)) continue;
                state.sideGigLedger.push(entry);
                ids.add(entry.id);
                added++;
            }
            if (added > 0) {
                const currentRevision = Number.isInteger(state.stateRevision)
                    ? state.stateRevision
                    : 0;
                state.stateRevision = currentRevision + 1;
            }
        });
    } catch (error) {
        if (error?.code === 'stripe_connection_changed') {
            return connectionChangedResponse(res);
        }
        try {
            if (!recordStripeStorageFailure(tokens, at, entries.length, skipped)) {
                return connectionChangedResponse(res);
            }
        } catch {
            return res.status(500).json({
                error: 'Failed to record Stripe sync outcome.',
            });
        }
        return res.status(500).json({
            error: 'Failed to save Stripe transactions.',
            code: 'storage_error',
        });
    }
    if (!writeOk) {
        try {
            if (!recordStripeStorageFailure(tokens, at, entries.length, skipped)) {
                return connectionChangedResponse(res);
            }
        } catch {
            return res.status(500).json({
                error: 'Failed to record Stripe sync outcome.',
            });
        }
        return res.status(500).json({
            error: 'Failed to save Stripe transactions.',
            code: 'storage_error',
        });
    }

    const complete = !partial && !errorCode;
    const outcome = {
        at,
        ok: complete,
        partial,
        fetched: entries.length,
        added,
        skipped,
        errorCode,
    };
    const resumeFrom = partial
        ? typeof result.nextCursor === 'string' && result.nextCursor
            ? result.nextCursor
            : tokens.resumeFrom
        : undefined;

    try {
        if (
            !saveStripeSyncTokensIfCurrent(tokens, {
                ...(complete ? { lastSyncedAt: at } : {}),
                resumeFrom,
                lastSyncOutcome: outcome,
            })
        ) {
            return connectionChangedResponse(res);
        }
    } catch {
        return res.status(500).json({
            error: 'Failed to record Stripe sync outcome.',
        });
    }

    return res.status(complete ? 200 : 206).json({
        status: complete ? 'success' : 'partial',
        fetched: entries.length,
        added,
        skipped,
        syncedAt: at,
        partial,
        errorCode,
    });
});

router.delete('/stripe/disconnect', (req, res) => {
    noStore(res);

    try {
        fs.unlinkSync(getTokenFile('stripe'));
    } catch (err) {
        if (err.code !== 'ENOENT') {
            return res.status(500).json({
                error: 'Failed to delete local Stripe credentials.',
            });
        }
    }

    return res.json(stripeStatus());
});

module.exports = router;
