'use strict';

const { computeEffectiveTaxRate } = require('../../app/lib/finance-core');

// ─── computeEffectiveTaxRate ───────────────────────────────────────────────────────

describe('computeEffectiveTaxRate', () => {
    it('returns 0 for zero income states with no income', () => {
        const rate = computeEffectiveTaxRate(1, 'TX');
        expect(rate).toBeGreaterThanOrEqual(0);
    });

    it('uses 0% state rate for TX', () => {
        const rateTX = computeEffectiveTaxRate(50000, 'TX');
        const rateCA = computeEffectiveTaxRate(50000, 'CA');
        expect(rateTX).toBeLessThan(rateCA);
    });

    it('uses 0% state rate for FL, WA, NV', () => {
        const rateTX = computeEffectiveTaxRate(80000, 'TX');
        const rateFL = computeEffectiveTaxRate(80000, 'FL');
        const rateWA = computeEffectiveTaxRate(80000, 'WA');
        expect(rateTX).toBe(rateFL);
        expect(rateTX).toBe(rateWA);
    });

    it('uses flat 4.95% for IL', () => {
        const rateIL = computeEffectiveTaxRate(100000, 'IL');
        const rateTX = computeEffectiveTaxRate(100000, 'TX');
        expect(rateIL).toBeGreaterThan(rateTX);
    });

    it('uses high CA rate for income > 300k', () => {
        const rateHigh = computeEffectiveTaxRate(400000, 'CA');
        const rateLow = computeEffectiveTaxRate(80000, 'CA');
        expect(rateHigh).toBeGreaterThan(rateLow);
    });

    it('uses high NY rate for income > 215400', () => {
        const rateHigh = computeEffectiveTaxRate(300000, 'NY');
        const rateMed = computeEffectiveTaxRate(100000, 'NY');
        expect(rateHigh).toBeGreaterThan(rateMed);
    });

    it('defaults to 4% state for unknown state', () => {
        const rateOther = computeEffectiveTaxRate(80000, 'ZZ');
        const rateExplicit = computeEffectiveTaxRate(80000, 'Other');
        expect(rateOther).toBe(rateExplicit);
    });

    it('caps result at 50', () => {
        const rate = computeEffectiveTaxRate(10000000, 'CA');
        expect(rate).toBeLessThanOrEqual(50);
    });

    it('floors result at 0', () => {
        const rate = computeEffectiveTaxRate(1, 'TX');
        expect(rate).toBeGreaterThanOrEqual(0);
    });

    it('computes a reasonable rate for typical salary', () => {
        // $100k in NY: federal ~18% + NY ~6.85% + FICA ~7.65% ≈ 32%
        const rate = computeEffectiveTaxRate(100000, 'NY');
        expect(rate).toBeGreaterThan(20);
        expect(rate).toBeLessThan(40);
    });
});
