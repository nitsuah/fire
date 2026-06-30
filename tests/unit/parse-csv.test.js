'use strict';

const {
    formatCurrency,
    pnlColorStyle,
    sanitizeState,
    parseCSVText,
    parseFidelityPositions,
    parseChaseStatement,
    parseCapitalOneStatement,
    computeEffectiveTaxRate,
    insuranceToMonthly,
    getInsuranceMonthly,
    getMonthlyExpensesBase,
    getAnnualExpensesTotal,
    isSettledCash,
    getAggregateCash,
    getAggregateCDs,
    getAggregateEquities,
    getAggregateOtherAssets,
    getSideGigYTDNet,
    getAggregateRealEstate,
    getAggregateVehicles,
    getAggregateNetWorth,
    windowToPoints,
    sliceProjectionData,
    buildProjectionData,
    sortPositions,
    calculateEbayFees,
    calculateEbayNetProfit,
    calculateEtsyFees,
    calculateEtsyNetProfit,
    calculateFBFees,
    calculateFBNetProfit,
    US_MEDIAN_SAVINGS,
} = require('../../app/lib/finance-core');

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
        const rows = [['Header'], ['', 'AAPL', 'Apple Inc', '10', '175', '1750', '1400', '350', '25']];
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(0);
    });

    it('parses rows with Fidelity header correctly', () => {
        const rows = [
            ['Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Gain/Loss Dollar,Gain/Loss Percent'],
            ['Retirement,,No Symbol,5,50,250,200,50,25'],
            ['Test Account,AAPL,Apple Inc,10,175,1750,1400,350,25'],
        ];
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(1);
        expect(result.positions[0].symbol).toBe('AAPL');
        expect(result.positions[0].value).toBe(1750);
        expect(result.positions[0].quantity).toBe(10);
        expect(result.positions[0].lastPrice).toBe(175);
        expect(result.positions[0].costBasis).toBe(1400);
    });

    it('calculates pnlDollar when no gain columns', () => {
        const header = 'Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total';
        const csv = `${header}\nAcc,TSLA,Tesla,5,200,1000,800`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.positions[0].pnlDollar).toBe(200);
        expect(result.positions[0].pnlPercent).toBeCloseTo(25, 1);
    });

    it('stops parsing at "The data" disclaimer rows', () => {
        const csv = `Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Gain/Loss Dollar,Gain/Loss Percent\nAcc,AAPL,Apple,10,175,1750,1400,350,25\nThe data information,,,,,,`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(1);
    });

    it('skips rows where current value NaN', () => {
        const csv = `Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Gain/Loss Dollar,Gain/Loss Percent\nAcc,AAPL,Apple,10,175,notanumber,1400,350,25`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(0);
    });
});

// ─── parseChaseStatement ───────────────────────────────────────────────────────

describe('parseChaseStatement', () => {
    it('parses Chase transaction format with headers', () => {
        const rows = [
            ['Date', 'Description', 'Memo', 'Amount'],
            ['2024-01-01', 'Coffee', 'WF', '-5'],
        ];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(1);
        expect(result.positions[0].symbol).toBe('Coffee');
        expect(result.positions[0].value).toBe(-5);
    });

    it('excludes non-positive transactions', () => {
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
    it('counts debit amounts outflow', () => {
        const csv = 'Card No.,Date,Description,Category,Debit,Credit\n1234,2024-01-01,Coffee,Food,5.50,\n1234,2024-01-02,Payment,,, 100.00';
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

    it('skips rows shorter debit column index', () => {
        const rows = [
            ['Card No.', 'Date', 'Desc', 'Cat', 'Debit', 'Credit'],
            ['1234', '2024-01-01'],
        ];
        const result = parseCapitalOneStatement(rows);
        expect(result.imported).toBe(0);
    });
});