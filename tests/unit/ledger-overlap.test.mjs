import { describe, it, expect } from 'vitest';
import { findStripeManualOverlapCandidates } from '../../app/lib/ledger-overlap.js';

describe('findStripeManualOverlapCandidates', () => {
    it('exact match inside window', () => {
        const ledger = [
            { id: 'stripe-1', date: '2024-01-10', gross: 100.0 },
            { id: 'manual-1', date: '2024-01-11', gross: 100.0 },
        ];
        const result = findStripeManualOverlapCandidates(ledger, {
            windowDays: 3,
        });
        expect(result).toEqual([
            {
                stripeId: 'stripe-1',
                manualId: 'manual-1',
                gross: 100.0,
                daysApart: 1,
            },
        ]);
    });

    it('outside window', () => {
        const ledger = [
            { id: 'stripe-1', date: '2024-01-10', gross: 100.0 },
            { id: 'manual-1', date: '2024-01-15', gross: 100.0 },
        ];
        const result = findStripeManualOverlapCandidates(ledger, {
            windowDays: 3,
        });
        expect(result).toEqual([]);
    });

    it('off by one cent', () => {
        const ledger = [
            { id: 'stripe-1', date: '2024-01-10', gross: 100.0 },
            { id: 'manual-1', date: '2024-01-11', gross: 100.01 },
        ];
        const result = findStripeManualOverlapCandidates(ledger, {
            windowDays: 3,
        });
        expect(result).toEqual([]);
    });

    it('refund pairs only with refund', () => {
        const ledger = [
            { id: 'stripe-1', date: '2024-01-10', gross: -50.0 },
            { id: 'manual-1', date: '2024-01-11', gross: -50.0 },
            { id: 'manual-2', date: '2024-01-11', gross: 50.0 },
        ];
        const result = findStripeManualOverlapCandidates(ledger, {
            windowDays: 3,
        });
        expect(result).toEqual([
            {
                stripeId: 'stripe-1',
                manualId: 'manual-1',
                gross: -50.0,
                daysApart: 1,
            },
        ]);
    });

    it('one manual row with two Stripe candidates pairs with the closer one only', () => {
        const ledger = [
            { id: 'stripe-1', date: '2024-01-10', gross: 100.0 },
            { id: 'stripe-2', date: '2024-01-12', gross: 100.0 },
            { id: 'manual-1', date: '2024-01-11', gross: 100.0 },
        ];
        const result = findStripeManualOverlapCandidates(ledger, {
            windowDays: 3,
        });
        expect(result).toEqual([
            {
                stripeId: 'stripe-1',
                manualId: 'manual-1',
                gross: 100.0,
                daysApart: 1,
            },
        ]);
    });

    it('eBay and Etsy rows never matched', () => {
        const ledger = [
            { id: 'stripe-1', date: '2024-01-10', gross: 100.0 },
            { id: 'ebay-1', date: '2024-01-11', gross: 100.0 },
            { id: 'etsy-1', date: '2024-01-11', gross: 100.0 },
            { id: 'manual-1', date: '2024-01-11', gross: 100.0 },
        ];
        const result = findStripeManualOverlapCandidates(ledger, {
            windowDays: 3,
        });
        expect(result).toEqual([
            {
                stripeId: 'stripe-1',
                manualId: 'manual-1',
                gross: 100.0,
                daysApart: 1,
            },
        ]);
    });

    it('bad input returns empty array', () => {
        expect(findStripeManualOverlapCandidates(null)).toEqual([]);
        expect(findStripeManualOverlapCandidates({})).toEqual([]);
        expect(findStripeManualOverlapCandidates('not array')).toEqual([]);
        expect(
            findStripeManualOverlapCandidates([
                { id: 'stripe-1', date: '2024-01-10', gross: 100.0 },
                { id: 'manual-1', date: 'invalid', gross: 100.0 },
            ]),
        ).toEqual([]);
        expect(
            findStripeManualOverlapCandidates([
                { id: 'stripe-1', date: '2024-01-10', gross: 100.0 },
                { id: 'manual-1', date: '2024-01-11', gross: NaN },
            ]),
        ).toEqual([]);
        expect(
            findStripeManualOverlapCandidates([
                { id: 'stripe-1', date: '2024-01-10', gross: 100.0 },
                { id: 'manual-1', date: '2024-01-11' },
            ]),
        ).toEqual([]);
    });

    it('input is not modified', () => {
        const ledger = [
            { id: 'stripe-1', date: '2024-01-10', gross: 100.0 },
            { id: 'manual-1', date: '2024-01-11', gross: 100.0 },
        ];
        Object.freeze(ledger);
        Object.freeze(ledger[0]);
        Object.freeze(ledger[1]);

        const result = findStripeManualOverlapCandidates(ledger, {
            windowDays: 3,
        });

        expect(ledger[0].id).toBe('stripe-1');
        expect(ledger[1].id).toBe('manual-1');
        expect(result).toEqual([
            {
                stripeId: 'stripe-1',
                manualId: 'manual-1',
                gross: 100.0,
                daysApart: 1,
            },
        ]);
    });
});
