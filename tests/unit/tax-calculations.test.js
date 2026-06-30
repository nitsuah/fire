'use strict';

const {
    computeEffectiveTaxRate,
} = require('../../app/lib/finance-core');

// ─── computeEffectiveTaxRate ───────────────────────────────────────────────────

describe('computeEffectiveTaxRate', () => {
    it('calculates tax rate for $0 income', () => {
        expect(computeEffectiveTaxRate(0)).toBeCloseTo(0, 4);
    });

    it('calculates tax rate for $50,000 income', () => {
        expect(computeEffectiveTaxRate(50000)).toBeCloseTo(0.1875, 4);
    });

    it('calculates tax rate for $100,000 income', () => {
        expect(computeEffectiveTaxRate(100000)).toBeCloseTo(0.25, 4);
    });

    it('calculates tax rate for $200,000 income', () => {
        expect(computeEffectiveTaxRate(200000)).toBeCloseTo(0.3, 4);
    });

    it('scales linearly between brackets', () => {
        const rate70k = computeEffectiveTaxRate(70000);
        const rate80k = computeEffectiveTaxRate(80000);
        expect(rate80k - rate70k).toBeCloseTo(0.01, 4);
    });
});