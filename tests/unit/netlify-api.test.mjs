import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import handler from '../../netlify/functions/fire-api.mjs';

describe('hosted fire API', () => {
    it('returns JSON for unsupported hosted endpoints', async () => {
        const result = await handler(
            new Request('https://lifefire.netlify.app/api/does-not-exist'),
        );

        expect(result.status).toBe(404);
        expect(result.headers.get('Content-Type')).toContain(
            'application/json',
        );

        const body = await result.json();
        expect(body.error).toContain(
            'not available in the hosted browser deployment',
        );
        expect(body.path).toBe('/api/does-not-exist');
    });

    it('routes /api/sync/plaid/* to the Plaid function before the generic fallback', () => {
        // Plaid is served by netlify/functions/plaid.mjs; fire-api.mjs must
        // never see those paths.
        const toml = fs.readFileSync(
            path.join(process.cwd(), 'netlify.toml'),
            'utf8',
        );
        const plaidRule = toml.indexOf('from = "/api/sync/plaid/*"');
        const fallbackRule = toml.indexOf('from = "/api/*"');
        expect(plaidRule).toBeGreaterThan(-1);
        expect(fallbackRule).toBeGreaterThan(plaidRule);
        expect(toml.slice(plaidRule, fallbackRule)).toContain(
            'to = "/.netlify/functions/plaid/:splat"',
        );
    });

    it('routes /api/backup/drive and /api/backup/drive/* to the Drive backup function, not the catch-all', () => {
        // The hosted Drive backup used to fall through to fire-api.mjs and
        // return "not available in the hosted browser deployment".
        const toml = fs.readFileSync(
            path.join(process.cwd(), 'netlify.toml'),
            'utf8',
        );
        const fallbackRule = toml.indexOf('from = "/api/*"');
        for (const [from, to] of [
            ['/api/backup/drive', '/.netlify/functions/gdrive-backup'],
            ['/api/backup/drive/*', '/.netlify/functions/gdrive-backup/:splat'],
        ]) {
            const rule = toml.indexOf(`from = "${from}"`);
            expect(rule).toBeGreaterThan(-1);
            expect(fallbackRule).toBeGreaterThan(rule);
            const block = toml.slice(rule, toml.indexOf('[[redirects]]', rule));
            expect(block).toContain(`to = "${to}"`);
            expect(block).toContain('status = 200');
            expect(block).toContain('force = true');
        }
        expect(
            fs.existsSync(
                path.join(process.cwd(), 'netlify/functions/gdrive-backup.mjs'),
            ),
        ).toBe(true);
    });

    it('routes /api/sync/ebay/status to the status function, not the catch-all', () => {
        const toml = fs.readFileSync(
            path.join(process.cwd(), 'netlify.toml'),
            'utf8',
        );
        const rule = toml.indexOf('from = "/api/sync/ebay/status"');
        const fallbackRule = toml.indexOf('from = "/api/*"');
        expect(rule).toBeGreaterThan(-1);
        expect(fallbackRule).toBeGreaterThan(rule);
        const block = toml.slice(rule, toml.indexOf('[[redirects]]', rule));
        expect(block).toContain('to = "/.netlify/functions/ebay-status"');
        expect(block).toContain('status = 200');
        expect(block).toContain('force = true');
    });
});

