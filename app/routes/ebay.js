'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, readState, mutateState } = require('../lib/db');
const { encrypt, decrypt } = require('../lib/crypto-utils');
const {
    isConfigured: eBayConfigured,
    buildAuthorizationUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
    isApiSyncedEbayEntry,
} = require('../lib/ebay-connector');
const {
    handleDeletionChallenge,
    handleDeletionNotification,
    syncOrders,
} = require('../lib/ebay-handlers');

const router = express.Router();

function getTokenFile(provider) {
    return path.join(DATA_DIR, `tokens-${provider}.json`);
}

function loadTokens(provider) {
    const file = getTokenFile(provider);
    if (!fs.existsSync(file)) return null;
    try {
        const { data: encrypted, lastUpdated } = JSON.parse(
            fs.readFileSync(file, 'utf8'),
        );
        const tokens = JSON.parse(decrypt(encrypted));
        tokens._tokenLastUpdated = lastUpdated;
        return tokens;
    } catch (err) {
        console.error(`[Sync] Unable to read ${provider} tokens:`, err.message);
        return null;
    }
}

function saveTokens(provider, tokens) {
    const { _tokenLastUpdated, ...payload } = tokens;
    const tokenData = {
        lastUpdated: new Date().toISOString(),
        data: encrypt(JSON.stringify(payload)),
    };
    const file = getTokenFile(provider);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tokenData), { mode: 0o600 });
    fs.renameSync(tmp, file);
}

// ─── eBay OAuth ──────────────────────────────────────────────────────────────

// Prefer an explicit EBAY_REDIRECT_URI (required behind any proxy Express
// can't correctly introspect); otherwise derive scheme+host from the
// incoming request itself rather than hardcoding http://localhost — when
// reached through the Caddy HTTPS front door (config/Caddyfile, which sets
// X-Forwarded-Proto on reverse_proxy) with `trust proxy` enabled (see
// server.js), req.protocol correctly reports "https" instead of bypassing
// TLS by hardcoding the app's own plain-HTTP loopback port.
function defaultEbayRedirectUri(req) {
    return (
        process.env.EBAY_REDIRECT_URI ||
        `${req.protocol}://${req.get('host')}/api/sync/ebay/callback`
    );
}

