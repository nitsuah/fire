'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const jsonata = require('jsonata');
const { DATA_DIR, readState, mutateState } = require('../lib/db');
const { encrypt, decrypt } = require('../lib/crypto-utils');
const { integrateWebhookData } = require('../lib/webhook-integration');
const router = express.Router();
const ebayRouter = require('./ebay');
const plaidRouter = require('./plaid');
const SUPPORTED_WEBHOOK_TYPES = [
    'accounts',
    'cds',
    'positions',
    'expenses',
    'sideGigLedger',
    'importedFiles',
    'taxRate',
    'projectionSettings',
];

const WEBHOOK_FIELD_SCHEMAS = {
    accounts: { required: ['name', 'type', 'value'], optional: ['apy', 'id'] },
    cds: {
        required: ['bank', 'principal', 'rate', 'maturity'],
        optional: ['id'],
    },
    positions: {
        required: ['symbol', 'value'],
        optional: ['quantity', 'costBasis', 'description', 'id'],
    },
    expenses: {
        required: [],
        optional: [
            'housing',
            'utilities',
            'food',
            'transport',
            'healthcare',
            'discretionary',
        ],
    },
    sideGigLedger: {
        required: ['platform', 'gross', 'net'],
        optional: ['date', 'description', 'fees', 'id'],
    },
    importedFiles: { required: ['name'], optional: ['date', 'id'] },
    taxRate: { required: [], optional: [] },
    projectionSettings: {
        required: [],
        optional: [
            'annualSavings',
            'expectedReturn',
            'inflationRate',
            'swr',
            'spanYears',
            'currentAge',
            'retireAge',
        ],
    },
};

function omitSecret(template) {
    const cleaned = { ...template };
    delete cleaned.secret;
    return cleaned;
}

function validateWebhookPayload(type, data) {
    const schema = WEBHOOK_FIELD_SCHEMAS[type];
    if (!schema) return null;
    if (schema.required.length === 0) return null;
    const items = Array.isArray(data) ? data : [data];
    for (const payload of items) {
        if (!payload || typeof payload !== 'object') continue;
        for (const field of schema.required) {
            if (!(field in payload)) {
                return `Missing required field: ${field}`;
            }
        }
    }
    return null;
}

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
    // eslint-disable-next-line no-unused-vars
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

router.post('/templates', async (req, res) => {
    if (!SUPPORTED_WEBHOOK_TYPES.includes(req.body.type)) {
        return res.status(400).json({
            error: `Unsupported type. Must be one of: ${SUPPORTED_WEBHOOK_TYPES.join(', ')}.`,
        });
    }
    if (req.body.mapping !== undefined && req.body.mapping !== null) {
        if (typeof req.body.mapping !== 'string') {
            return res
                .status(400)
                .json({ error: 'Invalid mapping: must be a string.' });
        }
        try {
            jsonata(req.body.mapping);
        } catch {
            return res
                .status(400)
                .json({ error: 'Invalid JSONata mapping expression.' });
        }
    }
    const newTemplate = {
        id: crypto.randomBytes(8).toString('hex'),
        name: req.body.name,
        source: req.body.source,
        type: req.body.type,
        mapping: req.body.mapping,
        secret: req.body.secret || null,
        createdAt: new Date().toISOString(),
    };
    const ok = await mutateState((state) => {
        if (!state.webhookTemplates) state.webhookTemplates = [];
        state.webhookTemplates.push(newTemplate);
    });
    if (ok) {
        res.status(201).json(omitSecret(newTemplate));
    } else {
        res.status(500).json({ error: 'Failed to save webhook template.' });
    }
});

router.get('/templates', (req, res) => {
    const db = readState();
    res.json((db.webhookTemplates || []).map(omitSecret));
});

