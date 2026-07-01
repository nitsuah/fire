import { describe, it, expect } from 'vitest';
import {
    sliceProjectionData,
    buildProjectionData,
} from '../../app/lib/finance-calcs.js';

// ─── sliceProjectionData missing branches ─────────────────────────────────────

describe('sliceProjectionData — null optional arrays', () => {
    const makeData = (n = 10) => ({
        labels: Array.from({ length: n }, (_, i) => `Y${i}`),
        nwData: Array.from({ length: n }, (_, i) => i * 1000),
        fireLine: Array.from({ length: n }, () => 500000),
        leanFireLine: Array.from({ length: n }, () => 375000),
        fatFireLine: Array.from({ length: n }, () => 625000),
        coastFireLine: Array.from({ length: n }, () => 200000),
        bullData: null,
        bearData: null,
        benchData: null,
        retirementLineIndex: -1,
        cdEvents: [],
        fireNumber: 500000,
    });

    it('returns empty arrays for null bullData/bearData/benchData', () => {
        const data = makeData(10);
        const sliced = sliceProjectionData(data, '5y');
        expect(sliced.bullData).toEqual([]);
        expect(sliced.bearData).toEqual([]);
        expect(sliced.benchData).toEqual([]);
    });

    it('returns all data when window is "all"', () => {
        const data = makeData(10);
        data.bullData = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const sliced = sliceProjectionData(data, 'all');
        expect(sliced.labels).toHaveLength(10);
    });

    it('keeps retirementLineIndex=-1 when already -1', () => {
        const data = makeData(10);
        data.retirementLineIndex = -1;
        const sliced = sliceProjectionData(data, '5y');
        expect(sliced.retirementLineIndex).toBe(-1);
    });
});

// ─── buildProjectionData — uncovered branches ─────────────────────────────────

const BASE = {
    importedPositions: [],
    customAccounts: [],
    cds: [],
    realEstate: [],
    vehicles: [],
    sideGigLedger: [],
    expenses: { housing: 1000, food: 300 },
    insurances: {},
    taxRate: 0,
    projectionSettings: {
        annualSavings: 10000,
        expectedReturn: 7.0,
        inflationRate: 2.0,
        swr: 4.0,
        spanYears: 5,
        currentAge: 35,
        retireAge: 60,
    },
};

describe('buildProjectionData — account type branches', () => {
    it('counts Brokerage accounts as equities', () => {
        const state = {
            ...BASE,
            customAccounts: [{ type: 'Brokerage', value: 50000 }],
        };
        const data = buildProjectionData(state, 0);
        expect(data.networth).toBe(50000);
    });

    it('counts Crypto accounts as equities', () => {
        const state = {
            ...BASE,
            customAccounts: [{ type: 'Crypto', value: 5000 }],
        };
        const data = buildProjectionData(state, 0);
        expect(data.networth).toBe(5000);
    });

    it('counts unknown account type as cash (other assets)', () => {
        const state = {
            ...BASE,
            customAccounts: [{ type: 'Pension', value: 20000 }],
        };
        const data = buildProjectionData(state, 0);
        expect(data.networth).toBe(20000);
    });

    it('counts SPAXX imported position as cash', () => {
        const state = {
            ...BASE,
            importedPositions: [
                { symbol: 'SPAXX', description: '', value: 8000 },
            ],
        };
        const data = buildProjectionData(state, 0);
        expect(data.networth).toBe(8000);
    });

    it('counts FDRXX as cash', () => {
        const state = {
            ...BASE,
            importedPositions: [
                { symbol: 'FDRXX', description: '', value: 3000 },
            ],
        };
        const data = buildProjectionData(state, 0);
        expect(data.networth).toBe(3000);
    });

    it('counts MONEY MARKET description as cash', () => {
        const state = {
            ...BASE,
            importedPositions: [
                { symbol: 'XX', description: 'MONEY MARKET FUND', value: 2500 },
            ],
        };
        const data = buildProjectionData(state, 0);
        expect(data.networth).toBe(2500);
    });

    it('counts equity position as equities', () => {
        const state = {
            ...BASE,
            importedPositions: [
                { symbol: 'AAPL', description: 'Apple', value: 15000 },
            ],
        };
        const data = buildProjectionData(state, 0);
        expect(data.networth).toBe(15000);
    });

    it('floors negative real estate equity at 0', () => {
        const state = {
            ...BASE,
            realEstate: [{ marketValue: 100000, mortgageBalance: 120000 }],
        };
        const data = buildProjectionData(state, 0);
        expect(data.networth).toBe(0);
    });

    it('floors negative vehicle equity at 0', () => {
        const state = {
            ...BASE,
            vehicles: [{ currentValue: 5000, loanBalance: 10000 }],
        };
        const data = buildProjectionData(state, 0);
        expect(data.networth).toBe(0);
    });
});

