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

function safeLastSyncOutcome(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof value.at !== 'string' ||
        !Number.isFinite(Date.parse(value.at)) ||
        typeof value.ok !== 'boolean'
    ) {
        return null;
    }
    const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);
    return {
        at: value.at,
        ok: value.ok,
        partial: value.partial === true,
        fetched: count(value.fetched),
        added: count(value.added),
        skipped: count(value.skipped),
        errorCode: STRIPE_SYNC_ERROR_CODES.has(value.errorCode)
            ? value.errorCode
            : null,
    };
}

function safeTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
        ? value
        : null;
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
        lastSyncedAt: safeTimestamp(tokens?.lastSyncedAt),
        lastSyncOutcome: safeLastSyncOutcome(tokens?.lastSyncOutcome),
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

    const tokens = {
        restrictedKey: body.restrictedKey.trim(),
        ...(hasWebhookSecret
            ? { webhookSigningSecret }
            : existing?.webhookSigningSecret
              ? { webhookSigningSecret: existing.webhookSigningSecret }
              : {}),
        configuredAt: new Date().toISOString(),
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

    const errorCode = STRIPE_SYNC_ERROR_CODES.has(result?.error)
        ? result.error
        : !Array.isArray(result?.entries)
          ? 'provider_error'
          : null;
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    const skipped = Array.isArray(result?.skipped)
        ? result.skipped.length
        : 0;
    const partial =
        result?.partial === true || Boolean(errorCode && entries.length > 0);
    const at = new Date().toISOString();

    if (errorCode && entries.length === 0) {
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
            saveTokens('stripe', { ...tokens, lastSyncOutcome: outcome });
        } catch {
            return res.status(500).json({
                error: 'Failed to record Stripe sync outcome.',
            });
        }

        const status =
            errorCode === 'unauthorized'
                ? 401
                : errorCode === 'rate_limited'
                  ? 429
                  : 502;
        const message =
            errorCode === 'unauthorized'
                ? 'Stripe authorization failed. Reconnect Stripe and try again.'
                : errorCode === 'rate_limited'
                  ? 'Stripe rate limit reached. Try again later.'
                  : 'Stripe sync failed.';
        return res.status(status).json({ error: message, code: errorCode });
    }

    let added = 0;
    let writeOk;
    try {
        writeOk = await mutateState((state) => {
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
        });
    } catch {
        return res.status(500).json({
            error: 'Failed to save Stripe transactions.',
        });
    }
    if (!writeOk) {
        return res.status(500).json({
            error: 'Failed to save Stripe transactions.',
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
        saveTokens('stripe', {
            ...tokens,
            ...(complete ? { lastSyncedAt: at } : {}),
            resumeFrom,
            lastSyncOutcome: outcome,
        });
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
