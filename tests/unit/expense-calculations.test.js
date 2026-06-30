'use strict';

const {
    getMonthlyExpensesBase,
    getAnnualExpensesTotal,
} = require('../../app/lib/finance-core');

// ─── getMonthlyExpensesBase ───────────────────────────────────────────────────────

describe('getMonthlyExpensesBase', () => {
    it('calculates monthly for empty state', () => {
        const result = getMonthlyExpensesBase({});
        expect(result).toBe(0);
    });

    it('calculates car payment monthly', () => {
        const state = { insurances: { car: { amt: 1200, freq: '6month' } } };
        const result = getMonthlyExpensesBase(state);
        expect(result).toBe(600);
    });

    it('calculates home payment monthly', () => {
        const state = { insurances: { home: { amt: 1800, freq: 'monthly' } } };
        const result = getMonthlyExpensesBase(state);
        expect(result).toBe(1800);
    });

    it('sums multiple insurance types', () => {
        const state = {
            insurances: {
                car: { amt: 1200, freq: '6month' },
                home: { amt: 1800, freq: 'monthly' },
            }
        };
        const result = getMonthlyExpensesBase(state);
        expect(result).toBe(2400);
    });
});

// ─── getAnnualExpensesTotal ───────────────────────────────────────────────────────

describe('getAnnualExpensesTotal', () => {
    it('calculates annual total for empty state', () => {
        const result = getAnnualExpensesTotal({});
        expect(result).toBe(0);
    });

    it('calculates annual car insurance', () => {
        const state = { insurances: { car: { amt: 1200, freq: '6month' } } };
        const result = getAnnualExpensesTotal(state);
        expect(result).toBe(2400);
    });

    it('calculates annual home insurance', () => {
        const state = { insurances: { home: { amt: 1800, freq: 'monthly' } } };
        const result = getAnnualExpensesTotal(state);
        expect(result).toBe(21600);
    });

    it('sums multiple insurance types', () => {
        const state = {
            insurances: {
                car: { amt: 1200, freq: '6month' },
                home: { amt: 1800, freq: 'monthly' },
            }
        };
        const result = getAnnualExpensesTotal(state);
        expect(result).toBe(24000);
    });
});