describe('buildProjectionData — coast FIRE target when retireAge <= currentAge', () => {
    it('uses fireNumber as coastFireTarget when no coast years', () => {
        const state = {
            ...BASE,
            projectionSettings: {
                ...BASE.projectionSettings,
                currentAge: 60,
                retireAge: 60,
            },
        };
        const data = buildProjectionData(state, 0);
        // coastYears = 0, so coastFireTarget = fireNumber
        expect(data.coastFireLine[0]).toBe(Math.round(data.fireNumber));
    });

    it('coastFireTarget is lower than fireNumber when coast years > 0', () => {
        const state = {
            ...BASE,
            customAccounts: [{ type: 'Cash', value: 100000 }],
            projectionSettings: {
                ...BASE.projectionSettings,
                currentAge: 35,
                retireAge: 60,
                expectedReturn: 8.0,
                swr: 4.0,
            },
        };
        const data = buildProjectionData(state, 0);
        expect(data.coastFireLine[0]).toBeLessThan(data.fireLine[0]);
    });
});

describe('buildProjectionData — scenarioOffset', () => {
    it('negative offset reduces ending net worth (bear scenario)', () => {
        const state = {
            ...BASE,
            customAccounts: [{ type: 'Cash', value: 50000 }],
        };
        const base = buildProjectionData(state, 0);
        const bear = buildProjectionData(state, -2);
        const last = base.nwData.length - 1;
        expect(bear.nwData[last]).toBeLessThan(base.nwData[last]);
    });
});

describe('buildProjectionData — insurance branches in _getAnnualExpensesTotal', () => {
    it('handles 6month car insurance', () => {
        const state = {
            ...BASE,
            insurances: {
                car: { amt: 600, freq: '6month' },
                home: { amt: 0, freq: 'monthly' },
            },
        };
        const data = buildProjectionData(state, 0);
        // 600/6 = 100/month extra vs 0 — just verify it runs and produces sane output
        expect(data.fireNumber).toBeGreaterThan(0);
    });

    it('handles annual home insurance', () => {
        const state = {
            ...BASE,
            insurances: {
                car: { amt: 0, freq: 'monthly' },
                home: { amt: 1200, freq: 'annual' },
            },
        };
        const data = buildProjectionData(state, 0);
        expect(data.fireNumber).toBeGreaterThan(0);
    });
});

describe('buildProjectionData — CD events', () => {
    it('excludes past CD maturities', () => {
        const state = {
            ...BASE,
            cds: [
                {
                    bank: 'Old',
                    principal: 5000,
                    rate: 4,
                    maturity: '2020-01-01',
                },
            ],
        };
        const data = buildProjectionData(state, 0);
        expect(data.cdEvents).toHaveLength(0);
    });

    it('excludes CD maturities beyond span', () => {
        const state = {
            ...BASE,
            cds: [
                {
                    bank: 'Far',
                    principal: 5000,
                    rate: 4,
                    maturity: '2099-01-01',
                },
            ],
        };
        const data = buildProjectionData(state, 0);
        expect(data.cdEvents).toHaveLength(0);
    });
});

describe('buildProjectionData — zero swr edge case', () => {
    it('returns non-zero fireNumber when swr is 0 (falls back to 4.0 default)', () => {
        // swr: 0 triggers the || 4.0 default in buildProjectionData
        const state = {
            ...BASE,
            projectionSettings: { ...BASE.projectionSettings, swr: 0 },
        };
        const data = buildProjectionData(state, 0);
        expect(data.fireNumber).toBeGreaterThan(0);
    });
});
