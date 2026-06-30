'use strict';

const {
    insuranceToMonthly,
    getInsuranceMonthly,
} = require('../../app/lib/finance-core');

// ─── insuranceToMonthly ───────────────────────────────────────────────────────

describe('insuranceToMonthly', () => {
    it('divides 6-month amount by 6', () => {
        expect(insuranceToMonthly({ amt: 600, freq: '6month' })).toBe(100);
    });

    it('divides annual amount by 12', () => {
        expect(insuranceToMonthly({ amt: 1200, freq: 'annual' })).toBe(100);
    });

    it('returns monthly amount as-is', () => {
        expect(insuranceToMonthly({ amt: 150, freq: 'monthly' })).toBe(150);
    });

    it('returns 0 for missing amt', () => {
        expect(insuranceToMonthly({ freq: 'monthly' })).toBe(0);
    });

    it('returns monthly for unrecognised freq', () => {
        expect(insuranceToMonthly({ amt: 100, freq: 'weekly' })).toBe(100);
    });
});

// ─── getInsuranceMonthly ───────────────────────────────────────────────────────

describe('getInsuranceMonthly', () => {
    it('sums car and home insurance monthly', () => {
        const ins = {
            car: { amt: 600, freq: '6month' },
            home: { amt: 1200, freq: 'annual' },
        };
        expect(getInsuranceMonthly(ins)).toBe(200); // 100 + 100
    });

    it('handles missing insurance object', () => {
        expect(getInsuranceMonthly(null)).toBe(0);
        expect(getInsuranceMonthly({})).toBe(0);
    });
});
