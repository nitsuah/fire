'use strict';

const {
    calculateEbayFees,
    calculateEbayNetProfit,
    calculateEtsyFees,
    calculateEtsyNetProfit,
    calculateFBFees,
    calculateFBNetProfit,
    US_MEDIAN_SAVINGS,
} = require('../../app/lib/finance-core');

// ─── calculateEbayFees ─────────────────────────────────────────────────────────

describe('calculateEbayFees', () => {
    it('computes fees correctly for standard category (13.25%)', () => {
        // price=100, shipping=0, category=13.25%, ad=0%
        // standard fee = 100 * 0.1325 + 0.30 = 13.55
        const fees = calculateEbayFees(100, 0, 13.25, 0);
        expect(fees).toBeCloseTo(13.55, 2);
    });

    it('includes promoted listings ad fee', () => {
        // price=100, shipping=0, category=13.25%, ad=2%
        // standard fee = 13.55, ad fee = 2.00, total = 15.55
        const fees = calculateEbayFees(100, 0, 13.25, 2);
        expect(fees).toBeCloseTo(15.55, 2);
    });

    it('includes shipping in total transaction value', () => {
        // price=100, shipping=10, category=13.25%, ad=0%
        // total = 110, standard fee = 110 * 0.1325 + 0.30 = 14.875
        const fees = calculateEbayFees(100, 10, 13.25, 0);
        expect(fees).toBeCloseTo(14.875, 2);
    });

    it('handles zero values', () => {
        const fees = calculateEbayFees(0, 0, 0, 0);
        expect(fees).toBeCloseTo(0.3, 2); // just the flat $0.30
    });
});

// ─── calculateEbayNetProfit ────────────────────────────────────────────────────

describe('calculateEbayNetProfit', () => {
    it('computes correct net profit', () => {
        // price=100, cost=30, shipping_charged=0, shipping_actual=8.50, cat=13.25%, ad=2%
        // gross=100, fees=15.55, net = 100 - 15.55 - 8.50 - 30 = 45.95
        const profit = calculateEbayNetProfit(100, 30, 0, 8.5, 13.25, 2);
        expect(profit).toBeCloseTo(45.95, 1);
    });

    it('returns negative when costs exceed revenue', () => {
        const profit = calculateEbayNetProfit(10, 50, 0, 5, 13.25, 2);
        expect(profit).toBeLessThan(0);
    });

    it('handles zero cost basis', () => {
        const profit = calculateEbayNetProfit(100, 0, 0, 0, 13.25, 0);
        // gross=100, fees = 100*0.1325 + 0.30 = 13.55, net = 86.45
        expect(profit).toBeCloseTo(86.45, 1);
    });
});

// ─── US_MEDIAN_SAVINGS constant ────────────────────────────────────────────────

describe('US_MEDIAN_SAVINGS', () => {
    it('has entries for key ages', () => {
        expect(US_MEDIAN_SAVINGS[30]).toBe(45000);
        expect(US_MEDIAN_SAVINGS[65]).toBe(400000);
    });

    it('increases with age', () => {
        const ages = Object.keys(US_MEDIAN_SAVINGS)
            .map(Number)
            .sort((a, b) => a - b);
        for (let i = 1; i < ages.length; i++) {
            expect(US_MEDIAN_SAVINGS[ages[i]]).toBeGreaterThanOrEqual(
                US_MEDIAN_SAVINGS[ages[i - 1]],
            );
        }
    });
});

// ─── calculateEtsyFees ────────────────────────────────────────────────────────

describe('calculateEtsyFees', () => {
    it('calculates listing, transaction, and payment fees', () => {
        // price=40, shipping=0, adsRate=0
        // listing: $0.20
        // transaction: 40 * 0.065 = $2.60
        // payment: 40 * 0.03 + 0.25 = $1.45
        // total: $4.25
        const result = calculateEtsyFees(40, 0, 0);
        expect(result.listingFee).toBeCloseTo(0.2, 2);
        expect(result.transactionFee).toBeCloseTo(2.6, 2);
        expect(result.paymentProcessing).toBeCloseTo(1.45, 2);
        expect(result.adsFee).toBe(0);
        expect(result.total).toBeCloseTo(4.25, 2);
    });

    it('includes shipping in transaction and payment fees', () => {
        // price=30, shipping=5, total=35
        // transaction: 35 * 0.065 = 2.275
        // payment: 35 * 0.03 + 0.25 = 1.30
        const result = calculateEtsyFees(30, 5, 0);
        expect(result.transactionFee).toBeCloseTo(2.275, 2);
        expect(result.paymentProcessing).toBeCloseTo(1.3, 2);
    });

    it('adds Etsy Ads fee when adsRate > 0', () => {
        // price=100, adsRate=10% → adsFee = 10
        const result = calculateEtsyFees(100, 0, 10);
        expect(result.adsFee).toBeCloseTo(10, 2);
    });
});

// ─── calculateEtsyNetProfit ───────────────────────────────────────────────────

describe('calculateEtsyNetProfit', () => {
    it('computes correct net profit', () => {
        // price=40, shipping_charged=0, actual=5, cost=10, ads=0
        // gross=40, fees=4.25, net = 40 - 4.25 - 5 - 10 = 20.75
        const profit = calculateEtsyNetProfit(40, 0, 5, 10, 0);
        expect(profit).toBeCloseTo(20.75, 1);
    });

    it('returns negative when costs exceed revenue', () => {
        const profit = calculateEtsyNetProfit(10, 0, 0, 50, 0);
        expect(profit).toBeLessThan(0);
    });
});

// ─── calculateFBFees ──────────────────────────────────────────────────────────

describe('calculateFBFees', () => {
    it('returns zero fees for local pickup', () => {
        const result = calculateFBFees(50, false);
        expect(result.total).toBe(0);
    });

    it('applies 5% fee for shipped sales', () => {
        const result = calculateFBFees(100, true);
        expect(result.sellingFee).toBeCloseTo(5, 2);
        expect(result.total).toBeCloseTo(5, 2);
    });

    it('applies minimum $0.40 fee for low-value shipped sales', () => {
        const result = calculateFBFees(5, true); // 5% of $5 = $0.25, minimum $0.40
        expect(result.sellingFee).toBeCloseTo(0.4, 2);
    });
});

// ─── calculateFBNetProfit ─────────────────────────────────────────────────────

describe('calculateFBNetProfit', () => {
    it('computes correct profit for local sale', () => {
        // price=50, cost=20, no fees, no shipping
        const profit = calculateFBNetProfit(50, 0, 20, false);
        expect(profit).toBeCloseTo(30, 2);
    });

    it('deducts 5% fee for shipped sale', () => {
        // price=100, cost=30, shipping=8, 5% fee=5
        const profit = calculateFBNetProfit(100, 8, 30, true);
        expect(profit).toBeCloseTo(57, 1);
    });
});
