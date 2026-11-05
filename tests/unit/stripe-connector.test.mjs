import { describe, it, expect, vi } from 'vitest';
import stripe from '../../app/lib/stripe-connector.js';

const { fetchBalanceTransactions } = stripe;
const TEST_KEY = 'test-restricted-key';
const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
});
const transaction = (id, overrides = {}) => ({
    id,
    type: 'charge',
    currency: 'usd',
    created: 1_800_000_000,
    amount: 1000,
    fee: 100,
    description: 'Test sale',
    ...overrides,
});

describe('fetchBalanceTransactions', () => {
    it('paginates and maps canonical entries/skips', async () => {
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
        expect(result).toMatchObject({ nextCursor: null, partial: false });
        expect(result).not.toHaveProperty('data');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
        expect(fetchImpl.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
        expect(fetchImpl.mock.calls[0][1].signal).not.toBe(
            fetchImpl.mock.calls[1][1].signal,
        );

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
        expect(
            new URL(fetchImpl.mock.calls[1][0]).searchParams.get(
                'starting_after',
            ),
        ).toBe('txn_payout');
    });

    it.each([
        [401, 'unauthorized'],
        [429, 'rate_limited'],
    ])('maps first-page HTTP %i to a fixed error', async (status, error) => {
        const fetchImpl = vi.fn().mockResolvedValue(response(status, {}));
        await expect(
            fetchBalanceTransactions({ key: TEST_KEY, fetchImpl }),
        ).resolves.toEqual({ error });
    });

    it('maps a first-page timeout to a fixed provider error', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(
            new DOMException('secret provider detail', 'TimeoutError'),
        );
        await expect(
            fetchBalanceTransactions({ key: TEST_KEY, fetchImpl }),
        ).resolves.toEqual({ error: 'provider_error' });
        expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('preserves partial rows and cursor when a later page times out', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                response(200, {
                    data: [transaction('txn_1')],
                    has_more: true,
                }),
            )
            .mockRejectedValueOnce(
                new DOMException('secret provider detail', 'TimeoutError'),
            );
        const result = await fetchBalanceTransactions({
            key: TEST_KEY,
            fetchImpl,
        });

        expect(result.entries.map((entry) => entry.id)).toEqual([
            'stripe-txn_1',
        ]);
        expect(result).toMatchObject({
            nextCursor: 'txn_1',
            partial: true,
            error: 'provider_error',
        });
        expect(JSON.stringify(result)).not.toContain('secret provider detail');
        expect(fetchImpl.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('returns partial rows and a cursor on page-two failure', async () => {
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
        expect(result).toMatchObject({
            nextCursor: 'txn_1',
            partial: true,
            error: 'rate_limited',
        });
    });
});
