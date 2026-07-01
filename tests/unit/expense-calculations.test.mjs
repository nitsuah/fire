import { describe, it, expect } from 'vitest';
import {
    getMonthlyExpensesBase,
    getAnnualExpensesTotal,
} from '../../app/lib/finance-core.js';

// ─── getMonthlyExpensesBase ───────────────────────────────────────────────────────

describe('getMonthlyExpensesBase', () => {
    it('sums all expense categories plus insurance', () => {
        const expenses = { housing: 1000, food: 500, transport: 200 };
        const insurances = {
            car: { amt: 0, freq: 'monthly' },
            home: { amt: 0, freq: 'monthly' },
        };
        expect(getMonthlyExpensesBase(expenses, insurances)).toBe(1700);
    });

    it('includes car insurance in total', () => {
        const expenses = { housing: 1000 };
        const insurances = {
            car: { amt: 120, freq: 'monthly' },
            home: { amt: 0, freq: 'monthly' },
        };
        expect(getMonthlyExpensesBase(expenses, insurances)).toBe(1120);
    });
});

// ─── getAnnualExpensesTotal ───────────────────────────────────────────────────────

describe('getAnnualExpensesTotal', () => {
    it('multiplies monthly base by 12 and adds tax drag', () => {
        const expenses = { housing: 1000 };
        const insurances = {
            car: { amt: 0, freq: 'monthly' },
            home: { amt: 0, freq: 'monthly' },
        };
        // monthly base = 1000, annual = 12000, tax drag 20% = 2400, total = 14400
        expect(getAnnualExpensesTotal(expenses, insurances, 20)).toBe(14400);
    });

    it('handles 0% tax rate', () => {
        const expenses = { housing: 1000 };
        const insurances = {};
        expect(getAnnualExpensesTotal(expenses, insurances, 0)).toBe(12000);
    });
});