describe('hosted fire API — quotes', () => {
    afterEach(() => vi.unstubAllGlobals());

    // Without this route every price refresh on the hosted deploy 404'd, so
    // quotes stayed pinned at the last import's values (#218).
    it('serves /api/prices and returns per-symbol quotes', async () => {
        const asked = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                asked.push(String(url));
                return new Response(
                    JSON.stringify({
                        chart: {
                            result: [
                                {
                                    meta: {
                                        regularMarketPrice: 100,
                                        chartPreviousClose: 98,
                                    },
                                },
                            ],
                        },
                    }),
                    { status: 200 },
                );
            }),
        );
        const res = await handler(
            new Request('https://lifefire.netlify.app/api/prices?symbols=VTI'),
        );
        expect(res.status).toBe(200);
        // Chart path, not the crumb-gated v7 quote API.
        expect(asked[0]).toContain('/v8/finance/chart/VTI');
        expect(asked[0]).not.toContain('/v7/finance/quote');
        await expect(res.json()).resolves.toEqual({
            VTI: { price: 100, changePercent: expect.any(Number) },
        });
    });

    it('filters cash and junk symbols and bounds the fan-out', async () => {
        const asked = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                asked.push(String(url));
                return new Response(JSON.stringify({ chart: { result: [] } }), {
                    status: 200,
                });
            }),
        );
        await handler(
            new Request(
                `https://lifefire.netlify.app/api/prices?symbols=${encodeURIComponent(
                    'SPAXX,FDRXX,123,FCASH,VTI,VTI',
                )}`,
            ),
        );
        // VTI only, and deduped.
        expect(asked).toHaveLength(1);
        expect(asked[0]).toContain('/chart/VTI');
    });

    it('returns an empty object (not an error) when Yahoo fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('network down');
            }),
        );
        const res = await handler(
            new Request('https://lifefire.netlify.app/api/prices?symbols=VTI'),
        );
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({});
    });

    it('returns an empty object when no symbols are given', async () => {
        const res = await handler(
            new Request('https://lifefire.netlify.app/api/prices'),
        );
        await expect(res.json()).resolves.toEqual({});
    });
});

describe('hosted fire API — account refreshes', () => {
    afterEach(() => vi.unstubAllGlobals());

    const post = (body) =>
        new Request(
            'https://lifefire.netlify.app/api/accounts/refresh-crypto',
            {
                method: 'POST',
                body: JSON.stringify(body),
            },
        );

    it('never imports ethers (it is not in the Netlify bundle and crashed every route)', () => {
        const src = fs.readFileSync(
            path.join(process.cwd(), 'netlify/functions/fire-api.mjs'),
            'utf8',
        );
        expect(src).not.toMatch(/from ['"].*ens-resolver/);
        expect(src).not.toMatch(/['"]ethers['"]/);
    });

    it('prices a ticker account', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                Response.json({
                    chart: { result: [{ meta: { regularMarketPrice: 2000 } }] },
                }),
            ),
        );
        const res = await handler(post({ identifier: 'ETH', quantity: 1.5 }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
            usdValue: 3000,
            ticker: 'ETH',
        });
    });

    it('values an ENS account across chains via the ethers-free resolver', async () => {
        const addr = '0x' + 'a'.repeat(40);
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                const u = String(url);
                if (u.startsWith('https://ensdata.net/'))
                    return Response.json({ address: addr });
                if (u === `https://eth.blockscout.com/api/v2/addresses/${addr}`)
                    // 0.5 ETH at $2000
                    return Response.json({
                        coin_balance: '500000000000000000',
                        exchange_rate: '2000',
                    });
                if (u.endsWith('/token-balances')) return Response.json([]);
                if (u.includes('/api/v2/addresses/'))
                    return Response.json({
                        coin_balance: '0',
                        exchange_rate: '2000',
                    });
                // RPC-only chains: empty
                return Response.json({ result: '0x0' });
            }),
        );
        const res = await handler(post({ identifier: 'nitsuah.eth' }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            usdValue: 1000,
            resolvedAddress: addr,
            partial: false,
        });
        expect(body.chains).toEqual([
            expect.objectContaining({ chain: 'ethereum', usdValue: 1000 }),
        ]);
    });

    it('rejects a missing identifier and a ticker without quantity', async () => {
        expect((await handler(post({}))).status).toBe(400);
        expect((await handler(post(null))).status).toBe(400);
        expect((await handler(post([]))).status).toBe(400);
        const res = await handler(post({ identifier: 'BTC' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/Quantity is required/);
    });
});
