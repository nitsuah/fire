import { vi, describe, it, expect, afterEach, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

const TEST_DB = path.join(os.tmpdir(), `fire-metals-test-${process.pid}.json`);
process.env.FIRE_DB_FILE = TEST_DB;
// Drives /api/metals unauthenticated (auth gate is covered elsewhere).
process.env.FIRE_AUTH_DISABLED = 'true';
fs.writeFileSync(TEST_DB, JSON.stringify({ customAccounts: [], cds: [] }));

const app = (await import('../../app/server.js')).default;

const yahooQuote = (price) => ({
    ok: true,
    json: async () => ({
        chart: { result: [{ meta: { regularMarketPrice: price } }] },
    }),
});

afterEach(() => {
    vi.unstubAllGlobals();
});

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        // ignore
    }
});

describe('GET /api/metals', () => {
    it('returns spot plus the payout-adjusted melt price per metal', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockImplementation(async (url) =>
                    yahooQuote(String(url).includes('GC%3DF') ? 4000 : 50),
                ),
        );
        const res = await request(app).get('/api/metals');
        expect(res.status).toBe(200);
        expect(res.body.gold.price).toBe(4000);
        expect(res.body.gold.payoutPct).toBe(0.95);
        expect(res.body.gold.meltPrice).toBeCloseTo(3800, 6);
        expect(res.body.silver.price).toBe(50);
        expect(res.body.silver.payoutPct).toBe(0.88);
        expect(res.body.silver.meltPrice).toBeCloseTo(44, 6);
    });

    it('ignores unsupported metals', async () => {
        const res = await request(app).get('/api/metals?metal=platinum');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
    });

    it('does not 500 on a repeated ?metal= parameter', async () => {
        const res = await request(app).get(
            '/api/metals?metal=gold&metal=silver',
        );
        expect(res.status).toBe(200);
    });
});
