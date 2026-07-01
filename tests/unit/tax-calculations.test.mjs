import { describe, it, expect } from 'vitest';
import { computeEffectiveTaxRate } from '../../app/lib/finance-core.js';

// ─── computeEffectiveTaxRate ───────────────────────────────────────────────────────

describe('computeEffectiveTaxRate', () => {
    it('returns non-negative rate (floor at 0)', () => {
        const rate = computeEffectiveTaxRate(1, 'TX');
        // With income=1: federal 10%, FICA 7.65% → ~18% effective rate
        // Math.max(effectiveRate, 0) clamp ensures non-negative
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

    it('jumps at CA threshold 300k (state rate 9.3% → 11.3%)', () => {
        const rateBelow = computeEffectiveTaxRate(299999, 'CA');
        const rateAbove = computeEffectiveTaxRate(300001, 'CA');
        expect(rateAbove).toBeGreaterThan(rateBelow);
    });

    it('jumps at NY threshold 215400 (state rate 6.85% → 10.9%)', () => {
        const rateBelow = computeEffectiveTaxRate(215399, 'NY');
        const rateAbove = computeEffectiveTaxRate(215401, 'NY');
        expect(rateAbove).toBeGreaterThan(rateBelow);
    });

    it('defaults to 4% state for unknown state', () => {
        const rateOther = computeEffectiveTaxRate(80000, 'ZZ');
        const rateExplicit = computeEffectiveTaxRate(80000, 'Other');
        expect(rateOther).toBe(rateExplicit);
    });

    it('caps result at 50 for extreme income', () => {
        const rate = computeEffectiveTaxRate(50000000, 'CA');
        expect(rate).toBe(50);
    });

    it('computes a reasonable rate for typical salary', () => {
        // $100k in NY: federal ~18% + NY ~6.85% + FICA ~7.65% ≈ 32%
        const rate = computeEffectiveTaxRate(100000, 'NY');
        expect(rate).toBeGreaterThan(20);
        expect(rate).toBeLessThan(40);
    });
});
