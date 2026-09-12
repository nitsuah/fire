import { describe, it, expect } from 'vitest';
import {
    parsePlaidTransactions,
    plaidCategoryToExpenseCategory,
} from '../../app/lib/finance-core.js';

describe('plaidCategoryToExpenseCategory', () => {
    it('maps a detailed personal_finance_category to our expense bucket', () => {
        expect(
            plaidCategoryToExpenseCategory({
                personal_finance_category: {
                    primary: 'FOOD_AND_DRINK',
                    detailed: 'FOOD_AND_DRINK_GROCERIES',
                },
            }),
        ).toBe('food');
    });

    it('splits RENT_AND_UTILITIES between housing and utilities only at the detailed level', () => {
        expect(
            plaidCategoryToExpenseCategory({
                personal_finance_category: {
                    primary: 'RENT_AND_UTILITIES',
                    detailed: 'RENT_AND_UTILITIES_RENT',
                },
            }),
        ).toBe('housing');
        expect(
            plaidCategoryToExpenseCategory({
                personal_finance_category: {
                    primary: 'RENT_AND_UTILITIES',
                    detailed: 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
                },
            }),
        ).toBe('utilities');
    });

    it('falls back to the primary category when detailed is unrecognized', () => {
        expect(
            plaidCategoryToExpenseCategory({
                personal_finance_category: {
                    primary: 'MEDICAL',
                    detailed: 'MEDICAL_SOME_NEW_SUBCATEGORY_NOT_IN_OUR_MAP',
                },
            }),
        ).toBe('healthcare');
    });

    it('falls back to the legacy category array when personal_finance_category is absent', () => {
        expect(
            plaidCategoryToExpenseCategory({
                category: ['Travel', 'Taxi'],
            }),
        ).toBe('transport');
    });

    it('falls back to merchant-keyword matching as a last resort', () => {
        expect(
            plaidCategoryToExpenseCategory({ merchant_name: 'STARBUCKS #1' }),
        ).toBe('food');
        expect(
            plaidCategoryToExpenseCategory({ name: 'Shell Gas Station' }),
        ).toBe('transport');
    });

    it('defaults to discretionary when nothing matches', () => {
        expect(
            plaidCategoryToExpenseCategory({ name: 'Acme Corp Widget Co' }),
        ).toBe('discretionary');
    });
});

describe('parsePlaidTransactions', () => {
    it('converts a Plaid transactions array into the spendingTransactions schema', () => {
        const txns = parsePlaidTransactions([
            {
                transaction_id: 'abc123',
                amount: 45.67,
                date: '2026-02-01',
                name: 'Whole Foods Market',
                merchant_name: 'Whole Foods',
                pending: false,
                personal_finance_category: {
                    primary: 'FOOD_AND_DRINK',
                    detailed: 'FOOD_AND_DRINK_GROCERIES',
                },
            },
        ]);
        expect(txns).toEqual([
            {
                id: 'plaid-abc123',
                date: '2026-02-01',
                merchant: 'Whole Foods',
                amount: 45.67,
                category: 'food',
            },
        ]);
    });

    it('excludes pending transactions', () => {
        const txns = parsePlaidTransactions([
            {
                transaction_id: 'p1',
                amount: 10,
                date: '2026-02-01',
                name: 'Pending Charge',
                pending: true,
            },
        ]);
        expect(txns).toEqual([]);
    });

    it('excludes negative/zero amounts (refunds, credits, incoming transfers)', () => {
        const txns = parsePlaidTransactions([
            {
                transaction_id: 'r1',
                amount: -20,
                date: '2026-02-01',
                name: 'Refund',
                pending: false,
            },
            {
                transaction_id: 'z1',
                amount: 0,
                date: '2026-02-01',
                name: 'Zero-dollar auth',
                pending: false,
            },
        ]);
        expect(txns).toEqual([]);
    });

    it('skips malformed entries (missing id or merchant name)', () => {
        const txns = parsePlaidTransactions([
            { amount: 10, date: '2026-02-01', name: 'No transaction_id' },
            { transaction_id: 't2', amount: 10, date: '2026-02-01' },
            null,
            'not-an-object',
        ]);
        expect(txns).toEqual([]);
    });

    it('returns an empty array for non-array input', () => {
        expect(parsePlaidTransactions(null)).toEqual([]);
        expect(parsePlaidTransactions(undefined)).toEqual([]);
        expect(parsePlaidTransactions({})).toEqual([]);
    });

    it('rounds amounts to the nearest cent', () => {
        const txns = parsePlaidTransactions([
            {
                transaction_id: 't1',
                amount: 19.999,
                date: '2026-02-01',
                name: 'Rounding Test',
                pending: false,
            },
        ]);
        expect(txns[0].amount).toBe(20);
    });
});
