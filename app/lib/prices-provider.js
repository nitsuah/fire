'use strict';

const { pricesCache, refreshYahooCrumb } = require('./yahoo-prices');

function getProvider() {
    const override = process.env.PRICE_PROVIDER;
    if (override) return override.toLowerCase();
    if (process.env.ALPHA_VANTAGE_API_KEY) return 'alphavantage';
    if (process.env.POLYGON_API_KEY) return 'polygon';
    return 'yahoo';
}

async function fetchAlphaVantage(symbols) {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    const results = {};
    for (const symbol of symbols) {
        try {
            const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) continue;
            const data = await res.json();
            const quote = data['Global Quote'];
            if (quote && quote['05. price']) {
                results[symbol] = parseFloat(quote['05. price']);
            }
        } catch {
            // fall through — caller falls back
        }
    }
    return results;
}

async function fetchPolygon(symbols) {
    const apiKey = process.env.POLYGON_API_KEY;
    const results = {};
    for (const symbol of symbols) {
        try {
            const url = `https://api.polygon.io/v2/last/trade/${encodeURIComponent(symbol)}?apiKey=${apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) continue;
            const data = await res.json();
            if (data.results?.p) {
                results[symbol] = data.results.p;
            }
        } catch {
            // fall through
        }
    }
    return results;
}

async function fetchYahoo(symbols) {
    if (!pricesCache.crumb) {
        await refreshYahooCrumb();
    }
    if (!pricesCache.crumb) return {};

    const results = {};
    const symbolList = symbols.join(',');
    const params = new URLSearchParams({
        symbols: symbolList,
        crumb: pricesCache.crumb,
        fields: 'regularMarketPrice',
    });
    try {
        const res = await fetch(
            `https://query1.finance.yahoo.com/v7/finance/quote?${params}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    Cookie: pricesCache.cookie,
                },
                signal: AbortSignal.timeout(10000),
            },
        );
        if (!res.ok) return results;
        const data = await res.json();
        for (const quote of data?.quoteResponse?.result || []) {
            if (quote.symbol && quote.regularMarketPrice != null) {
                results[quote.symbol] = quote.regularMarketPrice;
            }
        }
    } catch {
        // return partial results
    }
    return results;
}

async function fetchPrices(symbols) {
    if (!symbols || symbols.length === 0) return {};
    const provider = getProvider();

    let results = {};
    if (provider === 'alphavantage') {
        results = await fetchAlphaVantage(symbols);
    } else if (provider === 'polygon') {
        results = await fetchPolygon(symbols);
    } else {
        results = await fetchYahoo(symbols);
    }

    // For any symbols that failed, fall back to Yahoo if we used a different provider
    const missing = symbols.filter((s) => results[s] == null);
    if (missing.length > 0 && provider !== 'yahoo') {
        const fallback = await fetchYahoo(missing);
        Object.assign(results, fallback);
    }

    return results;
}

module.exports = { fetchPrices, getProvider };