router.put('/templates/:id', async (req, res) => {
    if (req.body.mapping !== undefined && req.body.mapping !== null) {
        if (typeof req.body.mapping !== 'string') {
            return res
                .status(400)
                .json({ error: 'Invalid mapping: must be a string.' });
        }
        try {
            jsonata(req.body.mapping);
        } catch {
            return res
                .status(400)
                .json({ error: 'Invalid JSONata mapping expression.' });
        }
    }
    let notFound = false;
    let updated = null;
    const ok = await mutateState((state) => {
        const idx = (state.webhookTemplates || []).findIndex(
            (t) => t.id === req.params.id,
        );
        if (idx === -1) {
            notFound = true;
            return;
        }
        const cur = state.webhookTemplates[idx];
        state.webhookTemplates[idx] = {
            ...cur,
            name: req.body.name || cur.name,
            source: req.body.source || cur.source,
            type: req.body.type || cur.type,
            mapping: req.body.mapping || cur.mapping,
            secret: req.body.secret || cur.secret,
        };
        updated = state.webhookTemplates[idx];
    });
    if (notFound)
        return res.status(404).json({ error: 'Webhook template not found.' });
    if (ok) {
        res.json(omitSecret(updated));
    } else {
        res.status(500).json({ error: 'Failed to update webhook template.' });
    }
});

router.delete('/templates/:id', async (req, res) => {
    let notFound = false;
    const ok = await mutateState((state) => {
        const before = (state.webhookTemplates || []).length;
        state.webhookTemplates = (state.webhookTemplates || []).filter(
            (t) => t.id !== req.params.id,
        );
        if (state.webhookTemplates.length === before) notFound = true;
    });
    if (notFound)
        return res.status(404).json({ error: 'Webhook template not found.' });
    if (ok) {
        res.json({ message: 'Webhook template successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete webhook template.' });
    }
});

// ─── Webhook receiver ─────────────────────────────────────────────────────────

const WEBHOOK_MAX_BYTES = 16 * 1024; // 16KB

router.post('/webhook/:templateId', async (req, res) => {
    if (req.rawBody && req.rawBody.length > WEBHOOK_MAX_BYTES) {
        return res
            .status(413)
            .json({ error: 'Webhook payload too large (max 16KB).' });
    }
    const db = readState();
    const template = db.webhookTemplates.find(
        (t) => t.id === req.params.templateId,
    );
    if (!template) {
        return res.status(404).json({ error: 'Webhook template not found.' });
    }

    if (template.secret) {
        const signature = req.headers['x-webhook-signature'];
        if (!signature) {
            return res
                .status(401)
                .json({ error: 'Missing webhook signature.' });
        }
        if (!req.rawBody) {
            return res.status(400).json({
                error: 'Missing raw request body for signature verification.',
            });
        }
        const hmac = crypto.createHmac('sha256', template.secret);
        const digest = hmac.update(req.rawBody).digest('hex');
        const expected = Buffer.from(`sha256=${digest}`);
        const actual = Buffer.from(signature);
        if (
            actual.length !== expected.length ||
            !crypto.timingSafeEqual(actual, expected)
        ) {
            return res
                .status(403)
                .json({ error: 'Invalid webhook signature.' });
        }
    }

    let transformedData = {};
    try {
        if (template.mapping && typeof template.mapping === 'string') {
            const expression = jsonata(template.mapping);
            let timeoutHandle;
            transformedData = await Promise.race([
                expression.evaluate(req.body),
                new Promise((_, reject) => {
                    timeoutHandle = setTimeout(
                        () => reject(new Error('JSONata evaluation timed out')),
                        5000,
                    );
                }),
            ]).finally(() => clearTimeout(timeoutHandle));
        } else {
            transformedData = req.body;
        }
    } catch (e) {
        console.error('[Webhook] Mapping error:', e);
        return res.status(400).json({
            error: 'Error processing webhook data.',
            details: e.message,
        });
    }

    const validationError = validateWebhookPayload(
        template.type,
        transformedData,
    );
    if (validationError) {
        return res.status(400).json({
            error: `Webhook payload validation failed: ${validationError}`,
        });
    }

    let integrationSuccess = false;
    const saved = await mutateState((state) => {
        integrationSuccess = integrateWebhookData(
            state,
            template.type,
            transformedData,
        );
    });
    if (integrationSuccess && saved) {
        console.log(
            `[Webhook] Integrated type=${template.type} template=${template.name}`,
        );
        res.json({
            status: 'success',
            message: `Webhook data for ${template.type} integrated successfully.`,
        });
    } else {
        res.status(500).json({ error: 'Failed to integrate webhook data.' });
    }
});

router.use(ebayRouter);
router.use(plaidRouter);

module.exports = router;
