import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';

// mcp-server.mjs requires app/lib/db.js, which reads FIRE_DB_FILE at load.
process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-mcp-net-worth-test-${process.pid}.json`,
);

let handleTool;
beforeAll(async () => {
    ({ handleTool } = await import('../../app/mcp-server.mjs'));
}, 60000);

describe('MCP get_net_worth', () => {
    it('puts metals in otherAssets and floors underwater equity at $0 like the dashboard', () => {
        const r = handleTool('get_net_worth', {
            customAccounts: [
                { type: 'Savings', value: 1000 },
                { type: 'Metal', value: 500 },
            ],
            realEstate: [
                { marketValue: 300000, mortgageBalance: 200000 },
                { marketValue: 100000, mortgageBalance: 150000 }, // underwater
            ],
            vehicles: [
                { currentValue: 20000, loanBalance: 5000 },
                { currentValue: 10000, loanBalance: 25000 }, // underwater
            ],
            sideGigLedger: [{ net: 999 }], // income, never an asset
        });
        expect(r.breakdown.cash).toBe(1000);
        expect(r.breakdown.otherAssets).toBe(500);
        expect(r.breakdown.realEstate).toBe(100000);
        expect(r.breakdown.vehicles).toBe(15000);
        expect(r.total).toBe(116500);
    });
});

describe('MCP get_accounts', () => {
    it('reports estimated interest from savings, active CDs and staking', () => {
        const r = handleTool('get_accounts', {
            customAccounts: [
                { type: 'Savings', value: 10000, apy: 4 },
                { type: 'Crypto', value: 5000, apy: 10 },
            ],
            cds: [
                { principal: 10000, rate: 5, maturity: '2099-01-01' },
                { principal: 10000, rate: 5, maturity: '2000-01-01' }, // matured
            ],
        });
        expect(r.estimatedAnnualInterest).toEqual({
            savings: 400,
            cds: 500,
            staking: 500,
            total: 1400,
        });
    });
});

describe('MCP diversification, SWR sensitivity and rebalance tools', () => {
    const state = {
        importedPositions: [
            { symbol: 'COIN', description: '', value: 60000 },
            { symbol: 'VTI', description: '', value: 10000 },
        ],
        customAccounts: [
            { type: 'Savings', value: 20000 },
            { type: 'Crypto', value: 5000 },
            { type: 'Metal', value: 5000 },
        ],
        cds: [],
        expenses: { food: 1000 },
        insurances: {},
        taxRate: 0,
    };

    it('scores diversification and penalizes a single position over 20%', () => {
        const r = handleTool('get_diversification_score', state);
        expect(r.weights).toMatchObject({
            equities: 70,
            cash: 20,
            crypto: 5,
            metals: 5,
        });
        expect(r.largestPosition).toEqual({
            symbol: 'COIN',
            pctOfNetWorth: 60,
        });
        expect(r.concentrationPenalty).toBe(40);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.rating).toBe('concentrated');
    });

    it('reports no score for an empty portfolio', () => {
        expect(handleTool('get_diversification_score', {}).score).toBeNull();
    });

    it('stress-tests withdrawals after a market dip on market-priced assets only', () => {
        const r = handleTool('get_swr_sensitivity', state, {
            swr: 4,
            marketDipPercent: 50,
        });
        // Exposed: equities 70k + crypto 5k + metals 5k = 80k; cash 20k held.
        expect(r.netWorth).toBe(100000);
        expect(r.marketExposed).toBe(80000);
        expect(r.netWorthAfterDip).toBe(60000);
        expect(r.annualExpenses).toBe(12000);
        expect(r.withdrawalBeforeDip).toBe(4000);
        expect(r.withdrawalAfterDip).toBe(2400);
        expect(r.shortfallAfterDip).toBe(9600);
        expect(r.fireNumberAtSwr).toBe(300000);
        expect(r.comparison.map((c) => c.swr)).toEqual([3, 3.5, 4, 4.5, 5]);
        expect(() =>
            handleTool('get_swr_sensitivity', state, {
                swr: 0,
                marketDipPercent: 10,
            }),
        ).toThrow(/Invalid input/);
    });

    it('simulates moving money between asset classes without saving anything', () => {
        const r = handleTool('simulate_rebalance', state, {
            soldAsset: 'equities',
            amount: 30000,
            boughtAsset: 'cds',
        });
        expect(r.before.weightsPct.equities).toBe(70);
        expect(r.after.weightsPct.equities).toBe(40);
        expect(r.after.weightsPct.cds).toBe(30);
        expect(r.scoreChange).toBe(r.after.score - r.before.score);
        expect(r.after.score).toBeGreaterThan(r.before.score);
        expect(() =>
            handleTool('simulate_rebalance', state, {
                soldAsset: 'cash',
                amount: 999999,
                boughtAsset: 'cds',
            }),
        ).toThrow(/exceeds/);
        expect(() =>
            handleTool('simulate_rebalance', state, {
                soldAsset: 'stocks',
                amount: 1,
                boughtAsset: 'cds',
            }),
        ).toThrow(/Invalid input/);
    });

    it('no longer advertises tools that had nothing behind them', async () => {
        const { TOOLS } = await import('../../app/mcp-server.mjs');
        const names = TOOLS.map((t) => t.name);
        for (const gone of [
            'get_market_correlation',
            'get_dividend_forecast',
            'auto_reconcile_csv',
            'set_price_target_alert',
        ])
            expect(names).not.toContain(gone);
    });
});
