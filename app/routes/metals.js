'use strict';

const express = require('express');
const { resolveMetalValue } = require('../lib/metals-prices');

const router = express.Router();

// Cache for metals prices (simple in-memory)
const metalsCache = {
    gold: { price: null, fetchedAt: 0 },
    silver: { price: null, fetchedAt: 0 },
};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchAndCacheMetal(metal) {
    const now = Date.now();
    const cached = metalsCache[metal];
    if (cached.price !== null && now - cached.fetchedAt < CACHE_TTL_MS) {
        return { price: cached.price, cached: true };
    }
    try {
        const result = await resolveMetalValue(metal, 1); // Get price per oz
        metalsCache[metal] = { price: result.pricePerOz, fetchedAt: now };
        return {
            price: result.pricePerOz,
            cached: false,
            source: result.source,
        };
    } catch (err) {
        console.warn(`[Metals] Failed to fetch ${metal}:`, err.message);
        if (cached.price !== null) {
            return { price: cached.price, cached: true, stale: true };
        }
        throw err;
    }
}

router.get('/', async (req, res) => {
    const { metal } = req.query;
    const metals = metal ? [metal.toLowerCase()] : ['gold', 'silver'];
    const results = {};

    for (const m of metals) {
        if (m !== 'gold' && m !== 'silver') continue;
        try {
            const data = await fetchAndCacheMetal(m);
            results[m] = data;
        } catch (err) {
            results[m] = { error: err.message };
        }
    }

    res.json(results);
});

// SSE endpoint for real-time metals updates
const metalsSseClients = new Map();

function broadcastMetalsUpdate(updates) {
    const payload = `data: ${JSON.stringify(updates)}\n\n`;
    for (const [res] of metalsSseClients) {
        try {
            res.write(payload);
        } catch {
            metalsSseClients.delete(res);
        }
    }
}

router.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    metalsSseClients.set(res, true);
    res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

    req.on('close', () => {
        metalsSseClients.delete(res);
    });
});

// Background refresh every 5 minutes. unref() so this timer alone never
// keeps the process alive (the HTTP server does that when actually
// listening; a bare require() of server.js — tests, tooling — must exit).
const metalsRefreshInterval = setInterval(async () => {
    try {
        const updates = {};
        for (const metal of ['gold', 'silver']) {
            const data = await fetchAndCacheMetal(metal);
            if (!data.cached || data.stale) {
                updates[metal] = data;
            }
        }
        if (Object.keys(updates).length > 0) {
            broadcastMetalsUpdate(updates);
            console.log(
                '[Metals] Broadcast updates:',
                Object.keys(updates).join(', '),
            );
        }
    } catch (err) {
        console.warn('[Metals] Background refresh failed:', err.message);
    }
}, CACHE_TTL_MS);
metalsRefreshInterval.unref();

module.exports = router;
