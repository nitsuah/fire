import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';

// mcp-server.mjs requires app/lib/db.js, which reads FIRE_DB_FILE at load.
process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-rebalance-sweep-test-${process.pid}.json`,
);

const require = createRequire(import.meta.url);
const { sweepRebalances } = require('../../app/lib/rebalance-sweep.js');

let handleTool;
beforeAll(async () => {
    ({ handleTool } = await import('../../app/mcp-server.mjs'));
}, 60000);

const state = {
    importedPositions: [
        { symbol: 'COIN', description: '', value: 60000, costBasis: 20000 },
        { symbol: 'VTI', description: '', value: 10000, costBasis: 8000 },
    ],
    customAccounts: [
        { type: 'Savings', value: 20000 },
        { type: 'Crypto', value: 5000 },
        { type: 'Metal', value: 5000 },
    ],
    cds: [],
};

const find = (r, id, bought, fractionPct) =>
    r.rows.find(
        (x) =>
            x.sold.id === id &&
            x.bought === bought &&
            x.fractionPct === fractionPct,
    );

describe('sweepRebalances', () => {
    it('enumerates liquid classes and top positions at each size, with no verdict', () => {
        const r = sweepRebalances(state, { limit: 500 });
        // sellers: cash, equities, crypto, metals + COIN, VTI; 4 buyers each; 4 sizes
        expect(r.totalRows).toBe(6 * 4 * 4);
        expect(r.rows).toHaveLength(96);
        const keys = JSON.stringify(Object.keys(r)) + JSON.stringify(r.rows[0]);
        expect(keys).not.toMatch(/best|recommend|optimal/i);
        expect(r.assumptions.defaultReturnsArePlaceholders).toBe(true);
        // a position never "buys" its own class
        expect(
            r.rows.some(
                (x) => x.sold.kind === 'position' && x.bought === 'equities',
            ),
        ).toBe(false);
    });

    it('ranks by the metric the caller picks, and honours limit', () => {
        const byBase = sweepRebalances(state, {
            rankBy: 'baseDelta',
            limit: 10,
        });
        expect(byBase.rows).toHaveLength(10);
        for (let i = 1; i < byBase.rows.length; i++) {
            expect(byBase.rows[i - 1].baseDelta).toBeGreaterThanOrEqual(
                byBase.rows[i].baseDelta,
            );
        }
        const byTax = sweepRebalances(state, { rankBy: 'taxCost', limit: 500 });
        expect(byTax.rankedBy).toEqual({ metric: 'taxCost', order: 'asc' });
        for (let i = 1; i < byTax.rows.length; i++) {
            expect(byTax.rows[i - 1].taxCost).toBeLessThanOrEqual(
                byTax.rows[i].taxCost,
            );
        }
    });

    it('taxes realized gains at the supplied flat rate, and flags unknown basis', () => {
        const r = sweepRebalances(state, {
            limit: 500,
            capGainsRatePct: 15,
        });
        const coin = find(r, 'COIN', 'cash', 100);
        expect(coin.amount).toBe(60000);
        expect(coin.realizedGain).toBe(40000);
        expect(coin.taxCost).toBe(6000);
        expect(coin.taxBasis).toBe('estimated');
        // cash has basis == value, so no gain; crypto has no tracked basis
        expect(find(r, 'cash', 'equities', 50).taxCost).toBe(0);
        const crypto = find(r, 'crypto', 'cash', 100);
        expect(crypto.taxBasis).toBe('unknown');
        expect(crypto.taxCost).toBe(0);
    });

    it('uses per-symbol return overrides', () => {
        const returns = {
            symbols: { COIN: { bear: -0.5, base: 0, bull: 0 } },
        };
        const r = sweepRebalances(state, { limit: 500, returns });
        const sell = find(r, 'COIN', 'cash', 100);
        // 60k -> 6k tax -> 54k at 3% = 55,620 vs holding COIN down 50% = 30,000
        expect(sell.bearDelta).toBe(25620);
        expect(sell.value1y.bear).toBeGreaterThan(r.hold.value1y.bear);
    });

    it('cuts the largest-position share when the top position is trimmed', () => {
        const r = sweepRebalances(state, { limit: 500 });
        const trim = find(r, 'COIN', 'cash', 50);
        expect(trim.largestPositionPct).toBeLessThan(r.hold.largestPositionPct);
    });

    it('rejects bad options', () => {
        expect(() => sweepRebalances(state, { rankBy: 'vibes' })).toThrow(
            /Invalid input/,
        );
        expect(() => sweepRebalances(state, { fractions: [0] })).toThrow(
            /Invalid input/,
        );
        expect(() => sweepRebalances(state, { capGainsRatePct: 120 })).toThrow(
            /Invalid input/,
        );
        expect(() =>
            sweepRebalances(state, {
                returns: { symbols: { COIN: { bear: -1 } } },
            }),
        ).toThrow(/Invalid input/);
    });

    it('reports unavailable when there is nothing to move', () => {
        expect(sweepRebalances({}, {}).status).toBe('unavailable');
    });
});

describe('simulate_rebalance chaos flag', () => {
    it('sweeps without soldAsset/amount/boughtAsset', () => {
        const r = handleTool('simulate_rebalance', state, {
            chaos: true,
            options: { limit: 3, rankBy: 'bearDelta' },
        });
        expect(r.status).toBe('swept');
        expect(r.rows).toHaveLength(3);
    });

    it('leaves the single-move path unchanged', () => {
        expect(() => handleTool('simulate_rebalance', state, {})).toThrow(
            /Invalid input/,
        );
        const r = handleTool('simulate_rebalance', state, {
            soldAsset: 'equities',
            amount: 30000,
            boughtAsset: 'cds',
        });
        expect(r.status).toBe('simulated');
    });
});
