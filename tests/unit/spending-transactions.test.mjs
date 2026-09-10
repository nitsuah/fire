import { describe, it, expect } from 'vitest';
import {
    parseCSVText,
    parseSpendingTransactions,
    matchMerchantOverride,
} from '../../app/lib/finance-core.js';

describe('matchMerchantOverride', () => {
    it('matches a user-defined keyword case-insensitively', () => {
        expect(
            matchMerchantOverride('STARBUCKS #1234', {
                starbucks: 'discretionary',
            }),
        ).toBe('discretionary');
    });

    it('returns null when nothing matches', () => {
        expect(
            matchMerchantOverride('random shop', { starbucks: 'food' }),
        ).toBe(null);
    });

    it('returns null when overrides is empty/undefined', () => {
        expect(matchMerchantOverride('anything', undefined)).toBe(null);
        expect(matchMerchantOverride('anything', {})).toBe(null);
    });
});

describe('parseSpendingTransactions', () => {
    it('parses a Chase-style statement into per-row transactions, skipping payments/credits', () => {
        const csv =
            'Transaction Date,Description,Category,Amount\n' +
            '01/05/2026,Whole Foods,Groceries,-84.32\n' +
            '01/06/2026,Paycheck Deposit,,2500.00\n' +
            '01/07/2026,Shell Gas Station,Gas,-42.10\n';
        const rows = parseCSVText(csv);
        const txns = parseSpendingTransactions(rows);
        expect(txns).toHaveLength(2);
        expect(txns[0]).toMatchObject({
            merchant: 'Whole Foods',
            amount: 84.32,
            category: 'food',
        });
        expect(txns[1]).toMatchObject({
            merchant: 'Shell Gas Station',
            amount: 42.1,
            category: 'transport',
        });
    });

    it('parses a Capital One-style statement using the Debit column', () => {
        const csv =
            'Card No.,Transaction Date,Description,Category,Debit,Credit\n' +
            '1234,01/05/2026,CVS Pharmacy,Pharmacy,18.50,\n' +
            '1234,01/06/2026,Payment Thank You,,,200.00\n';
        const rows = parseCSVText(csv);
        const txns = parseSpendingTransactions(rows);
        expect(txns).toHaveLength(1);
        expect(txns[0]).toMatchObject({
            merchant: 'CVS Pharmacy',
            amount: 18.5,
            category: 'healthcare',
        });
    });

    it('falls back to a generic date/description/amount CSV', () => {
        const csv =
            'Date,Description,Amount\n' + '2026-01-05,Trader Joes,-63.21\n';
        const rows = parseCSVText(csv);
        const txns = parseSpendingTransactions(rows);
        expect(txns).toHaveLength(1);
        expect(txns[0]).toMatchObject({
            merchant: 'Trader Joes',
            amount: 63.21,
        });
    });

    it('lets a user override take priority over the built-in keyword map', () => {
        const csv =
            'Date,Description,Amount\n' + '2026-01-05,Whole Foods,-50.00\n';
        const rows = parseCSVText(csv);
        const txns = parseSpendingTransactions(rows, {
            'whole foods': 'discretionary',
        });
        expect(txns[0].category).toBe('discretionary');
    });

    it('returns an empty array for a header-only or empty file', () => {
        expect(
            parseSpendingTransactions([['Date', 'Description', 'Amount']]),
        ).toEqual([]);
        expect(parseSpendingTransactions([])).toEqual([]);
        expect(parseSpendingTransactions(null)).toEqual([]);
    });
});
