'use strict';

const express = require('express');
const { pricesCache, refreshYahooCrumb } = require('../lib/yahoo-prices');

const router = express.Router();

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
    const now = Date.now();

    if (now - pricesCache.timestamp < 300000) {
        const allInCache = uniqueSymbols.every(
            (s) => pricesCache.data[s] !== undefined,
        );
        if (allInCache) {
            console.log(
                `[Prices] Serving ${uniqueSymbols.length} symbol(s) from cache.`,
            );
            return res.json(pricesCache.data);
        }
    }

    if (!pricesCache.crumb) {
        await refreshYahooCrumb();
    }

    const baseHeaders = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: pricesCache.cookie,
    };

    const qStr = encodeURIComponent(uniqueSymbols.join(','));
    const crumbParam = pricesCache.crumb
        ? `&crumb=${encodeURIComponent(pricesCache.crumb)}`
        : '';

    const endpoints = [
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${qStr}${crumbParam}`,
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${qStr}`,
        `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${qStr}&fields=regularMarketPrice,regularMarketChangePercent${crumbParam}`,
    ];

    for (const url of endpoints) {
        try {
            const response = await fetch(url, {
                headers: baseHeaders,
                signal: AbortSignal.timeout(10000),
            });
            if (response.ok) {
                const json = await response.json();
                const quotes =
                    (json.quoteResponse && json.quoteResponse.result) || [];
                if (quotes.length > 0) {
                    quotes.forEach((q) => {
                        pricesCache.data[q.symbol] = {
                            price: q.regularMarketPrice,
                            changePercent: q.regularMarketChangePercent || 0,
                        };
                    });
                    pricesCache.timestamp = now;
                    console.log(`[Prices] Updated ${quotes.length} quote(s).`);
                    return res.json(pricesCache.data);
                }
            } else if (response.status === 401 || response.status === 403) {
                console.warn(
                    `[Prices] Auth error ${response.status}, refreshing crumb...`,
                );
                await refreshYahooCrumb();
                baseHeaders['Cookie'] = pricesCache.cookie;
                const refreshedCrumb = pricesCache.crumb
                    ? `&crumb=${encodeURIComponent(pricesCache.crumb)}`
                    : '';
                endpoints[0] = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${qStr}${refreshedCrumb}`;
                endpoints[2] = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${qStr}&fields=regularMarketPrice,regularMarketChangePercent${refreshedCrumb}`;
            } else {
                console.warn(`[Prices] Endpoint status: ${response.status}`);
            }
        } catch (err) {
            console.warn('[Prices] Fetch error:', err.message);
        }
    }

    console.warn(
        `[Prices] All endpoints failed. Returning stale cache (${Object.keys(pricesCache.data).length} items).`,
    );
    res.json(pricesCache.data);
});

module.exports = router;
