'use strict';

const express = require('express');
const { readState, mutateState } = require('../lib/db');
const { parsePlaidTransactions } = require('../lib/finance-parsing');
const { loadTokens, saveTokens } = require('../lib/token-store');

const router = express.Router();

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
        lastUpdated: tokens._tokenLastUpdated || null,
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
            client_name: 'fire',
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
    const { public_token } = req.body || {};
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
    const failedItems = [];
    const syncedItemIds = [];
    for (const { accessToken, itemId } of tokens.items) {
        try {
            const r = await fetch(`${plaidBase()}/investments/holdings/get`, {
                method: 'POST',
                headers: plaidHeaders(),
                body: JSON.stringify({ access_token: accessToken }),
                signal: AbortSignal.timeout(15000),
            });
            if (!r.ok) {
                failedItems.push(itemId);
                continue;
            }
            const data = await r.json();
            for (const holding of data.holdings || []) {
                const security = data.securities?.find(
                    (s) => s.security_id === holding.security_id,
                );
                allPositions.push({
                    symbol: security?.ticker_symbol || holding.security_id,
                    plaidItemId: itemId,
                    description: security?.name || '',
                    quantity: holding.quantity,
                    value: holding.institution_value,
                    costBasis: holding.cost_basis,
                    source: 'plaid',
                });
            }
        } catch (err) {
            console.error('[Plaid] holdings fetch error:', err);
            failedItems.push(itemId);
        }
        if (!failedItems.includes(itemId)) syncedItemIds.push(itemId);
    }
    if (failedItems.length > 0 && syncedItemIds.length === 0) {
        return res.status(502).json({
            error: 'All Plaid position fetches failed. Existing data preserved.',
            failedCount: failedItems.length,
        });
    }
    const ok = await mutateState((state) => {
        const synced = new Set(syncedItemIds);
        const retained = (state.importedPositions || []).filter(
            (p) =>
                p.source !== 'plaid' ||
                !p.plaidItemId ||
                !synced.has(p.plaidItemId),
        );
        state.importedPositions = [...retained, ...allPositions];
    });
    if (!ok)
        return res.status(500).json({ error: 'Failed to save positions.' });
    const positionsResponse = {
        status: 'success',
        positionCount: allPositions.length,
        syncedItemIds,
    };
    if (failedItems.length > 0) {
        positionsResponse.warning = `${failedItems.length} item(s) failed; partial data saved.`;
    }
    res.json(positionsResponse);
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
    const syncedItemIds = [];
    for (const { accessToken, itemId } of tokens.items) {
        try {
            const r = await fetch(`${plaidBase()}/accounts/balance/get`, {
                method: 'POST',
                headers: plaidHeaders(),
                body: JSON.stringify({ access_token: accessToken }),
                signal: AbortSignal.timeout(15000),
            });
            if (!r.ok) {
                failedItems.push(itemId);
                continue;
            }
            const data = await r.json();
            for (const acc of data.accounts || []) {
                accounts.push({
                    id: `plaid-${acc.account_id}`,
                    plaidItemId: itemId,
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
            failedItems.push(itemId);
        }
        if (!failedItems.includes(itemId)) syncedItemIds.push(itemId);
    }
    if (failedItems.length > 0 && syncedItemIds.length === 0) {
        return res.status(502).json({
            error: 'All Plaid account fetches failed. Existing data preserved.',
            failedCount: failedItems.length,
        });
    }
    const ok = await mutateState((state) => {
        const synced = new Set(syncedItemIds);
        const retained = (state.customAccounts || []).filter(
            (a) =>
                a.source !== 'plaid' ||
                !a.plaidItemId ||
                !synced.has(a.plaidItemId),
        );
        state.customAccounts = [...retained, ...accounts];
    });
    if (!ok) return res.status(500).json({ error: 'Failed to save accounts.' });
    const accountsResponse = {
        status: 'success',
        accountCount: accounts.length,
        syncedItemIds,
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

module.exports = router;
