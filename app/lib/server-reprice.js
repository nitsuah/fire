'use strict';

/* ==========================================================================
   server-reprice.js — Re-price stored holdings without a browser tab

   Live prices used to come only from app/lib/prices.js, which runs in an open
   dashboard tab. With no tab open, nothing re-priced importedPositions or
   Metal accounts, and the hourly net-worth snapshot copied the same stale
   total forward day after day. The server now fetches quotes itself before
   each snapshot and applies them through the same merge rules as the
   browser's PATCH /api/state/live-values (app/lib/live-values.js).
   ========================================================================== */

const {
    fetchPrices,
    fetchYahooChart,
    getProvider,
} = require('./prices-provider');
const { resolveMetalValue, METAL_PAYOUT_PCT } = require('./metals-prices');
const {
    cleanSymbol,
    isCashLike,
    quotableSymbols,
} = require('./data-freshness');

// { SYMBOL: { price, changePercent? } }. A configured Alpha Vantage /
// Polygon key goes first; anything it misses (and the default Yahoo
// provider) uses Yahoo's crumb-free chart endpoint, which also carries the
// day's change.
async function fetchQuotes(symbols) {
    const quotes = {};
    const provider = getProvider();
    if (provider === 'alphavantage' || provider === 'polygon') {
        const prices = await fetchPrices(symbols);
        for (const [sym, price] of Object.entries(prices)) {
            if (Number.isFinite(price) && price > 0) quotes[sym] = { price };
        }
    }
    const missing = symbols.filter((s) => !quotes[s]);
    if (missing.length) Object.assign(quotes, await fetchYahooChart(missing));
    return quotes;
}

async function fetchMetalSpot(metal) {
    const { pricePerOz } = await resolveMetalValue(metal, 1);
    return { price: pricePerOz, payoutPct: METAL_PAYOUT_PCT[metal] };
}

// Builds live-values quote lists ({ positions, metals }) for the holdings in
// state. Network failures for one symbol or metal just leave it out.
async function collectLiveQuotes(
    state,
    { now = new Date(), quotes = fetchQuotes, metalSpot = fetchMetalSpot } = {},
) {
    const at = now.toISOString();
    const positions = [];
    const symbols = quotableSymbols(state.importedPositions);
    if (symbols.length) {
        let q = {};
        try {
            q = (await quotes(symbols)) || {};
        } catch (err) {
            console.warn('[Reprice] Quote fetch failed:', err.message);
        }
        for (const p of state.importedPositions || []) {
            if (!p?.id || isCashLike(p)) continue;
            const hit = q[cleanSymbol(p.symbol)];
            if (!hit || !(hit.price > 0)) continue;
            positions.push({
                id: p.id,
                lastPrice: hit.price,
                dayChangePercent: hit.changePercent,
                priceUpdatedAt: at,
            });
        }
    }

    const metals = [];
    const metalAccounts = (state.customAccounts || []).filter(
        (a) => a?.type === 'Metal' && a.id && a.weightOz > 0,
    );
    const spots = {};
    for (const metal of new Set(
        metalAccounts.map((a) => String(a.metalType || '').toLowerCase()),
    )) {
        if (!METAL_PAYOUT_PCT[metal]) continue;
        try {
            spots[metal] = await metalSpot(metal);
        } catch (err) {
            console.warn(`[Reprice] ${metal} spot failed:`, err.message);
        }
    }
    for (const a of metalAccounts) {
        const spot = spots[String(a.metalType || '').toLowerCase()];
        if (!spot) continue;
        metals.push({
            id: a.id,
            spotPricePerOz: spot.price,
            payoutPct: spot.payoutPct,
            valueLastRefreshed: at,
        });
    }

    return { positions, metals, symbolsRequested: symbols.length };
}

module.exports = { collectLiveQuotes, fetchQuotes, fetchMetalSpot };
