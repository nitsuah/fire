import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
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
    isCdMatured,
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

describe('isCdMatured / matured CDs in interest estimates', () => {
    const now = new Date(2026, 8, 25); // Sep 25 2026, local
    it('treats a CD as matured only after its maturity date', () => {
        expect(isCdMatured({ maturity: '2026-09-24' }, now)).toBe(true);
        expect(isCdMatured({ maturity: '2026-09-25' }, now)).toBe(false);
        expect(isCdMatured({ maturity: '2027-02-20' }, now)).toBe(false);
        expect(isCdMatured({ maturity: '' }, now)).toBe(false);
        expect(isCdMatured({ maturity: 'garbage' }, now)).toBe(false);
    });

    it('leaves matured CDs out of the interest estimate', () => {
        const r = getEstimatedAnnualInterest(
            [],
            [
                { principal: 10000, rate: 5, maturity: '2026-01-01' },
                { principal: 20000, rate: 4, maturity: '2027-02-20' },
            ],
            now,
        );
        expect(r.cds).toBeCloseTo(800, 6);
    });
});

describe('yearsToFire', () => {
    const { yearsToFire } = require('../../app/lib/aggregates.js');
    it('is 0 once net worth meets the FIRE number', () => {
        expect(yearsToFire({ networth: 1e6, fireNumber: 5e5 })).toBe(0);
    });
    it('compounds returns and adds savings each year', () => {
        // 100k at 10% + 10k/yr: 120k, 142k, 166.2k → reaches 150k in year 3
        expect(
            yearsToFire({
                networth: 100000,
                fireNumber: 150000,
                annualSavings: 10000,
                realReturn: 0.1,
            }),
        ).toBe(3);
    });
    it('is null when it never gets there, or with no FIRE number', () => {
        expect(yearsToFire({ networth: 1000, fireNumber: 5000 })).toBeNull();
        expect(yearsToFire({ networth: 1000, fireNumber: 0 })).toBeNull();
    });
});
