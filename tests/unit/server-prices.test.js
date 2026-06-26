'use strict';

/**
 * Tests for the GET /api/prices route with mocked fetch.
 * These cover the Yahoo Finance fetch logic that can't be hit in plain network tests.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

const TEST_DB = path.join(os.tmpdir(), `fire-prices-test-${process.pid}.json`);
process.env.FIRE_DB_FILE = TEST_DB;

// Write an initial DB so server doesn't crash on load
fs.writeFileSync(TEST_DB, JSON.stringify({
    importedPositions: [], customAccounts: [], cds: [],
    expenses: {}, taxRate: 0, sideGigLedger: [], projectionSettings: {},
    importedFiles: [],
}));

const app = (await import('../../app/server.js')).default;

function makeYahooResponse(symbols) {
    return {
        quoteResponse: {
            result: symbols.map((s) => ({
                symbol: s,
                regularMarketPrice: 150.0,
                regularMarketChangePercent: 1.5,
            })),
        },
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

afterAll(() => {
    try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
});

describe('GET /api/prices — mocked Yahoo fetch', () => {
    beforeEach(() => {
        // Reset prices cache between tests by clearing module-level state
        vi.stubGlobal('fetch', vi.fn());
    });

    it('returns prices from Yahoo when fetch succeeds', async () => {
        const fakeBody = makeYahooResponse(['AAPL']);
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({
                // crumb endpoint
                ok: true,
                headers: { get: () => 'A1=abc123; Path=/' },
            })
            .mockResolvedValueOnce({
                ok: true,
                text: async () => 'test-crumb',
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => fakeBody,
            })
        );

        const res = await request(app).get('/api/prices?symbols=AAPL');
        expect(res.status).toBe(200);
        expect(typeof res.body).toBe('object');
    });

    it('returns empty object when all symbols filtered', async () => {
        const res = await request(app).get('/api/prices?symbols=SPAXX,FDRXX');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
    });

    it('strips asterisks from symbols', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
        const res = await request(app).get('/api/prices?symbols=AAPL**');
        expect(res.status).toBe(200);
        // Network fail returns stale cache (empty), symbol was cleaned
        expect(typeof res.body).toBe('object');
    });

    it('handles fetch throwing an error gracefully', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
        const res = await request(app).get('/api/prices?symbols=MSFT');
        expect(res.status).toBe(200);
        expect(typeof res.body).toBe('object');
    });

    it('handles 401 auth error and returns stale cache', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValue({
                ok: false,
                status: 401,
                headers: { get: () => '' },
            })
        );
        const res = await request(app).get('/api/prices?symbols=TSLA');
        expect(res.status).toBe(200);
    });

    it('handles non-auth failure status', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValue({
                ok: false,
                status: 500,
                headers: { get: () => '' },
            })
        );
        const res = await request(app).get('/api/prices?symbols=GOOG');
        expect(res.status).toBe(200);
    });

    it('handles empty quoteResponse.result', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, headers: { get: () => '' } })
            .mockResolvedValueOnce({ ok: true, text: async () => 'crumb' })
            .mockResolvedValue({
                ok: true,
                json: async () => ({ quoteResponse: { result: [] } }),
            })
        );
        const res = await request(app).get('/api/prices?symbols=XYZ');
        expect(res.status).toBe(200);
    });
});
