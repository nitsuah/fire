'use strict';

const express = require('express');
const { pricesCache, refreshYahooCrumb } = require('../lib/yahoo-prices');
const { fetchPrices, getProvider } = require('../lib/prices-provider');

const router = express.Router();
const CACHE_TTL_MS = 300000; // 5 minutes per symbol

// SSE subscribers: Map<res, Set<string>>
const sseClients = new Map();

function pickSymbols(symbols) {
    return Object.fromEntries(
        symbols
            .filter((s) => pricesCache.data[s] !== undefined)
            .map((s) => [s, pricesCache.data[s]]),
    );
}

function allFresh(symbols) {
    const now = Date.now();
    return symbols.every((s) => {
        const entry = pricesCache.data[s];
        return entry !== undefined && now - entry.fetchedAt < CACHE_TTL_MS;
    });
}

function broadcastToSubscribers(updates) {
    const payload = `data: ${JSON.stringify(updates)}\n\n`;
    for (const [res] of sseClients) {
        try {
            res.write(payload);
        } catch {
            sseClients.delete(res);
        }
    }
}

router.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.set(res, true);
    res.write(
        `data: ${JSON.stringify({ connected: true, provider: getProvider() })}\n\n`,
    );

    req.on('close', () => {
        sseClients.delete(res);
    });
});

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

    const provider = getProvider();

    if (provider !== 'yahoo') {
        // Use the multi-provider abstraction
        try {
            const results = await fetchPrices(uniqueSymbols);
            const now = Date.now();
            for (const [symbol, price] of Object.entries(results)) {
                if (price != null) {
                    pricesCache.data[symbol] = {
                        price,
                        changePercent: 0,
                        fetchedAt: now,
                    };
                }
            }
            const fresh = pickSymbols(uniqueSymbols);
            if (Object.keys(fresh).length > 0) {
                broadcastToSubscribers(fresh);
                console.log(
                    `[Prices] Updated ${Object.keys(fresh).length} quote(s) via ${provider}.`,
                );
                return res.json(fresh);
            }
        } catch (err) {
            console.warn('[Prices] Provider fetch failed:', err.message);
        }
        // Fall back to Yahoo if provider failed
    }

    // Yahoo Finance path (existing logic)
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
                    const fresh = pickSymbols(uniqueSymbols);
                    broadcastToSubscribers(fresh);
                    console.log(`[Prices] Updated ${quotes.length} quote(s).`);
                    return res.json(fresh);
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
                i--;
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
