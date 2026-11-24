import { describe, it, expect } from 'vitest';
import {
    calculateEbayFees,
    calculateEbayNetProfit,
    EBAY_FEE_RULES,
    getEbayFeeRule,
    calculateTieredFee,
    calculateEbayFeesByRule,
    calculateEtsyFees,
    calculateEtsyNetProfit,
    calculateFBFees,
    calculateFBNetProfit,
    calculateMercariFees,
    calculateMercariNetProfit,
    calculatePoshmarkFees,
    calculatePoshmarkNetProfit,
    US_MEDIAN_SAVINGS,
} from '../../app/lib/finance-core.js';

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
    // Smoke tests pinned to current dataset values. Update these if the
    // US_MEDIAN_SAVINGS constant in finance-core.js is refreshed.
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

// ─── calculateEtsyFees ─────────────────────────────────────────────────────────

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

// ─── calculateFBFees ────────────────────────────────────────────────────────────

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

// ─── calculateFBNetProfit ───────────────────────────────────────────────────────

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

describe('calculateMercariFees / calculateMercariNetProfit', () => {
    it('charges 10% of item price plus buyer-paid shipping', () => {
        const fees = calculateMercariFees(40, 5, false);
        expect(fees.sellingFee).toBeCloseTo(4.5, 2);
        expect(fees.processingFee).toBe(0);
        expect(fees.total).toBeCloseTo(4.5, 2);
    });

    it('adds the 2.9% + $0.50 processing fee only when the seller pays it', () => {
        expect(calculateMercariFees(40, 5, true).total).toBeCloseTo(
            4.5 + 45 * 0.029 + 0.5,
            2,
        );
    });

    it('is zero for a zero sale and nets out shipping and cost', () => {
        expect(calculateMercariFees(0, 0, true).total).toBe(0);
        // 45 gross − 4.50 fee − 6 label − 10 cost
        expect(calculateMercariNetProfit(40, 5, 6, 10, false)).toBeCloseTo(
            24.5,
            2,
        );
    });
});

describe('calculatePoshmarkFees / calculatePoshmarkNetProfit', () => {
    it('charges a flat $2.95 under $15', () => {
        expect(calculatePoshmarkFees(14.99).total).toBe(2.95);
    });

    it('charges 20% at $15 and up', () => {
        expect(calculatePoshmarkFees(15).total).toBeCloseTo(3, 2);
        expect(calculatePoshmarkFees(100).total).toBeCloseTo(20, 2);
    });

    it('nets out a seller shipping discount and the item cost', () => {
        expect(calculatePoshmarkFees(0).total).toBe(0);
        // 30 − 6 fee − 2 discount − 8 cost
        expect(calculatePoshmarkNetProfit(30, 2, 8)).toBeCloseTo(14, 2);
    });
});

// ─── EBAY_FEE_RULES / calculateEbayFeesByRule ──────────────────────────────────

describe('EBAY_FEE_RULES', () => {
    it('has the four category rules keyed by id, with ascending tiers ending unbounded', () => {
        expect(Object.keys(EBAY_FEE_RULES)).toEqual([
            'standard',
            'books-movies-music',
            'trading-cards',
            'clothing',
        ]);
        for (const [id, rule] of Object.entries(EBAY_FEE_RULES)) {
            expect(rule.id).toBe(id);
            const bounds = rule.tiers.map((t) => t.upTo);
            expect(bounds.at(-1)).toBeNull();
            const finite = bounds.slice(0, -1);
            expect([...finite].sort((a, b) => a - b)).toEqual(finite);
        }
    });

    it('is frozen so callers cannot change a rate', () => {
        expect(Object.isFrozen(EBAY_FEE_RULES)).toBe(true);
    });

    it('falls back to the standard rule for unknown ids and legacy percentages', () => {
        expect(getEbayFeeRule('nope').id).toBe('standard');
        expect(getEbayFeeRule('13.6').id).toBe('standard');
        expect(getEbayFeeRule('__proto__').id).toBe('standard');
        expect(getEbayFeeRule(undefined).id).toBe('standard');
    });
});

describe('calculateTieredFee', () => {
    const tiers = [
        { upTo: 100, rate: 10 },
        { upTo: 200, rate: 5 },
        { upTo: null, rate: 1 },
    ];
    it('applies each rate only inside its bracket', () => {
        expect(calculateTieredFee(50, tiers)).toBeCloseTo(5);
        expect(calculateTieredFee(100, tiers)).toBeCloseTo(10);
        expect(calculateTieredFee(150, tiers)).toBeCloseTo(12.5);
        expect(calculateTieredFee(300, tiers)).toBeCloseTo(10 + 5 + 1);
    });
    it('is zero for zero, negative and missing values', () => {
        expect(calculateTieredFee(0, tiers)).toBe(0);
        expect(calculateTieredFee(-5, tiers)).toBe(0);
        expect(calculateTieredFee(undefined, tiers)).toBe(0);
    });
});

describe('calculateEbayFeesByRule', () => {
    it('matches the flat calculator below the cap, apart from the $0.40 order fee above $10', () => {
        const flat = calculateEbayFees(100, 10, 13.6, 2) + 0.1;
        expect(calculateEbayFeesByRule('standard', 100, 10, 2)).toBeCloseTo(
            flat,
        );
    });

    it('uses each category rate', () => {
        expect(
            calculateEbayFeesByRule('books-movies-music', 100, 0, 0),
        ).toBeCloseTo(15.3 + 0.4);
        expect(calculateEbayFeesByRule('trading-cards', 100, 0, 0)).toBeCloseTo(
            13.25 + 0.4,
        );
        expect(calculateEbayFeesByRule('clothing', 100, 0, 0)).toBeCloseTo(
            13.6 + 0.4,
        );
    });

    it('charges the lower marginal rate only on the part above $7,500', () => {
        const fee = calculateEbayFeesByRule('standard', 8000, 0, 0);
        expect(fee).toBeCloseTo(7500 * 0.136 + 500 * 0.0235 + 0.4);
        // Not the flat rate over the whole value.
        expect(fee).toBeLessThan(8000 * 0.136 + 0.4);
    });

    it('is exactly the cap fee at $7,500 and continuous across it', () => {
        const at = calculateEbayFeesByRule('trading-cards', 7500, 0, 0);
        const over = calculateEbayFeesByRule('trading-cards', 7500.01, 0, 0);
        expect(at).toBeCloseTo(7500 * 0.1325 + 0.4);
        expect(over - at).toBeCloseTo(0.01 * 0.0235);
    });

    it('counts shipping charged toward the tier and the per-order fee threshold', () => {
        expect(calculateEbayFeesByRule('standard', 7000, 600, 0)).toBeCloseTo(
            7500 * 0.136 + 100 * 0.0235 + 0.4,
        );
        expect(calculateEbayFeesByRule('standard', 5, 5, 0)).toBeCloseTo(
            10 * 0.136 + 0.3,
        );
        expect(calculateEbayFeesByRule('standard', 5, 5.01, 0)).toBeCloseTo(
            10.01 * 0.136 + 0.4,
        );
    });

    it('applies the ad rate to the whole transaction value, not by tier', () => {
        const noAds = calculateEbayFeesByRule('standard', 8000, 0, 0);
        expect(
            calculateEbayFeesByRule('standard', 8000, 0, 2) - noAds,
        ).toBeCloseTo(160);
    });

    it('treats missing inputs as zero (just the $0.30 order fee)', () => {
        expect(calculateEbayFeesByRule('standard')).toBeCloseTo(0.3);
    });
});
