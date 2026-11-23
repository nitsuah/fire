'use strict';

const express = require('express');
const fs = require('fs');
const { readState, mutateState } = require('../lib/db');
const { getTokenFile, loadTokens, saveTokens } = require('../lib/token-store');
const { reauthRequired } = require('../lib/plaid-status');
const plaid = require('../lib/plaid-service');

// Self-hosted adapter: the Plaid operations live in app/lib/plaid-service.js
// (shared with netlify/functions/plaid.mjs). This router only decides where
// things are kept: access tokens in the encrypted token store
// (app/lib/token-store.js), synced rows in the server's state.

const router = express.Router();

const NO_TOKENS = 'No Plaid tokens. Run /api/sync/plaid/exchange first.';

// Status code + generic body for a service error. Errors without a status
// are unexpected: their detail stays in the server log.
function sendError(res, err, fallback) {
    if (!err.status) {
        console.error('[Plaid]', fallback, err);
        return res.status(500).json({ error: fallback });
    }
    const body = { error: err.message };
    if (err.failedItems) body.failedCount = err.failedItems.length;
    return res.status(err.status).json(body);
}

function linkedItems() {
    return loadTokens('plaid')?.items || [];
}

// Linked Items exist but the credentials are gone: fail closed instead of
// calling Plaid with stored grants (status already reads "not configured").
function notConfigured(res) {
    return res.status(503).json({ error: 'Plaid not configured.' });
}

// mutateState reports a failed write as false, but a queued read or write
// can also reject; both mean nothing was saved.
async function saveState(fn) {
    try {
        return await mutateState(fn);
    } catch (err) {
        console.error('[Plaid] state write failed:', err.message);
        return false;
    }
}

// A total sync failure still records its outcome, but a token-file write
// failure must not mask the 502 the caller already has to report.
function saveTokensQuietly(tokens) {
    try {
        saveTokens('plaid', tokens);
    } catch (err) {
        console.error('[Plaid] failed to record sync outcome:', err.message);
    }
}

// `configured` is the difference between "no credentials on this deploy" and
// "credentials, nobody linked yet". `lastSync` carries the outcome of the
// last transaction sync and `reauthRequired` flags a dead grant, so a stale
// success cannot keep reporting "Connected" forever (#293).
router.get('/plaid/status', (req, res) => {
    const tokens = loadTokens('plaid');
    const db = readState();
    const items = tokens?.items || [];
    res.json({
        connected: items.length > 0,
        configured: plaid.plaidConfigured(),
        itemCount: items.length,
        lastUpdated: tokens?._tokenLastUpdated || null,
        lastTransactionsSync: tokens?.transactionsLastSyncedAt || null,
        lastSync: tokens?.transactionsLastSync || null,
        reauthRequired: reauthRequired(items),
        reauthItemIds: plaid.reauthItemIds(items),
        syncEnabled: db.plaidSyncEnabled !== false,
    });
});

// Whether transaction sync may run. Independent of Link, so accounts can
// stay linked while syncing is paused. The Fidelity CSV import reads this
// (via status) to disable itself while Plaid sync is on, so the two
// importers can't double-count the same expenses.
router.post('/plaid/toggle', async (req, res) => {
    if (!req.body || typeof req.body.enabled !== 'boolean') {
        return res
            .status(400)
            .json({ error: 'enabled (boolean) is required.' });
    }
    const enabled = req.body.enabled;
    let ok;
    try {
        ok = await mutateState((state) => {
            state.plaidSyncEnabled = enabled;
        });
    } catch (err) {
        console.error('[Plaid] Toggle error:', err);
        ok = false;
    }
    if (!ok)
        return res.status(500).json({ error: 'Failed to update setting.' });
    res.json({ enabled });
});

