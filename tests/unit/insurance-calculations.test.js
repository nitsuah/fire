'use strict';

const {
    insuranceToMonthly,
    getInsuranceMonthly,
} = require('../../app/lib/finance-core');

// ─── insuranceToMonthly ───────────────────────────────────────────────────────

describe('insuranceToMonthly', () => {
    it('converts annual car insurance to monthly', () => {
        expect(insuranceToMonthly(1200, 'car', '6month')).toBe(600);
    });

    it('converts annual car insurance to monthly (12month freq)', () => {
        expect(insuranceToMonthly(1200, 'car', '12month')).toBe(1200);
    });

    it('converts annual home insurance to monthly', () => {
        expect(insuranceToMonthly(1800, 'home', 'monthly')).toBe(150);
    });

    it('handles car insurance with monthly frequency', () => {
        expect(insuranceToMonthly(1200, 'car', 'monthly')).toBe(1200);
    });
});

// ─── getInsuranceMonthly ───────────────────────────────────────────────────────

describe('getInsuranceMonthly', () => {
    it('calculates car insurance monthly payment', () => {
        const result = getInsuranceMonthly(1200, 'car');
        expect(result.freq).toBe('6month');
        expect(result.amt).toBe(1200);
    });

    it('calculates home insurance monthly payment', () => {
        const result = getInsuranceMonthly(1800, 'home');
        expect(result.freq).toBe('monthly');
        expect(result.amt).toBe(1800);
    });

    it('returns defaults when none specified', () => {
        const result = getInsuranceMonthly(0, 'unknown');
        expect(result.amt).toBe(0);
        expect(result.freq).toBe('monthly');
    });
});