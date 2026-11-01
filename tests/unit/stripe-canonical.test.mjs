import { describe, expect, it } from 'vitest';
import * as stripe from '../../app/lib/stripe-canonical.js';

const created = Date.UTC(2024, 0, 15, 12, 30) / 1000;

function transaction(overrides = {}) {
    return {
        id: 'txn_default',
        type: 'charge',
        currency: 'usd',
        amount: 10000,
        fee: 325,
        created,
        description: '  Test sale  ',
        ...overrides,
    };
}

describe('stripeBalanceTransactionsToEntries', () => {
    it('maps a USD charge to the canonical ledger row in dollars', () => {
        const result = stripe.stripeBalanceTransactionsToEntries([
            transaction({ id: 'txn_charge_1' }),
        ]);

        expect(result.skipped).toEqual([]);
        expect(result.entries).toEqual([
            {
                id: 'stripe-txn_charge_1',
                platform: 'Stripe',
                date: '2024-01-15',
                description: 'Test sale',
                gross: 100,
                fees: 3.25,
                net: 96.75,
                stripeTxnId: 'txn_charge_1',
                kind: 'charge',
            },
        ]);
    });

    it('maps payment and refund/reversal types with separate negative rows', () => {
        const result = stripe.stripeBalanceTransactionsToEntries([
            transaction({ id: 'txn_payment', type: 'payment' }),
            transaction({
                id: 'txn_partial_refund',
                type: 'refund',
                amount: -2500,
                fee: 0,
                description: 'Partial refund',
            }),
            transaction({
                id: 'txn_full_refund',
                type: 'payment_refund',
                amount: -10000,
                fee: -325,
                description: 'Full refund',
            }),
            transaction({
                id: 'txn_lost_dispute',
                type: 'adjustment',
                amount: -3000,
                fee: 1500,
                description: 'Lost dispute',
            }),
        ]);

        expect(result.skipped).toEqual([]);
        expect(result.entries.map((entry) => entry.id)).toEqual([
            'stripe-txn_payment',
            'stripe-txn_partial_refund',
            'stripe-txn_full_refund',
            'stripe-txn_lost_dispute',
        ]);
        expect(result.entries.slice(1)).toMatchObject([
            { gross: -25, fees: 0, net: -25 },
            { gross: -100, fees: -3.25, net: -96.75 },
            { gross: -30, fees: 15, net: -45 },
        ]);
    });

    it('maps a standalone Stripe fee as a negative net row', () => {
        const result = stripe.stripeBalanceTransactionsToEntries([
            transaction({
                id: 'txn_fee',
                type: 'stripe_fee',
                amount: -45,
                fee: 0,
            }),
        ]);

        expect(result.entries[0]).toMatchObject({
            gross: 0,
            fees: 0.45,
            net: -0.45,
            kind: 'stripe_fee',
        });
    });

    it('never treats payout transactions as income', () => {
        const result = stripe.stripeBalanceTransactionsToEntries(
            ['payout', 'payout_cancel', 'payout_failure'].map((type) =>
                transaction({ id: `txn_${type}`, type }),
            ),
        );

        expect(result.entries).toEqual([]);
        expect(result.skipped.map((item) => item.reason)).toEqual([
            'payout',
            'payout',
            'payout',
        ]);
    });

    it('collapses duplicate transaction ids with the first occurrence winning', () => {
        const result = stripe.stripeBalanceTransactionsToEntries([
            transaction({ id: 'txn_duplicate', amount: 1000 }),
            transaction({ id: 'txn_duplicate', amount: 9000 }),
        ]);

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].gross).toBe(10);
        expect(result.skipped).toEqual([
            { id: 'txn_duplicate', type: 'charge', reason: 'duplicate' },
        ]);
    });

    it('skips non-USD transactions and ids outside the Stripe transaction format', () => {
        const result = stripe.stripeBalanceTransactionsToEntries([
            transaction({ id: 'txn_eur', currency: 'eur' }),
            transaction({ id: 'manual-1' }),
        ]);

        expect(result.entries).toEqual([]);
        expect(result.skipped.map((item) => item.reason)).toEqual([
            'non_usd',
            'invalid_id',
        ]);
    });

    it('reports unsupported transaction types without creating ledger rows', () => {
        const result = stripe.stripeBalanceTransactionsToEntries([
            transaction({ id: 'txn_transfer', type: 'transfer' }),
        ]);

        expect(result.entries).toEqual([]);
        expect(result.skipped).toEqual([
            {
                id: 'txn_transfer',
                type: 'transfer',
                reason: 'unsupported:transfer',
            },
        ]);
    });

    it('skips malformed timestamps and amounts instead of inventing data', () => {
        const result = stripe.stripeBalanceTransactionsToEntries([
            transaction({ id: 'txn_bad_date', created: 'not-a-timestamp' }),
            transaction({ id: 'txn_bad_amount', amount: 'invalid' }),
        ]);

        expect(result.entries).toEqual([]);
        expect(result.skipped.map((item) => item.reason)).toEqual([
            'invalid_created',
            'invalid_amount',
        ]);
    });

    it('does not mutate the input and treats non-array input as empty', () => {
        const input = [transaction()];
        const before = structuredClone(input);

        expect(
            stripe.stripeBalanceTransactionsToEntries(input).entries,
        ).toHaveLength(1);
        expect(input).toEqual(before);
        expect(stripe.stripeBalanceTransactionsToEntries(null)).toEqual({
            entries: [],
            skipped: [],
        });
    });
});