router.post('/plaid/create-link-token', async (req, res) => {
    if (!plaid.plaidConfigured()) {
        return res.status(503).json({
            error: 'Plaid not configured. Set PLAID_CLIENT_ID and PLAID_SECRET.',
        });
    }
    try {
        // With an itemId, Link opens in update mode to repair that Item.
        const { itemId } = req.body || {};
        const item =
            itemId === undefined
                ? undefined
                : plaid.findItem(linkedItems(), itemId);
        res.json({
            linkToken: await plaid.createLinkToken({ item }),
            ...(item ? { update: true } : {}),
        });
    } catch (err) {
        sendError(res, err, 'Plaid Link could not be started.');
    }
});

// After update-mode Link: confirm with Plaid that the Item's grant works and
// clear its re-link flag. Nothing is exchanged; the access token is unchanged.
router.post('/plaid/repair', async (req, res) => {
    if (!plaid.plaidConfigured()) return notConfigured(res);
    try {
        const { itemId } = req.body || {};
        const item = plaid.findItem(linkedItems(), itemId);
        const repaired = await plaid.confirmItemRepaired(item);
        // Re-read: only this Item changes, whatever happened meanwhile.
        const tokens = loadTokens('plaid') || {};
        saveTokens('plaid', {
            ...tokens,
            items: (tokens.items || []).map((i) => {
                if (
                    i.itemId !== repaired.itemId ||
                    i.accessToken !== item.accessToken
                )
                    return i;
                // Keep any newer cursor; drop only the re-link flag.
                const next = { ...i };
                delete next.lastErrorCode;
                return next;
            }),
        });
        res.json({ status: 'success', itemId: repaired.itemId });
    } catch (err) {
        if (err.status === 409)
            return res.status(409).json({ error: err.message, code: err.code });
        sendError(res, err, 'Plaid connection could not be checked.');
    }
});

router.post('/plaid/exchange', async (req, res) => {
    const { public_token } = req.body || {};
    if (!public_token)
        return res.status(400).json({ error: 'public_token is required.' });
    if (!plaid.isValidPublicToken(public_token))
        return res
            .status(400)
            .json({ error: 'A valid public_token is required.' });
    if (!plaid.plaidConfigured()) {
        return res.status(503).json({ error: 'Plaid not configured.' });
    }
    if (!process.env.SYNC_MASTER_KEY) {
        return res
            .status(503)
            .json({ error: 'SYNC_MASTER_KEY required to store Plaid tokens.' });
    }
    // loadTokens returns null for an unreadable file too; saving now would
    // overwrite every stored access token with just this one.
    if (!loadTokens('plaid') && fs.existsSync(getTokenFile('plaid'))) {
        return res.status(500).json({
            error: 'Stored Plaid tokens could not be read; refusing to overwrite them. Check SYNC_MASTER_KEY.',
        });
    }
    try {
        const item = await plaid.exchangePublicToken(public_token);
        const existing = loadTokens('plaid') || {};
        saveTokens('plaid', {
            ...existing,
            items: plaid.upsertItem(existing.items, item),
        });
        res.json({
            status: 'success',
            message: 'Plaid access token stored.',
            itemId: item.itemId,
        });
    } catch (err) {
        sendError(res, err, 'Plaid token exchange failed.');
    }
});

router.post('/plaid/positions', async (req, res) => {
    const items = linkedItems();
    if (!items.length) return res.status(401).json({ error: NO_TOKENS });
    if (!plaid.plaidConfigured()) return notConfigured(res);
    let result;
    try {
        result = await plaid.fetchPositions(items);
    } catch (err) {
        return sendError(res, err, 'Plaid position sync failed.');
    }
    const { positions, syncedItemIds, failedItems } = result;
    const ok = await saveState((state) => {
        state.importedPositions = plaid.mergePlaidRows(
            state.importedPositions,
            positions,
            syncedItemIds,
            failedItems.length,
            false,
        );
    });
    if (!ok)
        return res.status(500).json({ error: 'Failed to save positions.' });
    const body = {
        status: 'success',
        positionCount: positions.length,
        syncedItemIds,
    };
    const warning = plaid.partialWarning(failedItems, 'saved');
    if (warning) body.warning = warning;
    res.json(body);
});

