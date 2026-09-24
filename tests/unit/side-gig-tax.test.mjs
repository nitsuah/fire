import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import {
    SIDE_GIG_BASIS_TYPES,
    saleAmounts,
    localIsoDate,
    applyCostBasis,
    classifySideGigSale,
    summarizeSideGigTax,
    entryYear,
} from '../../app/lib/side-gig-tax.js';

// mcp-server.mjs requires app/lib/db.js, which reads FIRE_DB_FILE at load.
process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-side-gig-tax-test-${process.pid}.json`,
);

describe('classifySideGigSale', () => {
    it('leaves untagged entries uncomputed', () => {
        const c = classifySideGigSale({ revenue: 50, expenses: 5 });
        expect(c.basisType).toBeNull();
        expect(c.taxable).toBeNull();
        expect(c.needsBasis).toBe(false);
    });

    it('ignores unknown basis types', () => {
        expect(classifySideGigSale({ basisType: 'bogus' }).basisType).toBe(
            null,
        );
    });

    it('business: profit is taxable and losses stay negative', () => {
        const win = classifySideGigSale({
            basisType: 'business',
            revenue: 100,
            expenses: 15,
            costBasis: 40,
        });
        expect(win.taxable).toBe(45);
        const loss = classifySideGigSale({
            basisType: 'business',
            revenue: 30,
            expenses: 10,
            costBasis: 40,
        });
        expect(loss.taxable).toBe(-20);
    });

    it('business with no cost basis treats cost as already in expenses', () => {
        const c = classifySideGigSale({
            basisType: 'business',
            revenue: 100,
            expenses: 60,
        });
        expect(c.taxable).toBe(40);
        expect(c.needsBasis).toBe(false);
    });

    it('personal: gain is taxable, a loss is floored at zero', () => {
        const gain = classifySideGigSale({
            basisType: 'personal',
            revenue: 300,
            expenses: 30,
            costBasis: 200,
        });
        expect(gain.gain).toBe(70);
        expect(gain.taxable).toBe(70);
        const loss = classifySideGigSale({
            basisType: 'personal',
            revenue: 80,
            expenses: 10,
            costBasis: 400,
        });
        expect(loss.gain).toBe(-330);
        expect(loss.taxable).toBe(0);
    });

    it('personal/gift without a cost basis are flagged, not guessed', () => {
        for (const basisType of ['personal', 'gift']) {
            const c = classifySideGigSale({ basisType, revenue: 50 });
            expect(c.needsBasis).toBe(true);
            expect(c.taxable).toBeNull();
        }
    });

    it('treats a blank-string cost basis as unknown', () => {
        const c = classifySideGigSale({
            basisType: 'gift',
            revenue: 50,
            costBasis: '',
        });
        expect(c.needsBasis).toBe(true);
    });

    it('free: zero basis, proceeds after costs are the gain', () => {
        const c = classifySideGigSale({
            basisType: 'free',
            revenue: 120,
            expenses: 20,
            costBasis: 999, // ignored: free means $0 basis
        });
        expect(c.taxable).toBe(100);
    });

    it('reads legacy gross/fees field names', () => {
        const c = classifySideGigSale({
            basisType: 'free',
            gross: 40,
            fees: 5,
        });
        expect(c.revenue).toBe(40);
        expect(c.taxable).toBe(35);
    });

    it('exposes a label for every basis type', () => {
        expect(Object.keys(SIDE_GIG_BASIS_TYPES)).toEqual([
            'business',
            'personal',
            'gift',
            'free',
        ]);
    });
});

describe('saleAmounts', () => {
    it('treats a blank revenue as absent and falls back to gross', () => {
        expect(saleAmounts({ revenue: '', gross: 120 }).revenue).toBe(120);
        expect(saleAmounts({ revenue: 0, gross: 120 }).revenue).toBe(0);
        expect(saleAmounts({}).revenue).toBe(0);
    });
});

describe('localIsoDate', () => {
    it('uses the local calendar date, not UTC', () => {
        expect(localIsoDate(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
        expect(localIsoDate(new Date(2027, 0, 5))).toBe('2027-01-05');
    });
});

describe('applyCostBasis', () => {
    const legacy = {
        id: '1',
        desc: 'eBay Sale: $100 Item',
        category: 'eBay',
        revenue: 100,
        expenses: 55, // 15 fees/shipping + 40 item cost
        net: 45,
    };

    it('moves a legacy calculator row’s cost out of expenses exactly once', () => {
        const once = applyCostBasis(legacy, '40');
        expect(once).toMatchObject({ expenses: 15, costBasis: 40, net: 45 });
        const again = applyCostBasis(once, '40');
        expect(again).toMatchObject({ expenses: 15, costBasis: 40, net: 45 });
        const changed = applyCostBasis(again, '30');
        expect(changed).toMatchObject({ expenses: 25, costBasis: 30, net: 45 });
        expect(
            classifySideGigSale({ ...changed, basisType: 'business' }).taxable,
        ).toBe(45);
    });

    it('restores a legacy row when the cost is cleared', () => {
        const cleared = applyCostBasis(applyCostBasis(legacy, '40'), '');
        expect(cleared.expenses).toBe(55);
        expect('costBasis' in cleared).toBe(false);
        expect('legacyCostInExpenses' in cleared).toBe(false);
        expect(legacy.expenses).toBe(55); // input not mutated
    });

    it('leaves expenses alone on non-legacy rows', () => {
        const row = {
            category: 'eBay',
            desc: 'Lamp',
            revenue: 50,
            expenses: 5,
        };
        expect(applyCostBasis(row, '20')).toMatchObject({
            expenses: 5,
            costBasis: 20,
            net: 25,
        });
    });
});

describe('entryYear', () => {
    it('prefers date, then report range, then a Date.now() id', () => {
        expect(entryYear({ date: '2026-03-01' })).toBe(2026);
        expect(entryYear({ reportEnd: '2025-12-31' })).toBe(2025);
        expect(entryYear({ id: String(Date.UTC(2024, 5, 1)) })).toBe(2024);
        expect(entryYear({ id: 'ebay-csv-1-x_x' })).toBeNull();
    });
});

describe('summarizeSideGigTax', () => {
    const ledger = [
        {
            id: 'a',
            date: '2026-02-01',
            basisType: 'business',
            revenue: 100,
            expenses: 10,
            costBasis: 30,
        },
        {
            id: 'b',
            date: '2026-03-01',
            basisType: 'personal',
            revenue: 50,
            expenses: 5,
            costBasis: 300,
        },
        {
            id: 'c',
            date: '2026-04-01',
            basisType: 'free',
            revenue: 60,
            expenses: 10,
        },
        { id: 'd', date: '2026-05-01', basisType: 'gift', revenue: 25 },
        { id: 'e', date: '2025-06-01', revenue: 40 },
    ];

    it('buckets every sale and totals the estimate', () => {
        const s = summarizeSideGigTax(ledger);
        expect(s.business).toMatchObject({
            count: 1,
            revenue: 100,
            sellingCosts: 10,
            costBasis: 30,
            net: 60,
        });
        expect(s.personalSales).toMatchObject({
            count: 2,
            revenue: 110,
            taxableGains: 50,
            nonDeductibleLosses: 255,
        });
        expect(s.needsCostBasis).toEqual({ count: 1, revenue: 25 });
        expect(s.untagged).toEqual({ count: 1, revenue: 40 });
        expect(s.estimatedTaxableIncome).toBe(110);
        expect(s.year).toBeNull();
    });

    it('filters by year', () => {
        const s = summarizeSideGigTax(ledger, { year: 2025 });
        expect(s.year).toBe(2025);
        expect(s.untagged.count).toBe(1);
        expect(s.business.count).toBe(0);
        expect(s.estimatedTaxableIncome).toBe(0);
    });

    it('handles a missing ledger', () => {
        expect(summarizeSideGigTax(undefined).estimatedTaxableIncome).toBe(0);
    });
});

describe('MCP side gig tools', () => {
    let handleTool;
    let TOOLS;
    beforeAll(async () => {
        ({ handleTool, TOOLS } = await import('../../app/mcp-server.mjs'));
    }, 60000);

    const state = {
        sideGigLedger: [
            {
                id: '1',
                date: '2026-01-10',
                category: 'eBay',
                revenue: 50,
                expenses: 8,
                net: 42,
                basisType: 'free',
            },
            {
                id: '2',
                date: '2025-01-10',
                category: 'eBay',
                revenue: 20,
                expenses: 2,
                net: 18,
            },
        ],
    };

    it('registers get_side_gig_tax_summary', () => {
        expect(TOOLS.map((t) => t.name)).toContain('get_side_gig_tax_summary');
    });

    it('get_side_gig_income groups by category and sums revenue', () => {
        const r = handleTool('get_side_gig_income', state);
        expect(r.byPlatform.eBay).toEqual({ count: 2, gross: 70, net: 60 });
    });

    it('get_side_gig_tax_summary honours an integer year only', () => {
        const all = handleTool('get_side_gig_tax_summary', state, {
            year: 'x',
        });
        expect(all.year).toBeNull();
        const y = handleTool('get_side_gig_tax_summary', state, { year: 2026 });
        expect(y.estimatedTaxableIncome).toBe(42);
        expect(y.untagged.count).toBe(0);
    });
});
