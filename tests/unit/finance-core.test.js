'use strict';

const {
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
} = require('../../app/lib/finance-core');

// Tests have been extracted to focused files:
//   currency-formatting.test.js   state-management.test.js   parse-csv.test.js
//   tax-calculations.test.js      insurance-calculations.test.js
//   expense-calculations.test.js  asset-aggregation.test.js
//   projection-calculations.test.js  marketplace-fees.test.js
//   platform-fees-profit.test.js

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
