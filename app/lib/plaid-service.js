/* global require, module, process, console, fetch, AbortSignal */
'use strict';

// Transport-agnostic Plaid operations shared by the Express routes
// (app/routes/plaid.js, self-hosted) and the Netlify Function
// (netlify/functions/plaid.mjs, hosted deploy). Nothing here knows about
// requests, responses, cookies or storage: each operation takes a list of
// linked Items ({ itemId, accessToken, transactionsCursor? }) and returns
// plain data. Where the access tokens live is the runtime's call: Express
// keeps them in the encrypted token store, the Function seals them into an
// HttpOnly grant cookie. Either way they never reach the browser.
//
// Errors thrown here carry a `status` and a generic message that is safe to
// show; the provider's own message and payload stay out of both the error
// and the logs (#262). Only Plaid's error code is kept.

const { parsePlaidTransactions } = require('./finance-parsing');
const { failureCode } = require('./plaid-status');

const REQUEST_TIMEOUT_MS = 15000;
// Plaid paginates /transactions/sync; bound the loop so a misbehaving
// response can't spin forever.
const TRANSACTION_PAGE_LIMIT = 20;
const TRANSACTION_PAGE_SIZE = 500;
// Plaid public tokens look like `public-<env>-<uuid>`. Anything else is
// rejected before it costs a Plaid call.
const PUBLIC_TOKEN_PATTERN = /^public-[A-Za-z0-9-]{1,200}$/;

const NOT_LINKED_MESSAGE = 'No Plaid connection. Link an account first.';

