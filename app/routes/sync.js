'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jsonata = require('jsonata');
const { DATA_DIR, readState, mutateState } = require('../lib/db');
const { encrypt, decrypt } = require('../lib/crypto-utils');
const { integrateWebhookData } = require('../lib/webhook-integration');
const { parsePlaidTransactions } = require('../lib/finance-parsing');
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

router.get('/plaid/status', (req, res) => {
    const tokens = loadTokens('plaid');
    const db = readState();
    const syncEnabled = db.plaidSyncEnabled !== false;
    if (!tokens?.items?.length) {
        return res.json({ connected: false, itemCount: 0, syncEnabled });
    }
    res.json({
        connected: true,
        itemCount: tokens.items.length,
        lastUpdated: tokens.lastUpdated,
        lastTransactionsSync: tokens.transactionsLastSyncedAt || null,
        syncEnabled,
    });
});

// Toggle whether Plaid transaction sync is allowed to run. Mirrors
// /ebay/toggle: a server-side gate independent of the Link/exchange flow,
// so a user can leave accounts linked but pause automatic/manual
// transaction syncing without unlinking. The Fidelity CSV import UI also
// reads this (via /plaid/status) to disable itself while Plaid sync is
// active, so the two importers can't double-count the same expenses.
router.post('/plaid/toggle', async (req, res) => {
    if (!req.body || typeof req.body.enabled !== 'boolean') {
        return res
            .status(400)
            .json({ error: 'enabled (boolean) is required.' });
    }
    const enabled = req.body.enabled;
    const ok = await mutateState((state) => {
        state.plaidSyncEnabled = enabled;
    });
    if (!ok)
        return res.status(500).json({ error: 'Failed to update setting.' });
    res.json({ enabled });
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

// Pulls new/updated transactions for every linked Plaid item via
// /transactions/sync (Plaid's current recommended endpoint — cursor-based,
// so repeat calls only fetch what's changed since the last one) and
// parses them into this app's existing expense-category schema via
// parsePlaidTransactions (app/lib/finance-parsing.js), reusing the same
// categorization pipeline and `state.spendingTransactions` store that the
// Fidelity/Chase/Capital One CSV importer feeds — see that disabled-import
// gate below and PLAID_CATEGORY_MAP in finance-parsing.js for the mapping.
router.post('/plaid/transactions', async (req, res) => {
    const db = readState();
    if (db.plaidSyncEnabled === false) {
        return res.status(403).json({
            error: 'Plaid sync is disabled. Enable it in Settings before syncing.',
        });
    }
    const tokens = loadTokens('plaid');
    if (!tokens?.items?.length) {
        return res.status(401).json({
            error: 'No Plaid tokens. Run /api/sync/plaid/exchange first.',
        });
    }

    const allAdded = [];
    const allModified = [];
    const allRemovedIds = [];
    const updatedItems = [];
    const failedItems = [];
    let successfulItemCount = 0;
    for (const item of tokens.items) {
        // Collected per-item so a failure (including the page-cap case
        // below) can be discarded without contaminating other items'
        // already-confirmed-complete batches.
        const itemAdded = [];
        const itemModified = [];
        const itemRemovedIds = [];
        try {
            const originalCursor = item.transactionsCursor || undefined;
            let cursor = originalCursor;
            let hasMore = true;
            let itemFailed = false;
            let page = 0;
            // Plaid paginates /transactions/sync via has_more/next_cursor;
            // bound the loop defensively so a misbehaving response can't
            // spin forever.
            for (; hasMore && page < 20; page++) {
                const r = await fetch(`${plaidBase()}/transactions/sync`, {
                    method: 'POST',
                    headers: plaidHeaders(),
                    body: JSON.stringify({
                        access_token: item.accessToken,
                        cursor,
                        count: 500,
                    }),
                    signal: AbortSignal.timeout(15000),
                });
                if (!r.ok) {
                    failedItems.push(r.status);
                    itemFailed = true;
                    break;
                }
                const data = await r.json();
                itemAdded.push(...(data.added || []));
                itemModified.push(...(data.modified || []));
                itemRemovedIds.push(
                    ...(data.removed || []).map((r2) => r2.transaction_id),
                );
                cursor = data.next_cursor || cursor;
                hasMore = Boolean(data.has_more);
            }
            if (!itemFailed && hasMore) {
                // Exhausted the page cap without Plaid ever reporting
                // has_more: false -- pagination is incomplete, not merely
                // slow. Per Plaid's own guidance, an interrupted sync must
                // restart from the *original* cursor, not resume from
                // wherever we stopped (resuming could skip transactions
                // between the two). Discard this item's batch entirely and
                // keep its original cursor so the next sync starts over.
                itemFailed = true;
                failedItems.push('page_limit_exceeded');
            }
            if (itemFailed) {
                updatedItems.push(item);
            } else {
                allAdded.push(...itemAdded);
                allModified.push(...itemModified);
                allRemovedIds.push(...itemRemovedIds);
                updatedItems.push({ ...item, transactionsCursor: cursor });
                successfulItemCount++;
            }
        } catch (err) {
            console.error('[Plaid] transactions fetch error:', err);
            failedItems.push(err.message);
            updatedItems.push(item);
        }
    }

    // A total failure is "no item's pagination completed", not "no new
    // transactions" -- an item can legitimately complete with zero
    // additions (nothing changed since the last sync). Bailing out on an
    // empty batch would wrongly report a fully-successful, no-op item as
    // "all failed" and skip saving its advanced cursor, forcing it to
    // needlessly re-fetch the same already-confirmed-empty pages forever.
    if (failedItems.length > 0 && successfulItemCount === 0) {
        return res.status(502).json({
            error: 'All Plaid transaction fetches failed. Existing data preserved.',
            failedCount: failedItems.length,
        });
    }

    // /transactions/sync reports three kinds of change, all of which must
    // be applied before the cursor advances past them (Plaid: "apply all
    // updates from these three arrays in order") -- added and modified
    // transactions upsert into state.spendingTransactions; removed
    // transactions (and any modified transaction that no longer qualifies
    // as a trackable expense -- e.g. reverted to pending, or refunded to a
    // non-positive amount) are deleted from it.
    const parsedAdded = parsePlaidTransactions(allAdded);
    const parsedModified = parsePlaidTransactions(allModified);
    const parsedModifiedIds = new Set(parsedModified.map((t) => t.id));
    const droppedModifiedIds = allModified
        .map((t) => `plaid-${t.transaction_id}`)
        .filter((id) => !parsedModifiedIds.has(id));
    const removedIds = new Set([
        ...allRemovedIds.map((id) => `plaid-${id}`),
        ...droppedModifiedIds,
    ]);

    let added = 0;
    let modified = 0;
    let removed = 0;
    const ok = await mutateState((state) => {
        if (!state.spendingTransactions) state.spendingTransactions = [];
        if (removedIds.size > 0) {
            const before = state.spendingTransactions.length;
            state.spendingTransactions = state.spendingTransactions.filter(
                (t) => !removedIds.has(t.id),
            );
            removed = before - state.spendingTransactions.length;
        }
        for (const txn of parsedAdded) {
            const exists = state.spendingTransactions.some(
                (t) => t.id === txn.id,
            );
            if (!exists) {
                state.spendingTransactions.push(txn);
                added++;
            }
        }
        for (const txn of parsedModified) {
            const idx = state.spendingTransactions.findIndex(
                (t) => t.id === txn.id,
            );
            if (idx === -1) {
                state.spendingTransactions.push(txn);
            } else {
                state.spendingTransactions[idx] = txn;
            }
            modified++;
        }
    });
    if (!ok)
        return res.status(500).json({ error: 'Failed to save transactions.' });

    const syncedAt = new Date().toISOString();
    try {
        saveTokens('plaid', {
            ...tokens,
            items: updatedItems,
            transactionsLastSyncedAt: syncedAt,
        });
    } catch (err) {
        console.error('[Plaid] failed to persist sync cursor:', err);
        // Transactions are already saved (mutateState above succeeded), but
        // the advanced cursor is not -- the next sync will safely re-fetch
        // and re-apply the same pages (upserts are idempotent), just less
        // efficiently. Report this as a failure rather than "success" so
        // the caller knows the cursor didn't move.
        return res.status(502).json({
            error: 'Transactions synced, but failed to save the sync cursor. The next sync will retry these pages.',
        });
    }

    const response = {
        status: 'success',
        fetched: parsedAdded.length + parsedModified.length,
        added,
        modified,
        removed,
        syncedAt,
    };
    if (failedItems.length > 0) {
        response.warning = `${failedItems.length} item(s) failed; partial data synced.`;
    }
    res.json(response);
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
