/* global module, require */
'use strict';

const { stripeBalanceTransactionsToEntries } = require('./stripe-canonical');

const STRIPE_BALANCE_TRANSACTIONS_URL =
    'https://api.stripe.com/v1/balance_transactions';
const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

function errorForStatus(status) {
    if (status === 401) return 'unauthorized';
    if (status === 429) return 'rate_limited';
    return 'provider_error';
}

function mappedResult(transactions, nextCursor, partial, error) {
    const mapped = stripeBalanceTransactionsToEntries(transactions);
    return {
        ...mapped,
        nextCursor,
        partial,
        ...(error ? { error } : {}),
    };
}

async function fetchBalanceTransactions({
    key,
    cursor = null,
    fetchImpl = globalThis.fetch,
} = {}) {
    if (typeof key !== 'string' || !key.trim()) {
        return { error: 'unauthorized' };
    }
    if (typeof fetchImpl !== 'function') {
        return { error: 'provider_error' };
    }

    const transactions = [];
    let currentCursor =
        typeof cursor === 'string' && cursor.trim() ? cursor.trim() : null;
    let nextCursor = currentCursor;

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL(STRIPE_BALANCE_TRANSACTIONS_URL);
        url.searchParams.set('limit', String(PAGE_LIMIT));
        if (currentCursor) {
            url.searchParams.set('starting_after', currentCursor);
        }

        let response;
        try {
            response = await fetchImpl(url.toString(), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${key}`,
                    Accept: 'application/json',
                },
            });
        } catch {
            if (page === 0) return { error: 'provider_error' };
            return mappedResult(
                transactions,
                nextCursor,
                true,
                'provider_error',
            );
        }

        if (!response?.ok) {
            const error = errorForStatus(response?.status);
            if (page === 0) return { error };
            return mappedResult(transactions, nextCursor, true, error);
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            if (page === 0) return { error: 'provider_error' };
            return mappedResult(
                transactions,
                nextCursor,
                true,
                'provider_error',
            );
        }

        if (
            !payload ||
            !Array.isArray(payload.data) ||
            typeof payload.has_more !== 'boolean'
        ) {
            if (page === 0) return { error: 'provider_error' };
            return mappedResult(
                transactions,
                nextCursor,
                true,
                'provider_error',
            );
        }

        transactions.push(...payload.data);
        if (!payload.has_more) {
            return mappedResult(transactions, null, false);
        }

        const lastTransactionId = payload.data.at(-1)?.id;
        if (typeof lastTransactionId !== 'string' || !lastTransactionId) {
            if (page === 0) return { error: 'provider_error' };
            return mappedResult(
                transactions,
                nextCursor,
                true,
                'provider_error',
            );
        }

        currentCursor = lastTransactionId;
        nextCursor = lastTransactionId;
    }

    return mappedResult(transactions, nextCursor, true);
}

module.exports = { fetchBalanceTransactions };