function plaidConfigured() {
    return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function plaidEnv() {
    return (process.env.PLAID_ENV || 'sandbox').toLowerCase();
}

function plaidBase() {
    const env = plaidEnv();
    if (env === 'production') return 'https://production.plaid.com';
    if (env === 'development') return 'https://development.plaid.com';
    return 'https://sandbox.plaid.com';
}

function plaidHeaders() {
    return {
        'Content-Type': 'application/json',
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
    };
}

function plaidError(message, props) {
    return Object.assign(new Error(message), props);
}

function isValidPublicToken(value) {
    return typeof value === 'string' && PUBLIC_TOKEN_PATTERN.test(value);
}

// Reads a Plaid response body as JSON, or undefined when it isn't JSON.
async function readJson(res) {
    try {
        if (typeof res.text === 'function') return JSON.parse(await res.text());
        if (typeof res.json === 'function') return await res.json();
    } catch {
        /* not JSON */
    }
    return undefined;
}

// One Plaid API call. Throws a status-carrying error with a generic message;
// a Plaid error keeps only its `error_code` (as plaidErrorCode).
async function plaidPost(path, body) {
    let res;
    try {
        res = await fetch(`${plaidBase()}${path}`, {
            method: 'POST',
            headers: plaidHeaders(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        const timedOut = err?.name === 'TimeoutError';
        throw plaidError(
            timedOut
                ? 'Plaid did not respond in time.'
                : 'Could not reach Plaid.',
            {
                status: timedOut ? 504 : 502,
                code: timedOut ? 'TIMEOUT' : 'UNREACHABLE',
            },
        );
    }
    const data = await readJson(res);
    const httpStatus = res.status || (res.ok ? 200 : 500);
    if (data === undefined || data === null || typeof data !== 'object') {
        throw plaidError(
            `Plaid returned a non-JSON response (HTTP ${httpStatus}).`,
            {
                status: 502,
                code: res.ok ? 'NON_JSON_RESPONSE' : `HTTP_${httpStatus}`,
            },
        );
    }
    if (!res.ok) {
        const plaidErrorCode =
            typeof data.error_code === 'string' ? data.error_code : null;
        throw plaidError(`Plaid request failed (HTTP ${httpStatus}).`, {
            status: 502,
            plaidErrorCode,
            code: plaidErrorCode || `HTTP_${httpStatus}`,
        });
    }
    return data;
}

// Logs the cause by code only and keeps a sanitized entry for the caller.
function recordItemFailure(failures, itemId, err, label) {
    const code = failureCode(err);
    console.error(`[Plaid] ${label} failed for item ${itemId}: ${code}`);
    failures.push({ itemId, code });
}

// Thrown when every linked Item failed, so the caller preserves what it has.
function allFailed(what, failedItems) {
    return plaidError(
        `All Plaid ${what} fetches failed. Existing data preserved.`,
        { status: 502, failedItems },
    );
}

function requireItems(items) {
    if (!Array.isArray(items) || items.length === 0)
        throw plaidError(NOT_LINKED_MESSAGE, { status: 401 });
    return items;
}

function partialWarning(failedItems, verb = 'returned') {
    if (!failedItems.length) return null;
    const relink = failedItems.some((f) => f.code === 'ITEM_LOGIN_REQUIRED')
        ? ' Re-link the affected institution to resume syncing it.'
        : '';
    return `${failedItems.length} item(s) failed; partial data ${verb}.${relink}`;
}

// What the last transaction sync did, so status can report an outcome rather
// than only a timestamp (#293). Codes only (#262).
function syncOutcome(failedItems, items) {
    const failed = (items || []).find((item) => item.lastErrorCode);
    return {
        at: new Date().toISOString(),
        ok: failedItems.length === 0,
        errorCode: failed ? failed.lastErrorCode : null,
    };
}

async function createLinkToken() {
    const data = await plaidPost('/link/token/create', {
        user: { client_user_id: 'fire-tracker-user' },
        client_name: 'fire',
        products: ['investments'],
        country_codes: ['US'],
        language: 'en',
    });
    if (typeof data.link_token !== 'string' || !data.link_token)
        throw plaidError('Plaid did not return a Link token.', { status: 502 });
    return data.link_token;
}

// Swaps a one-time public token for the Item's access token.
async function exchangePublicToken(publicToken) {
    if (!isValidPublicToken(publicToken))
        throw plaidError('A valid public_token is required.', { status: 400 });
    const data = await plaidPost('/item/public_token/exchange', {
        public_token: publicToken,
    });
    if (
        typeof data.access_token !== 'string' ||
        typeof data.item_id !== 'string' ||
        !data.access_token ||
        !data.item_id
    )
        throw plaidError('Plaid token exchange returned no Item.', {
            status: 502,
        });
    return { itemId: data.item_id, accessToken: data.access_token };
}

// Adds a freshly exchanged Item, or replaces the access token of a re-linked
// one (keeping its transaction cursor). Returns a new array.
function upsertItem(items, next) {
    const list = Array.isArray(items) ? items.slice() : [];
    const idx = list.findIndex((item) => item.itemId === next.itemId);
    if (idx >= 0) {
        const merged = { ...list[idx], ...next };
        delete merged.lastErrorCode;
        list[idx] = merged;
    } else list.push({ itemId: next.itemId, accessToken: next.accessToken });
    return list;
}

function accountType(type) {
    if (type === 'depository') return 'Cash';
    if (type === 'investment') return 'Brokerage';
    return 'Other';
}

// Runs fetchOne for every Item; a failed Item is recorded, not fatal, unless
// every Item failed.
async function perItem(items, what, fetchOne) {
    const rows = [];
    const failedItems = [];
    const syncedItemIds = [];
    for (const item of requireItems(items)) {
        try {
            rows.push(...(await fetchOne(item)));
            syncedItemIds.push(item.itemId);
        } catch (err) {
            recordItemFailure(failedItems, item.itemId, err, what);
        }
    }
    if (failedItems.length && !syncedItemIds.length)
        throw allFailed(what, failedItems);
    return { rows, syncedItemIds, failedItems };
}

async function fetchAccounts(items) {
    const { rows, ...rest } = await perItem(items, 'account', async (item) => {
        const data = await plaidPost('/accounts/balance/get', {
            access_token: item.accessToken,
        });
        return (data.accounts || []).map((acc) => ({
            id: `plaid-${acc.account_id}`,
            plaidItemId: item.itemId,
            name: acc.name,
            type: accountType(acc.type),
            value: acc.balances?.current ?? 0,
            source: 'plaid',
        }));
    });
    return { accounts: rows, ...rest };
}

async function fetchPositions(items) {
    const { rows, ...rest } = await perItem(items, 'position', async (item) => {
        const data = await plaidPost('/investments/holdings/get', {
            access_token: item.accessToken,
        });
        return (data.holdings || []).map((holding) => {
            const security = data.securities?.find(
                (s) => s.security_id === holding.security_id,
            );
            return {
                symbol: security?.ticker_symbol || holding.security_id,
                plaidItemId: item.itemId,
                description: security?.name || '',
                quantity: holding.quantity,
                value: holding.institution_value,
                costBasis: holding.cost_basis,
                source: 'plaid',
            };
        });
    });
    return { positions: rows, ...rest };
}

// Pulls new/updated/removed transactions for every Item via
// /transactions/sync (cursor-based) and parses them into the app's expense
// schema with parsePlaidTransactions, the same pipeline the CSV importers
// feed. Never throws for Item failures: `allFailed` tells the caller that no
// Item completed, and `items` always carries each Item's next state (an
// advanced cursor, or the original cursor plus a lastErrorCode) so the
// caller can persist the outcome either way (#293).
async function syncTransactions(items) {
    const added = [];
    const modified = [];
    const removed = [];
    const updatedItems = [];
    const failedItems = [];
    let successfulItemCount = 0;

    for (const item of requireItems(items)) {
        // Per-Item batches, so a failure (including the page cap) can be
        // discarded without contaminating other Items' complete batches.
        const itemAdded = [];
        const itemModified = [];
        const itemRemoved = [];
        let cursor = item.transactionsCursor || undefined;
        let hasMore = true;
        let failure = null;
        try {
            for (
                let page = 0;
                hasMore && page < TRANSACTION_PAGE_LIMIT;
                page++
            ) {
                const data = await plaidPost('/transactions/sync', {
                    access_token: item.accessToken,
                    cursor,
                    count: TRANSACTION_PAGE_SIZE,
                });
                itemAdded.push(...(data.added || []));
                itemModified.push(...(data.modified || []));
                itemRemoved.push(
                    ...(data.removed || []).map((r) => r.transaction_id),
                );
                cursor = data.next_cursor || cursor;
                hasMore = Boolean(data.has_more);
            }
            // Pagination that never finished is incomplete, not slow. Plaid
            // says an interrupted sync restarts from the *original* cursor,
            // so the batch is discarded and the cursor kept.
            if (hasMore)
                failure = plaidError(
                    'Transaction pagination exceeded the safety limit.',
                    {
                        code: 'PAGINATION_LIMIT',
                    },
                );
        } catch (err) {
            failure = err;
        }

        if (failure) {
            recordItemFailure(failedItems, item.itemId, failure, 'transaction');
            const code = failedItems[failedItems.length - 1].code;
            updatedItems.push({ ...item, lastErrorCode: code });
        } else {
            added.push(...itemAdded);
            modified.push(...itemModified);
            removed.push(...itemRemoved);
            // A successful sync means the grant works again.
            const clean = { ...item, transactionsCursor: cursor };
            delete clean.lastErrorCode;
            updatedItems.push(clean);
            successfulItemCount++;
        }
    }

    // A modified transaction that no longer qualifies as an expense (pending
    // again, refunded to a non-positive amount) is removed, like a deletion.
    const parsedAdded = parsePlaidTransactions(added);
    const parsedModified = parsePlaidTransactions(modified);
    const parsedModifiedIds = new Set(parsedModified.map((t) => t.id));
    const droppedModifiedIds = modified
        .map((t) => `plaid-${t.transaction_id}`)
        .filter((id) => !parsedModifiedIds.has(id));
    const removedIds = [
        ...new Set([
            ...removed.map((id) => `plaid-${id}`),
            ...droppedModifiedIds,
        ]),
    ];

    return {
        allFailed: failedItems.length > 0 && successfulItemCount === 0,
        items: updatedItems,
        failedItems,
        outcome: syncOutcome(failedItems, updatedItems),
        transactions: {
            added: parsedAdded,
            modified: parsedModified,
            removedIds,
        },
    };
}

// Applies a sync result to a spendingTransactions array in place, in the
// order Plaid asks for: removals, then additions (deduplicated by id), then
// modifications (upserts). Returns the applied counts.
function applyTransactions(list, transactions) {
    let removed = 0;
    let added = 0;
    let modified = 0;
    const removedIds = new Set(transactions.removedIds);
    if (removedIds.size) {
        for (let i = list.length - 1; i >= 0; i--) {
            if (removedIds.has(list[i].id)) {
                list.splice(i, 1);
                removed++;
            }
        }
    }
    for (const txn of transactions.added) {
        if (!list.some((t) => t.id === txn.id)) {
            list.push(txn);
            added++;
        }
    }
    for (const txn of transactions.modified) {
        const idx = list.findIndex((t) => t.id === txn.id);
        if (idx === -1) list.push(txn);
        else list[idx] = txn;
        modified++;
    }
    return { added, modified, removed };
}

// Merges freshly synced Plaid rows into a list that also holds other sources.
// Rows of a synced Item are replaced; rows saved before Item ids existed are
// replaced by id, or all at once when every Item synced (failedCount 0).
function mergePlaidRows(existing, incoming, syncedItemIds, failedCount, byId) {
    const synced = new Set(syncedItemIds);
    const incomingIds = byId ? new Set(incoming.map((r) => r.id)) : null;
    const retained = (existing || []).filter((row) => {
        if (row.source !== 'plaid') return true;
        if (incomingIds && incomingIds.has(row.id)) return false;
        return row.plaidItemId ? !synced.has(row.plaidItemId) : failedCount > 0;
    });
    return [...retained, ...incoming];
}

module.exports = {
    NOT_LINKED_MESSAGE,
    plaidConfigured,
    plaidEnv,
    plaidBase,
    isValidPublicToken,
    createLinkToken,
    exchangePublicToken,
    upsertItem,
    fetchAccounts,
    fetchPositions,
    syncTransactions,
    applyTransactions,
    mergePlaidRows,
    partialWarning,
    syncOutcome,
};
