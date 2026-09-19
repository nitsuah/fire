import { describe, it, expect } from 'vitest';
import {
    windowToPoints,
    sliceProjectionData,
    buildProjectionData,
    getAnnualExpensesTotal,
} from '../../app/lib/finance-core.js';

// ─── windowToPoints ────────────────────────────────────────────────────────────

describe('windowToPoints', () => {
    it('returns 2 for 1m', () => expect(windowToPoints('1m')).toBe(2));
    it('returns 2 for 1y', () => expect(windowToPoints('1y')).toBe(2));
    it('returns 6 for 5y', () => expect(windowToPoints('5y')).toBe(6));
    it('returns 11 for 10y', () => expect(windowToPoints('10y')).toBe(11));
    it('returns 16 for 15y', () => expect(windowToPoints('15y')).toBe(16));
    it('returns null for all', () => expect(windowToPoints('all')).toBeNull());
    it('returns null for unknown key', () =>
        expect(windowToPoints('foo')).toBeNull());
});

// ─── sliceProjectionData ───────────────────────────────────────────────────────

describe('sliceProjectionData', () => {
    const makeData = (n = 10) => ({
        labels: Array.from({ length: n }, (_, i) => `Year ${i}`),
        nwData: Array.from({ length: n }, (_, i) => i * 1000),
        fireLine: Array.from({ length: n }, () => 500000),
        leanFireLine: Array.from({ length: n }, () => 375000),
        fatFireLine: Array.from({ length: n }, () => 625000),
        coastFireLine: Array.from({ length: n }, () => 200000),
        bullData: Array.from({ length: n }, (_, i) => i * 1100),
        bearData: Array.from({ length: n }, (_, i) => i * 900),
        benchData: Array.from({ length: n }, () => 50000),
        retirementLineIndex: 5,
        cdEvents: [{ yearIndex: 3, label: 'CD Matures', amount: 10000 }],
        fireNumber: 500000,
    });

    it('returns all data for "all" window', () => {
        const data = makeData(10);
        const sliced = sliceProjectionData(data, 'all');
        expect(sliced.labels).toHaveLength(10);
    });

    it('slices to 6 points for 5y', () => {
        const data = makeData(10);
        const sliced = sliceProjectionData(data, '5y');
        expect(sliced.labels).toHaveLength(6);
        expect(sliced.nwData).toHaveLength(6);
        expect(sliced.fireLine).toHaveLength(6);
    });

    it('filters CD events outside the window', () => {
        const data = makeData(10);
        // cdEvent at yearIndex 3 - within 5y (6 points, indices 0-5)
        const sliced = sliceProjectionData(data, '5y');
        expect(sliced.cdEvents).toHaveLength(1);

        // slicing to 2 points: only indices 0-1 remain
        const sliced2 = sliceProjectionData(data, '1y');
        expect(sliced2.cdEvents).toHaveLength(0);
    });

    it('resets retirementLineIndex to -1 when out of range', () => {
        const data = makeData(10);
        // retirementLineIndex = 5, slicing to 2 points
        const sliced = sliceProjectionData(data, '1y');
        expect(sliced.retirementLineIndex).toBe(-1);
    });

    it('keeps retirementLineIndex when within range', () => {
        const data = makeData(10);
        data.retirementLineIndex = 3;
        const sliced = sliceProjectionData(data, '5y'); // 6 points, index 3 is within
        expect(sliced.retirementLineIndex).toBe(3);
    });
});

// ─── buildProjectionData ───────────────────────────────────────────────────────

