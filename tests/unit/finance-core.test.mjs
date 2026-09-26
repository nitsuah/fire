import { describe, it, expect } from 'vitest';
import {
    formatCurrency,
    sanitizeState,
    parseCSVText,
    parseFidelityPositions,
    parseChaseStatement,
    parseCapitalOneStatement,
    computeEffectiveTaxRate,
    insuranceToMonthly,
    getInsuranceMonthly,
    getMonthlyExpensesBase,
    getAnnualExpensesTotal,
    isSettledCash,
    getAggregateCash,
    getAggregateCDs,
    getAggregateEquities,
    getAggregateOtherAssets,
    getEstimatedAnnualInterest,
    getSideGigYTDNet,
    getAggregateRealEstate,
    getAggregateVehicles,
    getAggregateNetWorth,
    windowToPoints,
    sliceProjectionData,
    buildProjectionData,
    pnlColorStyle,
    sortPositions,
    calculateEbayFees,
    calculateEbayNetProfit,
    calculateEtsyFees,
    calculateEtsyNetProfit,
    calculateFBFees,
    calculateFBNetProfit,
    US_MEDIAN_SAVINGS,
} from '../../app/lib/finance-core.js';

// Tests have been extracted to focused files:
//   currency-formatting.test.mjs   state-management.test.mjs   parse-csv.test.mjs
//   tax-calculations.test.mjs      insurance-calculations.test.mjs
//   expense-calculations.test.mjs  asset-aggregation.test.mjs
//   projection-calculations.test.mjs  marketplace-fees.test.mjs
//   platform-fees-profit.test.mjs

describe('finance-core', () => {
    it('exports all expected functions', () => {
        expect(typeof formatCurrency).toBe('function');
        expect(typeof sanitizeState).toBe('function');
        expect(typeof parseCSVText).toBe('function');
        expect(typeof parseFidelityPositions).toBe('function');
        expect(typeof parseChaseStatement).toBe('function');
        expect(typeof parseCapitalOneStatement).toBe('function');
        expect(typeof computeEffectiveTaxRate).toBe('function');
        expect(typeof insuranceToMonthly).toBe('function');
        expect(typeof getInsuranceMonthly).toBe('function');
        expect(typeof getMonthlyExpensesBase).toBe('function');
        expect(typeof getAnnualExpensesTotal).toBe('function');
        expect(typeof isSettledCash).toBe('function');
        expect(typeof getAggregateCash).toBe('function');
        expect(typeof getAggregateCDs).toBe('function');
        expect(typeof getAggregateEquities).toBe('function');
        expect(typeof getAggregateOtherAssets).toBe('function');
        expect(typeof getSideGigYTDNet).toBe('function');
        expect(typeof getAggregateRealEstate).toBe('function');
        expect(typeof getAggregateVehicles).toBe('function');
        expect(typeof getAggregateNetWorth).toBe('function');
        expect(typeof windowToPoints).toBe('function');
        expect(typeof sliceProjectionData).toBe('function');
        expect(typeof buildProjectionData).toBe('function');
        expect(typeof pnlColorStyle).toBe('function');
        expect(typeof sortPositions).toBe('function');
        expect(typeof calculateEbayFees).toBe('function');
        expect(typeof calculateEbayNetProfit).toBe('function');
        expect(typeof calculateEtsyFees).toBe('function');
        expect(typeof calculateEtsyNetProfit).toBe('function');
        expect(typeof calculateFBFees).toBe('function');
        expect(typeof calculateFBNetProfit).toBe('function');
        expect(typeof US_MEDIAN_SAVINGS).toBe('object');
    });
});

describe('getEstimatedAnnualInterest', () => {
    it('sums HYSA/cash APY, CD interest and crypto staking, ignoring other types', () => {
        const r = getEstimatedAnnualInterest(
            [
                { type: 'Savings', value: 10000, apy: 4 },
                { type: 'Cash', value: 1000, apy: 0 },
                { type: 'Crypto', value: 5000, apy: 7 },
                { type: 'Metal', value: 2000 },
            ],
            [{ principal: 20000, rate: 5 }],
        );
        expect(r.savings).toBeCloseTo(400, 6);
        expect(r.cds).toBeCloseTo(1000, 6);
        expect(r.staking).toBeCloseTo(350, 6); // crypto 5000 × 7%
        expect(r.total).toBeCloseTo(1750, 6);
    });

    it('handles missing inputs', () => {
        expect(getEstimatedAnnualInterest(undefined, undefined).total).toBe(0);
    });
});
