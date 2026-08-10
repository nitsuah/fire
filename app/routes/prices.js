'use strict';

const express = require('express');
const { pricesCache, refreshYahooCrumb } = require('../lib/yahoo-prices');

const router = express.Router();
const CACHE_TTL_MS = 300000; // 5 minutes per symbol

/** Return only the requested symbols that are present in the cache. */
function pickSymbols(symbols) {
    return Object.fromEntries(
        symbols
            .filter((s) => pricesCache.data[s] !== undefined)
            .map((s) => [s, pricesCache.data[s]]),
    );
}

/** True when every requested symbol has a fresh individual cache entry. */
function allFresh(symbols) {
    const now = Date.now();
    return symbols.every((s) => {
        const entry = pricesCache.data[s];
        return entry !== undefined && now - entry.fetchedAt < CACHE_TTL_MS;
    });
}

router.get('/', async (req, res) => {
    const rawSymbols = req.query.symbols;
    if (!rawSymbols || typeof rawSymbols !== 'string') return res.json({});

    const symbolsArr = rawSymbols
        .split(',')
        .map((s) => s.trim().replace(/\*+$/g, ''))
        .filter(
            (s) =>
                s.length > 0 &&
                !/^\d+/.test(s) &&
                !['SPAXX', 'FDRXX', 'FCASH', 'FDIC'].includes(s.toUpperCase()),
        );

    if (symbolsArr.length === 0) return res.json({});

    const uniqueSymbols = [...new Set(symbolsArr)];

    if (allFresh(uniqueSymbols)) {
        console.log(
            `[Prices] Serving ${uniqueSymbols.length} symbol(s) from cache.`,
        );
        return res.json(pickSymbols(uniqueSymbols));
    }

    if (!pricesCache.crumb) {
        await refreshYahooCrumb();
    }

    const baseHeaders = () => ({
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: pricesCache.cookie,
    });

    const qStr = encodeURIComponent(uniqueSymbols.join(','));
    const buildCrumb = () =>
        pricesCache.crumb
            ? `&crumb=${encodeURIComponent(pricesCache.crumb)}`
            : '';

    // Endpoint factories evaluated lazily so crumb is current at call time.
    const endpoints = [
        () =>
            `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${qStr}${buildCrumb()}`,
        () =>
            `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${qStr}`,
    ];

    let retried = false;
    for (let i = 0; i < endpoints.length; i++) {
        const url = endpoints[i]();
        try {
            const response = await fetch(url, {
                headers: baseHeaders(),
                signal: AbortSignal.timeout(10000),
            });
            if (response.ok) {
                const json = await response.json();
                const quotes =
                    (json.quoteResponse && json.quoteResponse.result) || [];
                if (quotes.length > 0) {
                    const now = Date.now();
                    quotes.forEach((q) => {
                        pricesCache.data[q.symbol] = {
                            price: q.regularMarketPrice,
                            changePercent: q.regularMarketChangePercent || 0,
                            fetchedAt: now,
                        };
                    });
                    console.log(`[Prices] Updated ${quotes.length} quote(s).`);
                    return res.json(pickSymbols(uniqueSymbols));
                }
            } else if (
                (response.status === 401 || response.status === 403) &&
                !retried
            ) {
                console.warn(
                    `[Prices] Auth error ${response.status}, refreshing crumb...`,
                );
                await refreshYahooCrumb();
                retried = true;
                i--; // retry the same endpoint with the refreshed crumb
            } else {
                console.warn(`[Prices] Endpoint status: ${response.status}`);
            }
        } catch (err) {
            console.warn('[Prices] Fetch error:', err.message);
        }
    }

    const stale = pickSymbols(uniqueSymbols);
    console.warn(
        `[Prices] All endpoints failed. Returning stale cache (${Object.keys(stale).length} items).`,
    );
    res.json(stale);
});

module.exports = router;