describe('buildProjectionData', () => {
    const baseState = {
        importedPositions: [],
        customAccounts: [{ type: 'Cash', value: 100000 }],
        cds: [],
        realEstate: [],
        vehicles: [],
        sideGigLedger: [],
        expenses: {
            housing: 2000,
            food: 500,
            transport: 300,
            utilities: 200,
            healthcare: 150,
            discretionary: 400,
        },
        insurances: {
            car: { amt: 0, freq: 'monthly' },
            home: { amt: 0, freq: 'monthly' },
        },
        taxRate: 25,
        projectionSettings: {
            annualSavings: 20000,
            expectedReturn: 8.0,
            inflationRate: 2.5,
            swr: 4.0,
            spanYears: 10,
            currentAge: 35,
            retireAge: 60,
        },
    };

    it('generates labels for each year of the span', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.labels).toHaveLength(11); // 0..10 inclusive
        expect(data.labels[0]).toBe('Age 35');
        expect(data.labels[10]).toBe('Age 45');
    });

    it('starting networth matches aggregate', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.networth).toBe(100000);
        expect(data.nwData[0]).toBe(100000);
    });

    it('net worth grows over time with positive real return', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.nwData[data.nwData.length - 1]).toBeGreaterThan(
            data.nwData[0],
        );
    });

    it('computes fireNumber from annual expenses and SWR', () => {
        const data = buildProjectionData(baseState, 0);
        const annualExpenses = getAnnualExpensesTotal(
            baseState.expenses,
            baseState.insurances,
            baseState.taxRate,
        );
        const expected = annualExpenses / 0.04;
        expect(data.fireNumber).toBeCloseTo(expected, 0);
    });

    it('fireLine is constant (FIRE target)', () => {
        const data = buildProjectionData(baseState, 0);
        const allSame = data.fireLine.every((v) => v === data.fireLine[0]);
        expect(allSame).toBe(true);
    });

    it('leanFireLine is 75% of fireLine (rounded)', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.leanFireLine[0]).toBe(Math.round(data.fireLine[0] * 0.75));
    });

    it('fatFireLine is 125% of fireLine (rounded)', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.fatFireLine[0]).toBe(Math.round(data.fireLine[0] * 1.25));
    });

    it('bull scenario is higher than base', () => {
        const data = buildProjectionData(baseState, 0);
        const lastIdx = data.nwData.length - 1;
        expect(data.bullData[lastIdx]).toBeGreaterThan(data.nwData[lastIdx]);
    });

    it('bear scenario is strictly lower than base', () => {
        const data = buildProjectionData(baseState, 0);
        const lastIdx = data.nwData.length - 1;
        expect(data.bearData[lastIdx]).toBeLessThan(data.nwData[lastIdx]);
    });

    it('applies scenario offset to return rate', () => {
        const bullData = buildProjectionData(baseState, 2);
        const baseData = buildProjectionData(baseState, 0);
        const lastIdx = bullData.nwData.length - 1;
        expect(bullData.nwData[lastIdx]).toBeGreaterThan(
            baseData.nwData[lastIdx],
        );
    });

    it('sets retirementLineIndex correctly', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.retirementLineIndex).toBe(-1);
    });

    it('sets retirementLineIndex when retire is within span', () => {
        const state = {
            ...baseState,
            projectionSettings: {
                ...baseState.projectionSettings,
                retireAge: 40,
                spanYears: 10,
            },
        };
        const data = buildProjectionData(state, 0);
        expect(data.retirementLineIndex).toBe(5);
    });

    it('includes CD events', () => {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 2);
        const state = {
            ...baseState,
            cds: [
                {
                    bank: 'Marcus',
                    principal: 10000,
                    rate: 5,
                    maturity: futureDate.toISOString().slice(0, 10),
                },
            ],
        };
        const data = buildProjectionData(state, 0);
        expect(data.cdEvents.length).toBeGreaterThan(0);
    });

    it('benchData has correct length', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.benchData).toHaveLength(11);
    });
});

// ─── buildProjectionData — retirement withdrawal & cash-first drawdown ─────────
// Closes the coverage gap flagged by prior research: withdrawal/depletion
// logic existed but had no dedicated tests, and there was no cash-first
// sequencing at all (net worth was one blended scalar). These exercise the
// post-retirement branch directly: withdrawals actually reduce the balance,
// cash is spent before invested assets, and a poor enough scenario can
// deplete the portfolio to zero (the balance is not monotonically growing).

function makeRetirementState(overrides = {}) {
    const { projectionSettings: projOverrides, ...rest } = overrides;
    return {
        importedPositions: [],
        customAccounts: [],
        cds: [],
        realEstate: [],
        vehicles: [],
        sideGigLedger: [],
        expenses: {
            housing: 0,
            food: 0,
            transport: 0,
            utilities: 0,
            healthcare: 0,
            discretionary: 0,
        },
        insurances: {
            car: { amt: 0, freq: 'monthly' },
            home: { amt: 0, freq: 'monthly' },
        },
        taxRate: 0,
        projectionSettings: {
            annualSavings: 0,
            expectedReturn: 6.0,
            inflationRate: 0,
            swr: 4.0,
            spanYears: 10,
            currentAge: 60,
            retireAge: 60,
            ...projOverrides,
        },
        ...rest,
    };
}

