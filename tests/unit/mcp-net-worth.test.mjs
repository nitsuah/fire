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
