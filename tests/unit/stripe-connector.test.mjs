import { describe, it, expect, vi } from 'vitest';
import stripe from '../../app/lib/stripe-connector.js';

const { fetchBalanceTransactions } = stripe;
const TEST_KEY = 'test-restricted-key';

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: vi.fn().mockResolvedValue(body),
    };
}

function transaction(id, overrides = {}) {
    return {
        id,
        type: 'charge',
        currency: 'usd',
        created: 1_800_000_000,
        amount: 1000,
        fee: 100,
        description: 'Test sale',
        ...overrides,
    };
}

describe('fetchBalanceTransactions', () => {
    it('paginates with limit 100 and maps entries/skipped reasons', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                response(200, {
                    data: [
                        transaction('txn_1'),
                        transaction('txn_payout', { type: 'payout' }),
                    ],
                    has_more: true,
                }),
            )
            .mockResolvedValueOnce(
                response(200, {
                    data: [transaction('txn_2')],
                    has_more: false,
                }),
            );

        const result = await fetchBalanceTransactions({
            key: TEST_KEY,
            cursor: 'txn_start',
            fetchImpl,
        });

        expect(result.entries.map((entry) => entry.id)).toEqual([
            'stripe-txn_1',
            'stripe-txn_2',
        ]);
        expect(result.skipped).toEqual([
            { id: 'txn_payout', type: 'payout', reason: 'payout' },
        ]);
        expect(result.nextCursor).toBeNull();
        expect(result.partial).toBe(false);
        expect(result).not.toHaveProperty('data');
        expect(fetchImpl).toHaveBeenCalledTimes(2);

        const [firstUrl, firstOptions] = fetchImpl.mock.calls[0];
        expect(new URL(firstUrl).searchParams.get('limit')).toBe('100');
        expect(new URL(firstUrl).searchParams.get('starting_after')).toBe(
            'txn_start',
        );
        expect(firstOptions).toMatchObject({
            method: 'GET',
            headers: {
                Authorization: `Bearer ${TEST_KEY}`,
                Accept: 'application/json',
            },
        });

        const [secondUrl] = fetchImpl.mock.calls[1];
        expect(new URL(secondUrl).searchParams.get('starting_after')).toBe(
            'txn_payout',
        );
    });

    it('maps a first-page 401 to a fixed unauthorized error', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(response(401, {}));

        await expect(
            fetchBalanceTransactions({ key: TEST_KEY, fetchImpl }),
        ).resolves.toEqual({ error: 'unauthorized' });
    });

    it('maps a first-page 429 to a fixed rate-limited error', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(response(429, {}));

        await expect(
            fetchBalanceTransactions({ key: TEST_KEY, fetchImpl }),
        ).resolves.toEqual({ error: 'rate_limited' });
    });

    it('returns mapped first-page rows and a continuation cursor on page-two failure', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                response(200, {
                    data: [transaction('txn_1')],
                    has_more: true,
                }),
            )
            .mockResolvedValueOnce(response(429, {}));

        const result = await fetchBalanceTransactions({
            key: TEST_KEY,
            fetchImpl,
        });

        expect(result.entries.map((entry) => entry.id)).toEqual([
            'stripe-txn_1',
        ]);
        expect(result.skipped).toEqual([]);
        expect(result.nextCursor).toBe('txn_1');
        expect(result.partial).toBe(true);
        expect(result.error).toBe('rate_limited');
    });

    it('does not call the provider without a key', async () => {
        const fetchImpl = vi.fn();

        await expect(
            fetchBalanceTransactions({ key: '', fetchImpl }),
        ).resolves.toEqual({ error: 'unauthorized' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
