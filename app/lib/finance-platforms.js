'use strict';

/* ==========================================================================
   finance-platforms.js — Platform fee calculators (eBay, Etsy, Facebook,
   Mercari, Poshmark)
   CommonJS module — require()'d by finance-core.js
   ========================================================================== */

function calculateEbayFees(price, shippingCharged, categoryRate, adRate) {
    const totalTransactionVal = (price || 0) + (shippingCharged || 0);
    const standardFee = totalTransactionVal * ((categoryRate || 0) / 100) + 0.3;
    const adFee = totalTransactionVal * ((adRate || 0) / 100);
    return standardFee + adFee;
}

// Per-category final value fee rules (US, eBay seller fees page, checked
// 2026-11-24). `tiers` are marginal brackets over the total transaction value
// (price + shipping charged): `upTo` is the bracket's upper bound (null = no
// bound), `rate` is a percentage applied only to the part of the value inside
// that bracket. Verify against eBay's seller fees page before editing.
const EBAY_FEE_RULES = Object.freeze({
    standard: {
        id: 'standard',
        label: 'Most Categories',
        tiers: [
            { upTo: 7500, rate: 13.6 },
            { upTo: null, rate: 2.35 },
        ],
    },
    'books-movies-music': {
        id: 'books-movies-music',
        label: 'Books, Movies & Music',
        tiers: [
            { upTo: 7500, rate: 15.3 },
            { upTo: null, rate: 2.35 },
        ],
    },
    'trading-cards': {
        id: 'trading-cards',
        label: 'Trading Cards & Comics',
        tiers: [
            { upTo: 7500, rate: 13.25 },
            { upTo: null, rate: 2.35 },
        ],
    },
    clothing: {
        id: 'clothing',
        label: 'Clothing, Shoes & Accessories',
        tiers: [
            { upTo: 7500, rate: 13.6 },
            { upTo: null, rate: 2.35 },
        ],
    },
});

const EBAY_DEFAULT_RULE_ID = 'standard';

// Unknown ids (including a legacy bare percentage saved before rule ids
// existed) resolve to the standard rule rather than throwing.
function getEbayFeeRule(ruleId) {
    return Object.prototype.hasOwnProperty.call(EBAY_FEE_RULES, ruleId)
        ? EBAY_FEE_RULES[ruleId]
        : EBAY_FEE_RULES[EBAY_DEFAULT_RULE_ID];
}

// Marginal final value fee for `value` under a rule's tiers.
function calculateTieredFee(value, tiers) {
    let remaining = Math.max(value || 0, 0);
    let lower = 0;
    let fee = 0;
    for (const tier of tiers) {
        if (remaining <= 0) break;
        const width = tier.upTo === null ? Infinity : tier.upTo - lower;
        const slice = Math.min(remaining, width);
        fee += slice * (tier.rate / 100);
        remaining -= slice;
        if (tier.upTo !== null) lower = tier.upTo;
    }
    return fee;
}

// Total eBay fees for a sale: tiered final value fee for the category rule,
// the per-order fee ($0.30 up to $10.00, $0.40 above), and the promoted
// listings ad rate on the whole transaction value.
function calculateEbayFeesByRule(ruleId, price, shippingCharged, adRate) {
    const rule = getEbayFeeRule(ruleId);
    const totalTransactionVal = (price || 0) + (shippingCharged || 0);
    const orderFee = totalTransactionVal > 10 ? 0.4 : 0.3;
    const adFee = totalTransactionVal * ((adRate || 0) / 100);
    return (
        calculateTieredFee(totalTransactionVal, rule.tiers) + orderFee + adFee
    );
}

function calculateEbayNetProfit(
    price,
    cost,
    shippingCharged,
    shippingActual,
    categoryRate,
    adRate,
) {
    const gross = (price || 0) + (shippingCharged || 0);
    const fees = calculateEbayFees(
        price,
        shippingCharged,
        categoryRate,
        adRate,
    );
    return gross - fees - (shippingActual || 0) - (cost || 0);
}

// Etsy fee breakdown (2024 rates)
function calculateEtsyFees(price, shipping, adsRate) {
    const p = price || 0;
    const s = shipping || 0;
    const listingFee = 0.2;
    const transactionFee = (p + s) * 0.065;
    const paymentProcessing = (p + s) * 0.03 + 0.25;
    const adsFee = (p + s) * ((adsRate || 0) / 100);
    return {
        listingFee,
        transactionFee,
        paymentProcessing,
        adsFee,
        total: listingFee + transactionFee + paymentProcessing + adsFee,
    };
}

function calculateEtsyNetProfit(
    price,
    shipping,
    shippingActual,
    cost,
    adsRate,
) {
    const p = price || 0;
    const s = shipping || 0;
    const fees = calculateEtsyFees(p, s, adsRate);
    return p + s - fees.total - (shippingActual || 0) - (cost || 0);
}

// Facebook Marketplace fees (5% or $0.40 min for checkout, free for local)
function calculateFBFees(price, isShipped) {
    const p = price || 0;
    if (!isShipped) return { sellingFee: 0, total: 0 };
    const sellingFee = Math.max(p * 0.05, 0.4);
    return { sellingFee, total: sellingFee };
}

function calculateFBNetProfit(price, shippingActual, cost, isShipped) {
    const p = price || 0;
    const fees = calculateFBFees(p, isShipped);
    return p - fees.total - (shippingActual || 0) - (cost || 0);
}

// Mercari: 10% selling fee on item price + buyer-paid shipping. Its 2.9% +
// $0.50 payment processing fee has been charged to sellers at some times
// and to buyers at others, so it's opt-in.
function calculateMercariFees(price, buyerShipping, sellerPaysProcessing) {
    const base = (price || 0) + (buyerShipping || 0);
    if (base <= 0) return { sellingFee: 0, processingFee: 0, total: 0 };
    const sellingFee = base * 0.1;
    const processingFee = sellerPaysProcessing ? base * 0.029 + 0.5 : 0;
    return { sellingFee, processingFee, total: sellingFee + processingFee };
}

function calculateMercariNetProfit(
    price,
    buyerShipping,
    shippingActual,
    cost,
    sellerPaysProcessing,
) {
    const gross = (price || 0) + (buyerShipping || 0);
    const fees = calculateMercariFees(
        price,
        buyerShipping,
        sellerPaysProcessing,
    );
    return gross - fees.total - (shippingActual || 0) - (cost || 0);
}

// Poshmark: $2.95 flat under $15, 20% at $15 and up. The buyer pays the
// shipping label; a seller shipping discount comes out of earnings.
function calculatePoshmarkFees(price) {
    const p = price || 0;
    if (p <= 0) return { commission: 0, total: 0 };
    const commission = p < 15 ? 2.95 : p * 0.2;
    return { commission, total: commission };
}

function calculatePoshmarkNetProfit(price, shippingDiscount, cost) {
    const p = price || 0;
    return (
        p -
        calculatePoshmarkFees(p).total -
        (shippingDiscount || 0) -
        (cost || 0)
    );
}

module.exports = {
    calculateMercariFees,
    calculateMercariNetProfit,
    calculatePoshmarkFees,
    calculatePoshmarkNetProfit,
    calculateEbayFees,
    calculateEbayNetProfit,
    EBAY_FEE_RULES,
    EBAY_DEFAULT_RULE_ID,
    getEbayFeeRule,
    calculateTieredFee,
    calculateEbayFeesByRule,
    calculateEtsyFees,
    calculateEtsyNetProfit,
    calculateFBFees,
    calculateFBNetProfit,
};