router.get('/ebay/authorize', (req, res) => {
    if (!eBayConfigured()) {
        return res.status(503).json({
            error: 'eBay not configured. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.',
        });
    }
    if (!process.env.SYNC_MASTER_KEY) {
        return res
            .status(503)
            .json({ error: 'SYNC_MASTER_KEY required to store tokens.' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    req.session.eBayOauthState = state;
    const redirectUri = defaultEbayRedirectUri(req);
    const url = buildAuthorizationUrl(redirectUri, state);
    res.redirect(url);
});

router.get('/ebay/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!state || state !== req.session?.eBayOauthState) {
        return res.status(403).json({ error: 'Invalid OAuth state.' });
    }
    delete req.session.eBayOauthState;
    if (!code)
        return res.status(400).json({ error: 'Missing authorization code.' });
    try {
        const redirectUri = defaultEbayRedirectUri(req);
        const tokens = await exchangeCodeForTokens(code, redirectUri);
        saveTokens('ebay', tokens);
        res.json({
            status: 'success',
            message: 'eBay tokens stored securely.',
        });
    } catch (err) {
        console.error('[eBay] Token exchange error:', err);
        res.status(502).json({ error: err.message });
    }
});

router.post('/ebay/refresh', async (req, res) => {
    const tokens = loadTokens('ebay');
    if (!tokens)
        return res.status(401).json({
            error: 'No eBay tokens. Run /api/sync/ebay/authorize first.',
        });
    try {
        const refreshed = await refreshAccessToken(tokens.refresh_token);
        saveTokens('ebay', { ...tokens, ...refreshed });
        res.json({
            status: 'success',
            message: 'eBay access token refreshed.',
        });
    } catch (err) {
        console.error('[eBay] Token refresh error:', err);
        res.status(502).json({ error: err.message });
    }
});

// Toggle whether eBay order sync is allowed to run. Purely a server-side
// gate — connecting via OAuth is a separate step — so a user can leave the
// account linked but pause automatic/manual syncing without revoking tokens.
router.post('/ebay/toggle', async (req, res) => {
    if (!req.body || typeof req.body.enabled !== 'boolean') {
        return res
            .status(400)
            .json({ error: 'enabled (boolean) is required.' });
    }
    const enabled = req.body.enabled;
    const ok = await mutateState((state) => {
        state.ebaySyncEnabled = enabled;
    });
    if (!ok)
        return res.status(500).json({ error: 'Failed to update setting.' });
    res.json({ enabled });
});

router.post('/ebay/sync', async (req, res) => {
    const db = readState();
    if (db.ebaySyncEnabled === false) {
        return res.status(403).json({
            error: 'eBay sync is disabled. Enable it in Settings before syncing.',
        });
    }
    let tokens = loadTokens('ebay');
    if (!tokens)
        return res.status(401).json({
            error: 'No eBay tokens. Run /api/sync/ebay/authorize first.',
        });

    try {
        let entries;
        try {
            const result = await syncOrders(tokens);
            entries = result.entries;
            if (result.refreshed) {
                tokens = result.tokens;
                saveTokens('ebay', tokens);
            }
        } catch (err) {
            if (err.code !== 'ebay_revoked') throw err;
            // Dead grant: drop the stored tokens and the API-synced
            // ledger rows so no eBay user data outlives the authorization.
            // Uploaded report rows and manual entries are the user's own.
            try {
                fs.unlinkSync(getTokenFile('ebay'));
            } catch {
                /* already gone */
            }
            await mutateState((state) => {
                state.sideGigLedger = (state.sideGigLedger || []).filter(
                    (e) => !isApiSyncedEbayEntry(e),
                );
            });
            return res.status(401).json({ error: err.message, code: err.code });
        }
        let added = 0;
        const ok = await mutateState((state) => {
            if (!state.sideGigLedger) state.sideGigLedger = [];
            for (const entry of entries) {
                const exists = state.sideGigLedger.some(
                    (e) => e.id === entry.id,
                );
                if (!exists) {
                    state.sideGigLedger.push(entry);
                    added++;
                }
            }
        });
        if (!ok)
            return res.status(500).json({ error: 'Failed to save orders.' });
        const syncedAt = new Date().toISOString();
        saveTokens('ebay', { ...tokens, lastSyncedAt: syncedAt });
        res.json({
            status: 'success',
            fetched: entries.length,
            added,
            syncedAt,
        });
    } catch (err) {
        console.error('[eBay] Sync error:', err);
        res.status(502).json({ error: err.message });
    }
});

router.get('/ebay/status', (req, res) => {
    const tokens = loadTokens('ebay');
    const db = readState();
    const syncEnabled = db.ebaySyncEnabled !== false;
    if (!tokens) {
        return res.json({ connected: false, syncEnabled });
    }
    res.json({
        connected: true,
        lastSync: tokens.lastSyncedAt || null,
        tokenUpdatedAt: tokens._tokenLastUpdated || null,
        environment: tokens.environment || 'sandbox',
        syncEnabled,
    });
});

// ─── eBay Marketplace Account Deletion / Closure notifications ───────────────
// Required by eBay for any app holding a production sell.* OAuth scope
// (https://developer.ebay.com/marketplace-account-deletion). Two legs:
//   1. GET  — eBay's one-time (and periodic re-)verification handshake: it
//      calls with ?challenge_code=... and expects
//      {challengeResponse: sha256(challengeCode+verificationToken+endpoint)}.
//   2. POST — the actual deletion/closure notification once verified. eBay
//      signs it (X-EBAY-SIGNATURE); the signature is verified over the raw
//      request bytes (req.rawBody, captured by the express.json verify hook
//      in app/server.js) against eBay's public key for the header's kid
//      BEFORE any token/state cleanup. Must ack fast — eBay expects a
//      quick 2xx.
// EBAY_NOTIFICATION_ENDPOINT_URL must exactly match what's registered with
// eBay; falling back to the incoming request's own URL only works for local
// verification since eBay's servers need a real public HTTPS URL to reach
// this endpoint at all (see .env.example).
function marketplaceDeletionEndpointUrl(req) {
    return (
        process.env.EBAY_NOTIFICATION_ENDPOINT_URL ||
        `${req.protocol}://${req.get('host')}/api/sync/ebay/marketplace-account-deletion`
    );
}

router.get('/ebay/marketplace-account-deletion', (req, res) => {
    const { status, body } = handleDeletionChallenge({
        challengeCode: req.query.challenge_code,
        verificationToken: process.env.EBAY_VERIFICATION_TOKEN,
        endpoint: marketplaceDeletionEndpointUrl(req),
        missingConfigStatus: 503,
    });
    res.status(status).json(body);
});

router.post('/ebay/marketplace-account-deletion', async (req, res) => {
    // Only acknowledge once cleanup is complete, so eBay retries otherwise.
    const { status, body } = await handleDeletionNotification({
        rawBody: req.rawBody,
        signatureHeader: req.get('X-EBAY-SIGNATURE'),
        body: req.body,
        purge: async () => {
            try {
                fs.unlinkSync(getTokenFile('ebay'));
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
            }
            const stateOk = await mutateState((state) => {
                state.ebaySyncEnabled = false;
            });
            if (!stateOk) throw new Error('State update failed.');
        },
    });
    res.status(status).json(body);
});

module.exports = router;
