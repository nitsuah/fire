/* global module, require */
'use strict';

const { stripeBalanceTransactionsToEntries } = require('./stripe-canonical');

const STRIPE_BALANCE_TRANSACTIONS_URL =
    'https://api.stripe.com/v1/balance_transactions';
const PAGE_LIMIT = 100;
// Bound one call; the caller can resume with the returned nextCursor.
const MAX_PAGES = 10;
const PAGE_TIMEOUT_MS = 10_000;

function errorForStatus(status) {
    if (status === 401) return 'unauthorized';
    if (status === 429) return 'rate_limited';
    return 'provider_error';
}

function mappedResult(transactions, nextCursor, partial, error) {
    return {
        ...stripeBalanceTransactionsToEntries(transactions),
        nextCursor,
        partial,
        ...(error ? { error } : {}),
    };
}

function failure(transactions, nextCursor, page, error) {
    return page === 0
        ? { error }
        : mappedResult(transactions, nextCursor, true, error);
}

async function fetchBalanceTransactions({
    key,
    cursor = null,
    fetchImpl = globalThis.fetch,
} = {}) {
    if (typeof key !== 'string' || !key.trim()) {
        return { error: 'unauthorized' };
    }
    if (typeof fetchImpl !== 'function') return { error: 'provider_error' };
    const bearerKey = key.trim();

    const transactions = [];
    let currentCursor =
        typeof cursor === 'string' && cursor.trim() ? cursor.trim() : null;
    let nextCursor = currentCursor;

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new globalThis.URL(STRIPE_BALANCE_TRANSACTIONS_URL);
        url.searchParams.set('limit', String(PAGE_LIMIT));
        if (currentCursor) {
            url.searchParams.set('starting_after', currentCursor);
        }

        let response;
        let payload;
        try {
            response = await fetchImpl(url.toString(), {
                signal: globalThis.AbortSignal.timeout(PAGE_TIMEOUT_MS),
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${bearerKey}`,
                    Accept: 'application/json',
                },
            });
            if (!response?.ok) {
                return failure(
                    transactions,
                    nextCursor,
                    page,
                    errorForStatus(response?.status),
                );
            }
            payload = await response.json();
        } catch {
            return failure(transactions, nextCursor, page, 'provider_error');
        }

        if (
            !Array.isArray(payload?.data) ||
            typeof payload.has_more !== 'boolean'
        ) {
            return failure(transactions, nextCursor, page, 'provider_error');
        }

        transactions.push(...payload.data);
        if (!payload.has_more) {
            return mappedResult(transactions, null, false);
        }

        const lastId = payload.data.at(-1)?.id;
        if (typeof lastId !== 'string' || !lastId) {
            return failure(transactions, nextCursor, page, 'provider_error');
        }
        currentCursor = nextCursor = lastId;
    }

    return mappedResult(transactions, nextCursor, true);
}

module.exports = { fetchBalanceTransactions };