describe('buildProjectionData — retirement withdrawal & cash-first drawdown', () => {
    it('withdraws starting the retirement year — balance reflects the withdrawal, not pure growth', () => {
        const state = makeRetirementState({
            customAccounts: [{ type: 'Brokerage', value: 500000 }],
            expenses: { housing: 3000 }, // 36,000/yr
        });
        const data = buildProjectionData(state, 0);
        const grownOnly = 500000 * (1 + data.realReturn);
        expect(data.nwData[1]).toBeLessThan(grownOnly);
        expect(data.nwData[1]).toBeCloseTo(grownOnly - 36000, 0);
    });

    it('cash-first: the invested bucket is untouched while cash alone covers withdrawals', () => {
        const state = makeRetirementState({
            customAccounts: [
                { type: 'Cash', value: 200000 },
                { type: 'Brokerage', value: 100000 },
            ],
            expenses: { housing: 2000 }, // 24,000/yr — well within the cash cushion
            projectionSettings: { spanYears: 3 },
        });
        const data = buildProjectionData(state, 0);
        const expectedInvestedYr1 = 100000 * (1 + data.realReturn);
        const expectedCashYr1 = 200000 - 24000;
        expect(data.nwData[1]).toBeCloseTo(
            expectedCashYr1 + expectedInvestedYr1,
            0,
        );
    });

    it('draws the remainder from invested assets once cash is exhausted partway through', () => {
        const state = makeRetirementState({
            customAccounts: [
                { type: 'Cash', value: 30000 },
                { type: 'Brokerage', value: 200000 },
            ],
            expenses: { housing: 1667 }, // ~20,000/yr — cash covers ~1.5 years
            projectionSettings: { spanYears: 3 },
        });
        const data = buildProjectionData(state, 0);
        const annualExpenses = getAnnualExpensesTotal(
            state.expenses,
            state.insurances,
            state.taxRate,
        );
        const r = data.realReturn;
        // Year 1: cash covers the full withdrawal (30,000 > annualExpenses);
        // invested only grows.
        const investedAfterYr1 = 200000 * (1 + r);
        const cashAfterYr1 = 30000 - annualExpenses;
        expect(data.nwData[1]).toBeCloseTo(cashAfterYr1 + investedAfterYr1, 0);

        // Year 2: remaining cash covers only part of the withdrawal; invested
        // absorbs the rest after growing for the year.
        const remainingFromCash = Math.min(cashAfterYr1, annualExpenses);
        const shortfall = annualExpenses - remainingFromCash;
        const investedAfterYr2 = investedAfterYr1 * (1 + r) - shortfall;
        const cashAfterYr2 = cashAfterYr1 - remainingFromCash;
        expect(data.nwData[2]).toBeCloseTo(cashAfterYr2 + investedAfterYr2, 0);
        // The whole point of cash-first: invested didn't take a hit in year 1.
        expect(investedAfterYr1).toBeGreaterThan(200000);
    });

    it('a high withdrawal rate against a poor-return scenario depletes the portfolio (balance hits zero, not monotonic growth)', () => {
        const state = makeRetirementState({
            customAccounts: [{ type: 'Brokerage', value: 50000 }],
            expenses: { housing: 5000 }, // 60,000/yr against a 50k portfolio
            projectionSettings: {
                expectedReturn: 2.0,
                inflationRate: 2.0,
                spanYears: 10,
            },
        });
        const data = buildProjectionData(state, 0);
        expect(data.depletionAge.base).not.toBeNull();
        expect(data.nwData[data.nwData.length - 1]).toBe(0);
        // Confirms this isn't the pre-fix monotonic-growth bug: the balance
        // actually goes down year over year until it bottoms out at zero.
        expect(data.nwData[1]).toBeLessThan(data.nwData[0]);
        expect(data.portfolioSurvives).toBe(false);
    });

    it('the portfolio can also survive a full span under a sustainable withdrawal rate', () => {
        const state = makeRetirementState({
            customAccounts: [{ type: 'Brokerage', value: 1000000 }],
            expenses: { housing: 1000 }, // 12,000/yr — well under a 4% SWR
            projectionSettings: { spanYears: 20 },
        });
        const data = buildProjectionData(state, 0);
        expect(data.depletionAge.base).toBeNull();
        expect(data.portfolioSurvives).toBe(true);
        expect(data.nwData[data.nwData.length - 1]).toBeGreaterThan(0);
    });

    it('clamps the initial cash fraction when a non-cash balance is negative', () => {
        const state = makeRetirementState({
            customAccounts: [{ type: 'Cash', value: 50000 }],
            sideGigLedger: [{ net: -20000 }],
        });
        const data = buildProjectionData(state, 0);
        expect(data.nwData.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('projects finite values when cash carries an APY alongside a brokerage balance', () => {
        const state = makeRetirementState({
            customAccounts: [
                { type: 'Cash', value: 100000, apy: 4 },
                { type: 'Brokerage', value: 100000 },
            ],
        });
        const data = buildProjectionData(state, 0);
        expect(data.nwData.every((v) => Number.isFinite(v))).toBe(true);
    });

    it('records depletion when retirement starts with zero assets and positive expenses', () => {
        const state = makeRetirementState({
            customAccounts: [],
            expenses: { housing: 2000 },
            projectionSettings: {
                currentAge: 60,
                retireAge: 60,
                annualSavings: 0,
            },
        });
        const data = buildProjectionData(state, 0);
        expect(data.depletionAge.base).not.toBeNull();
        expect(data.portfolioSurvives).toBe(false);
    });
});
