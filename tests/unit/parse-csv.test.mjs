import { describe, it, expect } from 'vitest';
import {
    parseCSVText,
    parseFidelityPositions,
    parseChaseStatement,
    parseCapitalOneStatement,
} from '../../app/lib/finance-core.js';

// ─── parseCSVText ──────────────────────────────────────────────────────────────

describe('parseCSVText', () => {
    it('parses simple comma-separated rows', () => {
        const rows = parseCSVText('a,b,c\n1,2,3');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual(['a', 'b', 'c']);
        expect(rows[1]).toEqual(['1', '2', '3']);
    });

    it('handles quoted fields with commas inside', () => {
        const rows = parseCSVText('"hello, world",foo\nbar,baz');
        expect(rows[0][0]).toBe('hello, world');
        expect(rows[0][1]).toBe('foo');
    });

    it('handles escaped double-quotes inside quoted fields', () => {
        const rows = parseCSVText('"say ""hi""",done');
        expect(rows[0][0]).toBe('say "hi"');
    });

    it('handles CRLF line endings', () => {
        const rows = parseCSVText('a,b\r\nc,d');
        expect(rows).toHaveLength(2);
        expect(rows[1]).toEqual(['c', 'd']);
    });

    it('ignores trailing empty line', () => {
        const rows = parseCSVText('a,b\n1,2\n');
        expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty array for empty string', () => {
        const rows = parseCSVText('');
        expect(rows).toEqual([]);
    });
});

// ─── parseFidelityPositions ────────────────────────────────────────────────────

describe('parseFidelityPositions', () => {
    it('returns 0 count if Symbol column is missing', () => {
        const rows = parseCSVText('Foo,Bar\n1,2');
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(0);
        expect(result.positions).toEqual([]);
    });

    it('parses a valid Fidelity CSV row', () => {
        const FIDELITY_HEADER =
            'Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Gain/Loss Dollar,Gain/Loss Percent';
        const csv = `${FIDELITY_HEADER}\nRetirement,AAPL,Apple Inc,10,175.00,"$1,750.00","$1,400.00",350,25`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(1);
        expect(result.positions[0].symbol).toBe('AAPL');
        expect(result.positions[0].value).toBe(1750);
        expect(result.positions[0].quantity).toBe(10);
        expect(result.positions[0].lastPrice).toBe(175);
        expect(result.positions[0].costBasis).toBe(1400);
    });

    it('calculates pnlDollar from value minus costBasis when no gain columns', () => {
        const header =
            'Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total';
        const csv = `${header}\nAcc,TSLA,Tesla,5,200,1000,800`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.positions[0].pnlDollar).toBe(200);
        expect(result.positions[0].pnlPercent).toBeCloseTo(25, 1);
    });

    it('stops parsing at "The data" disclaimer rows', () => {
        const csv =
            'Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Gain/Loss Dollar,Gain/Loss Percent\nAcc,AAPL,Apple,10,175,1750,1400,350,25\nThe data and information,,,,,,,,';
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(1);
    });

    it('skips rows where current value is NaN', () => {
        const csv =
            'Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Gain/Loss Dollar,Gain/Loss Percent\nAcc,AAPL,Apple,10,175,notanumber,1400,350,25';
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(0);
    });

    it('uses Brokerage as default account name', () => {
        const header =
            'Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total';
        const csv = `${header}\nAAPL,Apple Inc,10,175,1750,1400`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(1);
        expect(result.positions[0].account).toBe('Brokerage');
    });
});

// ─── parseChaseStatement ───────────────────────────────────────────────────────

describe('parseChaseStatement', () => {
    it('counts negative amounts as outflow', () => {
        const rows = [
            ['Date', 'Desc', 'Type', 'Cat', 'Bal', 'Amount'],
            ['2024-01-01', 'Coffee', 'Debit', 'Food', '100', '-5.50'],
            ['2024-01-02', 'Paycheck', 'Credit', 'Income', '1000', '3000'],
        ];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(1);
        expect(result.totalOutflow).toBeCloseTo(5.5);
    });

    it('skips header row', () => {
        const rows = [
            ['Date', 'Desc', 'x', 'x', 'x', 'Amount'],
            ['2024-01-01', 'Coffee', '', '', '', '-10.00'],
        ];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(1);
    });

    it('skips rows with fewer than 6 columns', () => {
        const rows = [['Header'], ['2024-01-01', 'Coffee', '-5']];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(0);
    });

    it('returns zero for positive-only transactions', () => {
        const rows = [
            ['Date', 'Desc', 'x', 'x', 'x', 'Amount'],
            ['2024-01-01', 'Paycheck', '', '', '', '3000'],
        ];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(0);
        expect(result.totalOutflow).toBe(0);
    });
});

