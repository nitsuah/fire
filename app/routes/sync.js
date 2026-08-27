'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jsonata = require('jsonata');
const { DATA_DIR, readState, mutateState } = require('../lib/db');
const { encrypt, decrypt } = require('../lib/crypto-utils');
const { integrateWebhookData } = require('../lib/webhook-integration');
const {
    isConfigured: eBayConfigured,
    buildAuthorizationUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
    fetchCompletedOrders,
    ordersToLedgerEntries,
} = require('../lib/ebay-connector');

const router = express.Router();

const PREFERRED_PORT = parseInt(process.env.PORT) || 3001;
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
    const redirectUri =
        process.env.EBAY_REDIRECT_URI ||
        `http://localhost:${PREFERRED_PORT}/api/sync/ebay/callback`;
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
        const redirectUri =
            process.env.EBAY_REDIRECT_URI ||
            `http://localhost:${PREFERRED_PORT}/api/sync/ebay/callback`;
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

router.post('/ebay/sync', async (req, res) => {
    let tokens = loadTokens('ebay');
    if (!tokens)
        return res.status(401).json({
            error: 'No eBay tokens. Run /api/sync/ebay/authorize first.',
        });

    try {
        let ordersData;
        try {
            ordersData = await fetchCompletedOrders(tokens.access_token);
        } catch (err) {
            if (err.status === 401 || err.status === 403) {
                const refreshed = await refreshAccessToken(
                    tokens.refresh_token,
                );
                tokens = { ...tokens, ...refreshed };
                saveTokens('ebay', tokens);
                ordersData = await fetchCompletedOrders(tokens.access_token);
            } else {
                throw err;
            }
        }

        const entries = ordersToLedgerEntries(ordersData);
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
    if (!tokens) {
        return res.json({ connected: false });
    }
    res.json({
        connected: true,
        lastSync: tokens.lastSyncedAt || null,
        tokenUpdatedAt: tokens._tokenLastUpdated || null,
        environment: tokens.environment || 'sandbox',
    });
});

router.get('/plaid/status', (req, res) => {
    const tokens = loadTokens('plaid');
    if (!tokens?.items?.length) {
        return res.json({ connected: false, itemCount: 0 });
    }
    res.json({
        connected: true,
        itemCount: tokens.items.length,
        lastUpdated: tokens.lastUpdated,
    });
});

// ─── Plaid ───────────────────────────────────────────────────────────────────

function plaidConfigured() {
    return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function plaidHeaders() {
    return {
        'Content-Type': 'application/json',
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
    };
}

function plaidBase() {
    const env = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
    if (env === 'production') return 'https://production.plaid.com';
    if (env === 'development') return 'https://development.plaid.com';
    return 'https://sandbox.plaid.com';
}

router.post('/plaid/create-link-token', async (req, res) => {
    if (!plaidConfigured()) {
        return res.status(503).json({
            error: 'Plaid not configured. Set PLAID_CLIENT_ID and PLAID_SECRET.',
        });
    }
    try {
        const body = {
            user: { client_user_id: 'fire-tracker-user' },
            client_name: 'FIRE Tracker',
            products: ['investments'],
            country_codes: ['US'],
            language: 'en',
        };
        const r = await fetch(`${plaidBase()}/link/token/create`, {
            method: 'POST',
            headers: plaidHeaders(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) {
            const text = await r.text();
            throw new Error(`Plaid link token failed (${r.status}): ${text}`);
        }
        const data = await r.json();
        res.json({ linkToken: data.link_token });
    } catch (err) {
        console.error('[Plaid] create-link-token error:', err);
        res.status(502).json({ error: err.message });
    }
});

router.post('/plaid/exchange', async (req, res) => {
    const { public_token } = req.body;
    if (!public_token)
        return res.status(400).json({ error: 'public_token is required.' });
    if (!plaidConfigured()) {
        return res.status(503).json({ error: 'Plaid not configured.' });
    }
    if (!process.env.SYNC_MASTER_KEY) {
        return res
            .status(503)
            .json({ error: 'SYNC_MASTER_KEY required to store Plaid tokens.' });
    }
    try {
        const r = await fetch(`${plaidBase()}/item/public_token/exchange`, {
            method: 'POST',
            headers: plaidHeaders(),
            body: JSON.stringify({ public_token }),
            signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) {
            const text = await r.text();
            throw new Error(
                `Plaid token exchange failed (${r.status}): ${text}`,
            );
        }
        const { access_token, item_id } = await r.json();
        const existing = loadTokens('plaid') || {};
        const items = existing.items || [];
        const idx = items.findIndex((i) => i.itemId === item_id);
        if (idx >= 0) {
            items[idx] = { itemId: item_id, accessToken: access_token };
        } else {
            items.push({ itemId: item_id, accessToken: access_token });
        }
        saveTokens('plaid', { items });
        res.json({
            status: 'success',
            message: 'Plaid access token stored.',
            itemId: item_id,
        });
    } catch (err) {
        console.error('[Plaid] exchange error:', err);
        res.status(502).json({ error: err.message });
    }
});

router.post('/plaid/positions', async (req, res) => {
    const tokens = loadTokens('plaid');
    if (!tokens?.items?.length) {
        return res.status(401).json({
            error: 'No Plaid tokens. Run /api/sync/plaid/exchange first.',
        });
    }
    const allPositions = [];
    for (const { accessToken } of tokens.items) {
        try {
            const r = await fetch(`${plaidBase()}/investments/holdings/get`, {
                method: 'POST',
                headers: plaidHeaders(),
                body: JSON.stringify({ access_token: accessToken }),
                signal: AbortSignal.timeout(15000),
            });
            if (!r.ok) continue;
            const data = await r.json();
            for (const holding of data.holdings || []) {
                const security = data.securities?.find(
                    (s) => s.security_id === holding.security_id,
                );
                allPositions.push({
                    symbol: security?.ticker_symbol || holding.security_id,
                    description: security?.name || '',
                    quantity: holding.quantity,
                    value: holding.institution_value,
                    costBasis: holding.cost_basis,
                    source: 'plaid',
                });
            }
        } catch (err) {
            console.error('[Plaid] holdings fetch error:', err);
        }
    }
    const ok = await mutateState((state) => {
        const nonPlaid = (state.importedPositions || []).filter(
            (p) => p.source !== 'plaid',
        );
        state.importedPositions = [...nonPlaid, ...allPositions];
    });
    if (!ok)
        return res.status(500).json({ error: 'Failed to save positions.' });
    res.json({ status: 'success', positionCount: allPositions.length });
});

router.post('/plaid/accounts', async (req, res) => {
    const tokens = loadTokens('plaid');
    if (!tokens?.items?.length) {
        return res.status(401).json({
            error: 'No Plaid tokens. Run /api/sync/plaid/exchange first.',
        });
    }
    const accounts = [];
    const failedItems = [];
    for (const { accessToken } of tokens.items) {
        try {
            const r = await fetch(`${plaidBase()}/accounts/balance/get`, {
                method: 'POST',
                headers: plaidHeaders(),
                body: JSON.stringify({ access_token: accessToken }),
                signal: AbortSignal.timeout(15000),
            });
            if (!r.ok) {
                failedItems.push(r.status);
                continue;
            }
            const data = await r.json();
            for (const acc of data.accounts || []) {
                accounts.push({
                    id: `plaid-${acc.account_id}`,
                    name: acc.name,
                    type:
                        acc.type === 'depository'
                            ? 'Cash'
                            : acc.type === 'investment'
                              ? 'Brokerage'
                              : 'Other',
                    value: acc.balances?.current ?? 0,
                    source: 'plaid',
                });
            }
        } catch (err) {
            console.error('[Plaid] accounts fetch error:', err);
            failedItems.push(err.message);
        }
    }
    if (failedItems.length > 0 && accounts.length === 0) {
        return res.status(502).json({
            error: 'All Plaid account fetches failed. Existing data preserved.',
            failedCount: failedItems.length,
        });
    }
    const ok = await mutateState((state) => {
        const nonPlaid = (state.customAccounts || []).filter(
            (a) => a.source !== 'plaid',
        );
        state.customAccounts = [...nonPlaid, ...accounts];
    });
    if (!ok) return res.status(500).json({ error: 'Failed to save accounts.' });
    const accountsResponse = {
        status: 'success',
        accountCount: accounts.length,
    };
    if (failedItems.length > 0) {
        accountsResponse.warning = `${failedItems.length} item(s) failed; partial data saved.`;
    }
    res.json(accountsResponse);
});

// ─── Webhook templates ────────────────────────────────────────────────────────

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

module.exports = router;
