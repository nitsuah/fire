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
    calculateEtsyFees,
    calculateEtsyNetProfit,
    calculateFBFees,
    calculateFBNetProfit,
};