// ─── parseCapitalOneStatement ──────────────────────────────────────────────────

describe('parseCapitalOneStatement', () => {
    it('counts debit amounts as outflow', () => {
        const csv =
            'Card No.,Date,Description,Category,Debit,Credit\n1234,2024-01-01,Coffee,Food,5.50,\n1234,2024-01-02,Payment,,, 100.00';
        const rows = parseCSVText(csv);
        const result = parseCapitalOneStatement(rows);
        expect(result.imported).toBe(1);
        expect(result.totalOutflow).toBeCloseTo(5.5);
    });

    it('returns 0 if debit column not found', () => {
        const csv = 'Date,Description,Amount\n2024-01-01,Coffee,5.50';
        const rows = parseCSVText(csv);
        const result = parseCapitalOneStatement(rows);
        expect(result.imported).toBe(0);
    });

    it('skips rows shorter than debit column index', () => {
        const rows = [
            ['Card No.', 'Date', 'Desc', 'Cat', 'Debit', 'Credit'],
            ['1234', '2024-01-01'],
        ];
        const result = parseCapitalOneStatement(rows);
        expect(result.imported).toBe(0);
    });
});

// ─── parseChaseStatement (categorization) ─────────────────────────────────────

describe('parseChaseStatement (categorization)', () => {
    it('maps food & drink category to food bucket via CHASE_CATEGORY_MAP', () => {
        const result = parseChaseStatement([
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-01',
                '2024-01-02',
                'Restaurant Purchase',
                'Food & Drink',
                'Sale',
                '-15.00',
            ],
        ]);
        expect(result.categories.food).toBeCloseTo(15);
    });

    it('maps gas category to transport bucket via CHASE_CATEGORY_MAP', () => {
        const result = parseChaseStatement([
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-03',
                '2024-01-04',
                'Gas Station',
                'Gas',
                'Sale',
                '-60.00',
            ],
        ]);
        expect(result.categories.transport).toBeCloseTo(60);
    });

    it('maps health & wellness category to healthcare bucket via CHASE_CATEGORY_MAP', () => {
        const result = parseChaseStatement([
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-05',
                '2024-01-06',
                'Pharmacy',
                'Health & Wellness',
                'Sale',
                '-22.00',
            ],
        ]);
        expect(result.categories.healthcare).toBeCloseTo(22);
    });

    it('falls back to keyword matching when category is not in CHASE_CATEGORY_MAP', () => {
        const result = parseChaseStatement([
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-07',
                '2024-01-08',
                'Grocery Store Purchase',
                'Retail',
                'Sale',
                '-85.00',
            ],
        ]);
        // 'Retail' not in CHASE_CATEGORY_MAP, so it falls through to
        // description-based keyword matching — 'Grocery' → food
        expect(result.categories.food).toBeCloseTo(85);
    });

    it('returns exact months from _parseDateRange for two dates a month apart', () => {
        const result = parseChaseStatement([
            [
                'Transaction Date',
                'Post Date',
                'Description',
                'Category',
                'Type',
                'Amount',
            ],
            [
                '2024-01-01',
                '2024-01-02',
                'Coffee',
                'Food & Drink',
                'Sale',
                '-5.00',
            ],
            [
                '2024-02-01',
                '2024-02-02',
                'Coffee',
                'Food & Drink',
                'Sale',
                '-5.00',
            ],
        ]);
        expect(result.months).toBe(1);
    });
});

// ─── parseCapitalOneStatement (categorization) ───────────────────────────────

describe('parseCapitalOneStatement (categorization)', () => {
    it('maps grocery category to food bucket', () => {
        const csv =
            'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2024-01-01,2024-01-02,1234,Kroger,Grocery Store/Supermarket,85.00,';
        const rows = parseCSVText(csv);
        const result = parseCapitalOneStatement(rows);
        expect(result.imported).toBe(1);
        expect(result.categories.food).toBeCloseTo(85);
    });

    it('categorizes uncategorized transaction via keyword fallback', () => {
        const csv =
            'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2024-01-01,2024-01-02,1234,Walgreens Pharmacy,Other,12.00,';
        const rows = parseCSVText(csv);
        const result = parseCapitalOneStatement(rows);
        expect(result.categories.healthcare).toBeCloseTo(12);
    });
});
