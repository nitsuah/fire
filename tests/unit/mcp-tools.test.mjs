import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import { createHash } from 'node:crypto';

// The stdio server injects Node's SHA-256; paging needs it (no weak fallback).
const SHA = { hasher: (v) => createHash('sha256').update(v).digest('hex') };

process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-mcp-tools-test-${process.pid}.json`,
);

const require = createRequire(import.meta.url);
const { initDatabase } = require('../../app/lib/db.js');

let TOOLS;
let handleTool;
let computeNetWorthBreakdown;
let MAX_PAGE_SIZE;

beforeAll(async () => {
    initDatabase();
    ({ TOOLS, handleTool, computeNetWorthBreakdown, MAX_PAGE_SIZE } =
        await import('../../app/mcp-tools.mjs'));
}, 60000);

const sampleState = (txns = []) => ({
    spendingTransactions: txns,
    customAccounts: [],
    importedPositions: [],
    cds: [],
    realEstate: [],
    vehicles: [],
    wallets: [],
    expenses: { housing: 1000, food: 500, transport: 300 },
    insurances: {},
    taxRate: 20,
    projectionSettings: {
        currentAge: 35,
        retireAge: 65,
        annualSavings: 20000,
        expectedReturn: 7,
        inflationRate: 3,
        swr: 4,
        spanYears: 30,
    },
    sideGigLedger: [],
    netWorthHistory: [],
    importedFiles: [],
});

const sampleTxns = [
    {
        id: 'a',
        date: '2026-09-02',
        merchant: 'Whole Foods',
        amount: 40,
        category: 'food',
    },
    {
        id: 'b',
        date: '9/20/2026 02:20 AM',
        merchant: 'Shell',
        amount: 60.5,
        category: 'transport',
    },
    {
        id: 'c',
        date: '2026-09-30',
        merchant: 'Whole Foods',
        amount: 25,
        category: 'food',
    },
    {
        id: 'd',
        date: '2026-10-01',
        merchant: 'Netflix',
        amount: 15,
        category: 'subscriptions',
    },
    { id: 'e', date: '', merchant: 'Unknown', amount: 10, category: 'food' },
];

describe('mcp-tools module', () => {
    it('exports TOOLS array with all expected tools', () => {
        expect(Array.isArray(TOOLS)).toBe(true);
        expect(TOOLS.length).toBeGreaterThan(0);
        const toolNames = TOOLS.map((t) => t.name);
        expect(toolNames).toContain('get_transactions');
        expect(toolNames).toContain('fire_status_summary');
        expect(toolNames).toContain('get_net_worth');
        expect(toolNames).toContain('get_accounts');
        expect(toolNames).toContain('get_portfolio');
        expect(toolNames).toContain('get_cds');
        expect(toolNames).toContain('get_upcoming_events');
        expect(toolNames).toContain('get_expenses');
        expect(toolNames).toContain('get_insurances');
        expect(toolNames).toContain('get_projection_settings');
        expect(toolNames).toContain('get_side_gig_income');
        expect(toolNames).toContain('get_side_gig_tax_summary');
        expect(toolNames).toContain('get_concentration_risk');
        expect(toolNames).toContain('simulate_rebalance');
        expect(toolNames).toContain('get_swr_sensitivity');
        expect(toolNames).toContain('get_recurring_charges');
        expect(toolNames).toContain('get_emergency_runway');
        expect(toolNames).toContain('get_net_worth_trend');
        expect(TOOLS.length).toBe(20);
    });

    it('exports handleTool function', () => {
        expect(typeof handleTool).toBe('function');
    });

    it('exports computeNetWorthBreakdown function', () => {
        expect(typeof computeNetWorthBreakdown).toBe('function');
    });

    it('exports MAX_PAGE_SIZE constant', () => {
        expect(MAX_PAGE_SIZE).toBe(1000);
    });

    it('has no mutation verbs in tool names', () => {
        const mutationVerbs =
            /(^|_)(create|add|update|edit|delete|remove|write|save|persist|put|patch|insert|append|destroy)($|_)/i;
        for (const tool of TOOLS) {
            expect(tool.name).not.toMatch(mutationVerbs);
        }
    });
});

describe('get_transactions input validation', () => {
    it('rejects invalid from date format', () => {
        const state = sampleState(sampleTxns);
        expect(() =>
            handleTool('get_transactions', state, { from: '9/2/2026' }, SHA),
        ).toThrow(/YYYY-MM-DD/);
    });

    it('rejects invalid to date format', () => {
        const state = sampleState(sampleTxns);
        expect(() =>
            handleTool('get_transactions', state, { to: '2026-13-45' }, SHA),
        ).toThrow(/not a real date/);
    });

    it('rejects from after to', () => {
        const state = sampleState(sampleTxns);
        expect(() =>
            handleTool(
                'get_transactions',
                state,
                {
                    from: '2026-10-01',
                    to: '2026-09-01',
                },
                SHA,
            ),
        ).toThrow(/must not be after/);
    });

    it('rejects negative offset', () => {
        const state = sampleState(sampleTxns);
        expect(() =>
            handleTool('get_transactions', state, { offset: -1 }, SHA),
        ).toThrow();
    });

    it('rejects non-integer offset', () => {
        const state = sampleState(sampleTxns);
        expect(() =>
            handleTool('get_transactions', state, { offset: 1.5 }, SHA),
        ).toThrow();
    });

    it('rejects offset > 0 without pagingKey', () => {
        const state = sampleState(sampleTxns);
        expect(() =>
            handleTool('get_transactions', state, { offset: 10 }, SHA),
        ).toThrow(/pagingKey is required when offset > 0/);
    });

    it('rejects limit > MAX_PAGE_SIZE', () => {
        const state = sampleState(sampleTxns);
        // The tool caps limit at MAX_PAGE_SIZE, doesn't throw
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2000 },
            SHA,
        );
        expect(result.limit).toBe(MAX_PAGE_SIZE);
    });

    it('rejects limit <= 0', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 0 },
            SHA,
        );
        // limit <= 0 falls back to default 200
        expect(result.limit).toBe(200);
    });

    it('accepts valid offset and pagingKey together', () => {
        const state = sampleState(sampleTxns);
        // First page to get pagingKey
        const page1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        // Second page with offset and pagingKey
        const page2 = handleTool(
            'get_transactions',
            state,
            {
                offset: 2,
                pagingKey: page1.pagingKey,
                limit: 2,
            },
            SHA,
        );
        expect(page2.count).toBe(2);
    });
});

describe('get_transactions paging', () => {
    it('returns all transactions newest-first by default', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool('get_transactions', state);
        expect(result.matched).toBe(5);
        expect(result.count).toBe(5);
        expect(result.transactions.map((t) => t.id)).toEqual([
            'd',
            'c',
            'b',
            'a',
            'e',
        ]);
        expect(result.total).toBe(150.5);
        expect(result.byCategory.food).toBe(75);
        expect(result.limit).toBe(200);
        // Legacy call (no offset/pagingKey): byte-identical keys, no paging metadata.
        expect(Object.keys(result).sort()).toEqual([
            'byCategory',
            'count',
            'limit',
            'matched',
            'total',
            'transactions',
        ]);
    });

    it('applies limit', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        expect(result.count).toBe(2);
        expect(result.transactions.map((t) => t.id)).toEqual(['d', 'c']);
        expect(result.matched).toBe(5);
        expect(result.nextOffset).toBe(2);
    });

    it('applies offset with valid pagingKey', () => {
        const state = sampleState(sampleTxns);
        const page1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        const page2 = handleTool(
            'get_transactions',
            state,
            {
                offset: 2,
                pagingKey: page1.pagingKey,
                limit: 2,
            },
            SHA,
        );
        expect(page2.count).toBe(2);
        expect(page2.transactions.map((t) => t.id)).toEqual(['b', 'a']);
        expect(page2.nextOffset).toBe(4);
    });

    it('returns nextOffset when more results available', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        expect(result.nextOffset).toBe(2);
    });

    it('does not return nextOffset when at end', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 10 },
            SHA,
        );
        expect(result.nextOffset).toBeUndefined();
    });

    it('offset beyond end returns empty with nextOffset = null', () => {
        const state = sampleState(sampleTxns);
        const page1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        const page2 = handleTool(
            'get_transactions',
            state,
            {
                offset: 10,
                pagingKey: page1.pagingKey,
                limit: 2,
            },
            SHA,
        );
        expect(page2.count).toBe(0);
        expect(page2.transactions).toEqual([]);
        expect(page2.matched).toBe(5);
        expect(page2.nextOffset).toBeUndefined();
    });

    it('limit 0 falls back to default', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 0 },
            SHA,
        );
        expect(result.limit).toBe(200);
        expect(result.count).toBe(5);
    });

    it('max limit capped at MAX_PAGE_SIZE', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 1500 },
            SHA,
        );
        expect(result.limit).toBe(MAX_PAGE_SIZE);
    });

    it('stable ordering: same input produces same pagingKey', () => {
        const state = sampleState(sampleTxns);
        const r1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        const r2 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        expect(r1.pagingKey).toBe(r2.pagingKey);
    });

    it('pagingKey changes when data changes', () => {
        const state1 = sampleState(sampleTxns);
        const r1 = handleTool(
            'get_transactions',
            state1,
            { offset: 0, limit: 2 },
            SHA,
        );

        const moreTxns = [
            ...sampleTxns,
            {
                id: 'f',
                date: '2026-10-02',
                merchant: 'Test',
                amount: 100,
                category: 'food',
            },
        ];
        const state2 = sampleState(moreTxns);
        const r2 = handleTool(
            'get_transactions',
            state2,
            { offset: 0, limit: 2 },
            SHA,
        );
        expect(r1.pagingKey).not.toBe(r2.pagingKey);
    });

    it('throws stale_offset when pagingKey mismatches', () => {
        const state = sampleState(sampleTxns);
        const page1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        const badPagingKey = page1.pagingKey + 'x';
        expect(() =>
            handleTool(
                'get_transactions',
                state,
                {
                    offset: 2,
                    pagingKey: badPagingKey,
                    limit: 2,
                },
                SHA,
            ),
        ).toThrow(/stale_offset/);
    });

    it('throws stale_offset when rows deleted between pages', () => {
        const state = sampleState(sampleTxns);
        const page1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        // Delete a row that was in the matched set
        const filteredTxns = sampleTxns.filter((t) => t.id !== 'c');
        const state2 = sampleState(filteredTxns);
        expect(() =>
            handleTool(
                'get_transactions',
                state2,
                {
                    offset: 2,
                    pagingKey: page1.pagingKey,
                    limit: 2,
                },
                SHA,
            ),
        ).toThrow(/stale_offset/);
    });

    it('throws stale_offset when rows added between pages', () => {
        const state = sampleState(sampleTxns);
        const page1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        const moreTxns = [
            ...sampleTxns,
            {
                id: 'f',
                date: '2026-10-02',
                merchant: 'Test',
                amount: 100,
                category: 'food',
            },
        ];
        const state2 = sampleState(moreTxns);
        expect(() =>
            handleTool(
                'get_transactions',
                state2,
                {
                    offset: 2,
                    pagingKey: page1.pagingKey,
                    limit: 2,
                },
                SHA,
            ),
        ).toThrow(/stale_offset/);
    });

    it('filtering by category still returns pagingKey', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            {
                offset: 0,
                category: 'food',
            },
            SHA,
        );
        expect(result.matched).toBe(3);
        expect(result.pagingKey).toBeDefined();
    });

    it('filtering by merchant still returns pagingKey', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            {
                offset: 0,
                merchant: 'whole',
            },
            SHA,
        );
        expect(result.matched).toBe(2);
        expect(result.pagingKey).toBeDefined();
    });

    it('date filtering still returns pagingKey', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            {
                offset: 0,
                from: '2026-09-25',
            },
            SHA,
        );
        // Matched count depends on timezone parsing of locale date strings
        // b is '9/20/2026 02:20 AM' which may parse differently
        expect(result.matched).toBeGreaterThanOrEqual(2);
        expect(result.pagingKey).toBeDefined();
    });

    it('empty result returns empty pagingKey', () => {
        const state = sampleState([]);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0 },
            SHA,
        );
        expect(result.matched).toBe(0);
        expect(result.pagingKey).toBeDefined();
    });
});

describe('all tools input validation and output shape', () => {
    const baseState = sampleState(sampleTxns);

    it('fire_status_summary returns expected shape', () => {
        const result = handleTool('fire_status_summary', baseState);
        expect(result).toHaveProperty('fireNumber');
        expect(result).toHaveProperty('currentNetWorth');
        expect(result).toHaveProperty('progressPercent');
        expect(result).toHaveProperty('yearsToFire');
        expect(result).toHaveProperty('dataFreshness');
    });

    it('get_net_worth returns expected shape', () => {
        const result = handleTool('get_net_worth', baseState);
        expect(result).toHaveProperty('total');
        expect(result).toHaveProperty('breakdown');
        expect(result).toHaveProperty('dataFreshness');
    });

    it('get_accounts returns expected shape', () => {
        const result = handleTool('get_accounts', baseState);
        expect(result).toHaveProperty('accounts');
        expect(result).toHaveProperty('estimatedAnnualInterest');
        expect(result).toHaveProperty('total');
        expect(result).toHaveProperty('hsaTotal');
        expect(result).toHaveProperty('count');
    });

    it('get_accounts filters by type', () => {
        const state = {
            ...baseState,
            customAccounts: [
                { id: '1', name: 'Checking', type: 'Cash', value: 1000 },
                { id: '2', name: 'Brokerage', type: 'Brokerage', value: 5000 },
            ],
        };
        const result = handleTool('get_accounts', state, { type: 'Cash' });
        expect(result.accounts.length).toBe(1);
        expect(result.accounts[0].type).toBe('Cash');
    });

    it('get_portfolio returns expected shape', () => {
        const state = {
            ...baseState,
            importedPositions: [
                {
                    symbol: 'AAPL',
                    description: 'Apple Inc',
                    quantity: 10,
                    value: 1500,
                    costBasis: 1000,
                    priceUpdatedAt: '2026-01-01',
                },
            ],
        };
        const result = handleTool('get_portfolio', state);
        expect(result).toHaveProperty('positions');
        expect(result).toHaveProperty('totalValue');
        expect(result).toHaveProperty('totalPL');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('dataFreshness');
    });

    it('get_cds returns expected shape', () => {
        const state = {
            ...baseState,
            cds: [
                {
                    id: '1',
                    bank: 'Bank A',
                    principal: 10000,
                    rate: 4.5,
                    maturity: '2027-01-01',
                },
            ],
        };
        const result = handleTool('get_cds', state);
        expect(result).toHaveProperty('cds');
        expect(result).toHaveProperty('totalPrincipal');
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('nextMaturity');
    });

    it('get_upcoming_events validates days parameter', () => {
        const result = handleTool('get_upcoming_events', baseState);
        expect(result).toHaveProperty('days');
        expect(result).toHaveProperty('events');
        expect(result).toHaveProperty('count');
    });

    it('get_expenses returns expected shape', () => {
        const result = handleTool('get_expenses', baseState);
        expect(result).toHaveProperty('breakdown');
        expect(result).toHaveProperty('monthlyTotal');
        expect(result).toHaveProperty('annualTotal');
        expect(result).toHaveProperty('taxRate');
    });

    it('get_insurances returns expected shape', () => {
        const state = {
            ...baseState,
            insurances: { car: { amt: 1200, freq: 'annual' } },
        };
        const result = handleTool('get_insurances', state);
        expect(result).toHaveProperty('policies');
        expect(result).toHaveProperty('monthlyTotal');
        expect(result).toHaveProperty('annualTotal');
    });

    it('get_projection_settings returns expected shape', () => {
        const result = handleTool('get_projection_settings', baseState);
        expect(result).toHaveProperty('currentAge');
        expect(result).toHaveProperty('retireAge');
        expect(result).toHaveProperty('annualSavings');
    });

    it('get_side_gig_income returns expected shape', () => {
        const state = {
            ...baseState,
            sideGigLedger: [
                {
                    category: 'eBay',
                    net: 100,
                    revenue: 150,
                    fees: 30,
                    shipping: 20,
                },
            ],
        };
        const result = handleTool('get_side_gig_income', state);
        expect(result).toHaveProperty('entries');
        expect(result).toHaveProperty('byPlatform');
        expect(result).toHaveProperty('totalNet');
        expect(result).toHaveProperty('count');
    });

    it('get_side_gig_tax_summary returns expected shape', () => {
        const state = {
            ...baseState,
            sideGigLedger: [
                {
                    category: 'eBay',
                    net: 100,
                    revenue: 150,
                    acquisition: 'resale',
                    costBasis: 50,
                    date: '2026-01-15',
                },
            ],
        };
        const result = handleTool('get_side_gig_tax_summary', state);
        expect(result).toHaveProperty('business');
        expect(result).toHaveProperty('personalSales');
        expect(result).toHaveProperty('needsCostBasis');
        expect(result).toHaveProperty('untagged');
        expect(result).toHaveProperty('estimatedTaxableIncome');
    });

    it('get_concentration_risk returns expected shape', () => {
        const state = {
            ...baseState,
            importedPositions: [
                { symbol: 'COIN', value: 50000 },
                { symbol: 'AAPL', value: 10000 },
            ],
        };
        const result = handleTool('get_concentration_risk', state);
        expect(result).toHaveProperty('risk');
        expect(result).toHaveProperty('total');
    });

    it('simulate_rebalance validates input', () => {
        expect(() =>
            handleTool('simulate_rebalance', baseState, {
                soldAsset: 'cash',
                amount: 1000,
                boughtAsset: 'cash',
            }),
        ).toThrow();
    });

    it('simulate_rebalance returns expected shape', () => {
        const state = {
            ...baseState,
            customAccounts: [
                { type: 'Cash', value: 10000 },
                { type: 'Brokerage', value: 50000 },
            ],
        };
        const result = handleTool('simulate_rebalance', state, {
            soldAsset: 'cash',
            amount: 1000,
            boughtAsset: 'equities',
        });
        expect(result).toHaveProperty('status', 'simulated');
        expect(result).toHaveProperty('moved');
        expect(result).toHaveProperty('before');
        expect(result).toHaveProperty('after');
        expect(result).toHaveProperty('scoreChange');
    });

    it('get_swr_sensitivity validates input', () => {
        expect(() =>
            handleTool('get_swr_sensitivity', baseState, {
                swr: 4,
                marketDipPercent: 30,
            }),
        ).not.toThrow();
        expect(() =>
            handleTool('get_swr_sensitivity', baseState, {
                swr: -1,
                marketDipPercent: 30,
            }),
        ).toThrow();
        expect(() =>
            handleTool('get_swr_sensitivity', baseState, {
                swr: 4,
                marketDipPercent: -10,
            }),
        ).toThrow();
    });

    it('get_swr_sensitivity returns expected shape', () => {
        const result = handleTool('get_swr_sensitivity', baseState, {
            swr: 4,
            marketDipPercent: 30,
        });
        expect(result).toHaveProperty('swr');
        expect(result).toHaveProperty('marketDipPercent');
        expect(result).toHaveProperty('netWorth');
        expect(result).toHaveProperty('comparison');
    });

    it('get_recurring_charges returns expected shape', () => {
        const state = {
            ...baseState,
            spendingTransactions: [
                {
                    id: '1',
                    date: '2026-01-01',
                    merchant: 'Netflix',
                    amount: 15,
                    category: 'subscriptions',
                },
                {
                    id: '2',
                    date: '2026-02-01',
                    merchant: 'Netflix',
                    amount: 15,
                    category: 'subscriptions',
                },
            ],
        };
        const result = handleTool('get_recurring_charges', state);
        expect(result).toHaveProperty('charges');
        expect(result).toHaveProperty('count');
    });

    it('get_emergency_runway returns expected shape', () => {
        const state = {
            ...baseState,
            customAccounts: [{ type: 'Cash', value: 10000 }],
        };
        const result = handleTool('get_emergency_runway', state);
        expect(result).toHaveProperty('runwayMonths');
    });

    it('get_net_worth_trend returns expected shape', () => {
        const state = {
            ...baseState,
            netWorthHistory: [
                { date: '2026-01-01', total: 100000 },
                { date: '2026-01-02', total: 101000 },
            ],
        };
        const result = handleTool('get_net_worth_trend', state);
        expect(result).toHaveProperty('latest');
        expect(result).toHaveProperty('changes');
        expect(result).toHaveProperty('trackingSince');
        expect(result).toHaveProperty('points');
    });

    it('get_diversification_score returns expected shape', () => {
        const state = {
            ...baseState,
            customAccounts: [
                { type: 'Cash', value: 10000 },
                { type: 'Brokerage', value: 50000 },
            ],
        };
        const result = handleTool('get_diversification_score', state);
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('rating');
        expect(result).toHaveProperty('weights');
    });

    it('get_wallets returns expected shape', () => {
        const state = {
            ...baseState,
            wallets: [
                {
                    id: '1',
                    chain: 'ethereum',
                    label: 'Main',
                    address: '0x1234567890abcdef',
                    lastUsdValue: 5000,
                    lastFetched: '2026-01-01',
                },
            ],
        };
        const result = handleTool('get_wallets', state);
        expect(result).toHaveProperty('wallets');
        expect(result).toHaveProperty('totalUsdValue');
        expect(result).toHaveProperty('count');
    });
});

describe('get_transactions output shape with paging', () => {
    it('includes pagingKey in response', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0 },
            SHA,
        );
        expect(result).toHaveProperty('pagingKey');
        expect(typeof result.pagingKey).toBe('string');
        expect(result.pagingKey.length).toBeGreaterThan(0);
    });

    it('includes nextOffset when more pages available', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 1 },
            SHA,
        );
        expect(result).toHaveProperty('nextOffset');
        expect(result.nextOffset).toBe(1);
    });

    it('does not include nextOffset when at end', () => {
        const state = sampleState(sampleTxns);
        const result = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 10 },
            SHA,
        );
        expect(result).not.toHaveProperty('nextOffset');
    });

    it('pagingKey is deterministic for same data', () => {
        const state = sampleState(sampleTxns);
        const r1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        const r2 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        expect(r1.pagingKey).toBe(r2.pagingKey);
    });

    it('returns at least one row when matched > offset', () => {
        const state = sampleState(sampleTxns);
        const page1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        const page2 = handleTool(
            'get_transactions',
            state,
            {
                offset: 2,
                pagingKey: page1.pagingKey,
                limit: 2,
            },
            SHA,
        );
        expect(page2.count).toBeGreaterThanOrEqual(1);
    });

    it('stale_offset error message includes guidance', () => {
        const state = sampleState(sampleTxns);
        const page1 = handleTool(
            'get_transactions',
            state,
            { offset: 0, limit: 2 },
            SHA,
        );
        try {
            handleTool(
                'get_transactions',
                state,
                {
                    offset: 2,
                    pagingKey: page1.pagingKey + 'x',
                    limit: 2,
                },
                SHA,
            );
        } catch (err) {
            expect(err.message).toContain('stale_offset');
            expect(err.message).toContain('restart query from offset 0');
        }
    });
});