router.post('/plaid/accounts', async (req, res) => {
    const items = linkedItems();
    if (!items.length) return res.status(401).json({ error: NO_TOKENS });
    if (!plaid.plaidConfigured()) return notConfigured(res);
    let result;
    try {
        result = await plaid.fetchAccounts(items);
    } catch (err) {
        return sendError(res, err, 'Plaid account sync failed.');
    }
    const { accounts, syncedItemIds, failedItems } = result;
    const ok = await saveState((state) => {
        state.customAccounts = plaid.mergePlaidRows(
            state.customAccounts,
            accounts,
            syncedItemIds,
            failedItems.length,
            true,
        );
    });
    if (!ok) return res.status(500).json({ error: 'Failed to save accounts.' });
    const body = {
        status: 'success',
        accountCount: accounts.length,
        syncedItemIds,
    };
    const warning = plaid.partialWarning(failedItems, 'saved');
    if (warning) body.warning = warning;
    res.json(body);
});

// Cursor-based transaction sync into state.spendingTransactions, the store
// the CSV importers feed (see plaid.syncTransactions).
router.post('/plaid/transactions', async (req, res) => {
    if (readState().plaidSyncEnabled === false) {
        return res.status(403).json({
            error: 'Plaid sync is disabled. Enable it in Settings before syncing.',
        });
    }
    const tokens = loadTokens('plaid');
    if (!tokens?.items?.length)
        return res.status(401).json({ error: NO_TOKENS });
    if (!plaid.plaidConfigured()) return notConfigured(res);

    let result;
    try {
        result = await plaid.syncTransactions(tokens.items);
    } catch (err) {
        return sendError(res, err, 'Plaid transaction sync failed.');
    }
    // The sync awaited Plaid, so the store may have changed meanwhile (an
    // Item linked, re-linked or synced by another request). Each write below
    // re-reads it and merges in the same synchronous step, so no Item added
    // since the sync started is dropped and no newer cursor is rolled back.
    const currentTokens = () => loadTokens('plaid') || tokens;
    const mergeItems = () =>
        plaid.mergeSyncedItems(
            currentTokens().items,
            tokens.items,
            result.items,
        );

    if (result.allFailed) {
        // Still persisted: the per-Item codes are how status tells the user
        // to re-link instead of showing the old last-sync time (#293).
        saveTokensQuietly({
            ...currentTokens(),
            items: mergeItems(),
            transactionsLastSync: result.outcome,
        });
        return res.status(502).json({
            error: 'All Plaid transaction fetches failed. Existing data preserved.',
            failedCount: result.failedItems.length,
        });
    }

    let counts;
    const ok = await saveState((state) => {
        if (!state.spendingTransactions) state.spendingTransactions = [];
        counts = plaid.applyTransactions(
            state.spendingTransactions,
            result.transactions,
        );
    });
    if (!ok)
        return res.status(500).json({ error: 'Failed to save transactions.' });

    const syncedAt = result.outcome.at;
    try {
        saveTokens('plaid', {
            ...currentTokens(),
            items: mergeItems(),
            transactionsLastSyncedAt: syncedAt,
            transactionsLastSync: result.outcome,
        });
    } catch (err) {
        console.error('[Plaid] failed to persist sync cursor:', err.message);
        // The transactions are saved but the cursor isn't: the next sync
        // re-applies the same pages (upserts are idempotent). Report it, so
        // the caller knows the cursor didn't move.
        return res.status(502).json({
            error: 'Transactions synced, but failed to save the sync cursor. The next sync will retry these pages.',
        });
    }

    const body = {
        status: 'success',
        fetched:
            result.transactions.added.length +
            result.transactions.modified.length,
        ...counts,
        syncedAt,
    };
    const warning = plaid.partialWarning(result.failedItems, 'synced');
    if (warning) body.warning = warning;
    res.json(body);
});

module.exports = router;
