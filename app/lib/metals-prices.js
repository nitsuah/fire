'use strict';

/* ==========================================================================
   metals-prices.js — Gold/silver spot pricing for the "Metal" account type
   Layered like app/lib/prices-provider.js: an optional dedicated metals API
   (METALS_API_KEY) for precise spot pricing, falling back to Yahoo
   Finance's public COMEX futures quote (no key required) — the same
   no-cost fallback pattern app/lib/crypto-balance.js already uses for
   crypto ticker pricing, so this works out of the box with zero
   configuration.
   ========================================================================== */

const METALS_DEV_BASE = 'https://api.metals.dev/v1';
const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Yahoo's COMEX futures symbol for each metal, quoted in USD per troy
// ounce — used as the free spot-price proxy (Yahoo's XAUUSD=X/XAGUSD=X
// spot-forex symbols returned "No data found, symbol may be delisted" as
// of this writing; GC=F/SI=F are live and this is the standard free-tier
// substitute other finance tools use when a real spot index is paywalled).
const YAHOO_METAL_SYMBOLS = {
    gold: 'GC=F',
    silver: 'SI=F',
};

async function fetchFromMetalsDev(metal, apiKey) {
    const res = await fetch(
        `${METALS_DEV_BASE}/latest?api_key=${encodeURIComponent(apiKey)}&currency=USD&unit=toz`,
        { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
        throw Object.assign(
            new Error(`metals.dev request failed (${res.status})`),
            { status: 502 },
        );
    }
    const data = await res.json();
    const price = data?.metals?.[metal];
    if (!Number.isFinite(price)) {
        throw Object.assign(
            new Error(`metals.dev returned no ${metal} price`),
            { status: 502 },
        );
    }
    return { pricePerOz: price, source: 'metals.dev' };
}

async function fetchFromYahoo(metal) {
    const symbol = YAHOO_METAL_SYMBOLS[metal];
    const res = await fetch(
        `${YAHOO_CHART_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
        throw Object.assign(
            new Error(`Yahoo spot price fetch failed (${res.status})`),
            { status: 502 },
        );
    }
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!Number.isFinite(price)) {
        throw Object.assign(
            new Error(`Yahoo returned no price for ${symbol}`),
            { status: 502 },
        );
    }
    return { pricePerOz: price, source: 'yahoo-finance' };
}

// Resolves a metal ('gold'|'silver') + weight in troy ounces to a USD
// value. Prefers a dedicated metals API when METALS_API_KEY is configured;
// falls back to it (and to Yahoo on any metals.dev failure) automatically.
async function resolveMetalValue(metal, weightOz) {
    const type = String(metal || '').toLowerCase();
    if (type !== 'gold' && type !== 'silver') {
        throw Object.assign(
            new Error(`Unsupported metal "${metal}". Use "gold" or "silver".`),
            { status: 400 },
        );
    }
    const weight = Number(weightOz);
    if (!Number.isFinite(weight) || weight <= 0) {
        throw Object.assign(
            new Error('weightOz is required and must be > 0.'),
            { status: 400 },
        );
    }

    const apiKey = process.env.METALS_API_KEY;
    let result;
    if (apiKey) {
        try {
            result = await fetchFromMetalsDev(type, apiKey);
        } catch (err) {
            console.warn(
                `[Metals] metals.dev fetch failed, falling back to Yahoo: ${err.message}`,
            );
            result = await fetchFromYahoo(type);
        }
    } else {
        result = await fetchFromYahoo(type);
    }

    return {
        usdValue: result.pricePerOz * weight,
        pricePerOz: result.pricePerOz,
        weightOz: weight,
        metal: type,
        source: result.source,
    };
}

module.exports = { resolveMetalValue };
