import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../../netlify/functions/etsy.mjs';
import etsy from '../../app/lib/etsy-connector.js';

// netlify/functions/etsy.mjs on the browser-only deploy. Etsy is a stubbed
// global fetch; the function never stores anything.
const BASE = 'https://lifefire.netlify.app/api/sync/etsy';
const ENV = {
    ETSY_CLIENT_ID: 'testkeystring',
    // Test-only 64-hex-char key, not a real secret.
    SYNC_MASTER_KEY: '55'.repeat(32),
};
const saved = {};

beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) {
        saved[k] = process.env[k];
        process.env[k] = v;
    }
});

afterEach(() => {
    for (const k of Object.keys(ENV)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const jsonRes = (status, body) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const post = (action, body) =>
    handler(
        new Request(`${BASE}/${action}`, {
            method: 'POST',
            body: JSON.stringify(body),
        }),
    );

describe('netlify etsy function', () => {
    it('authorize redirects with a Secure PKCE cookie and the derived callback', async () => {
        const res = await handler(new Request(`${BASE}/authorize`));
        expect(res.status).toBe(302);
        const location = new URL(res.headers.get('location'));
        expect(location.searchParams.get('redirect_uri')).toBe(
            `${BASE}/callback`,
        );
        expect(res.headers.get('set-cookie')).toMatch(/; Secure$/);
    });

    it('callback hands the browser a sealed token blob in the fragment', async () => {
        const auth = await handler(new Request(`${BASE}/authorize`));
        const state = new URL(auth.headers.get('location')).searchParams.get(
            'state',
        );
        const cookie = auth.headers.get('set-cookie').split(';')[0];
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonRes(200, {
                    access_token: '7.plain',
                    refresh_token: 'rt',
                    expires_in: 3600,
                }),
            ),
        );
        const res = await handler(
            new Request(`${BASE}/callback?code=c&state=${state}`, {
                headers: { cookie },
            }),
        );
        const location = res.headers.get('location');
        const match = location.match(/^\/#etsy-connected=(.+)$/);
        expect(match).not.toBeNull();
        expect(location).not.toContain('7.plain');
        expect(etsy.unsealTokens(decodeURIComponent(match[1]))).toMatchObject({
            access_token: '7.plain',
        });
    });

    it('sync returns ledger entries and a resealed blob when tokens change', async () => {
        const blob = etsy.sealTokens({
            access_token: '7.a',
            refresh_token: 'rt',
            expires_at: Date.now() + 3600_000,
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) =>
                String(url).endsWith('/users/me')
                    ? jsonRes(200, { user_id: 7, shop_id: 99 })
                    : jsonRes(200, {
                          results: [
                              {
                                  receipt_id: 31,
                                  is_paid: true,
                                  status: 'Paid',
                                  grandtotal: { amount: 1000, divisor: 100 },
                                  transactions: [
                                      { title: 'Print', quantity: 1 },
                                  ],
                              },
                          ],
                      }),
            ),
        );
        const res = await post('sync', { tokens: blob, since: 'garbage' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.entries.map((e) => e.id)).toEqual(['etsy-31']);
        expect(etsy.unsealTokens(body.tokens).shop_id).toBe('99');
        // An unparseable `since` is ignored rather than sent to Etsy.
        expect(String(fetch.mock.calls[1][0])).not.toContain('min_created');
    });

    it('sync rejects an unreadable blob with a drop-it code', async () => {
        const res = await post('sync', { tokens: 'not-a-blob' });
        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('etsy_token_invalid');
    });

    it('sync reports a revoked grant', async () => {
        const blob = etsy.sealTokens({
            access_token: '7.a',
            refresh_token: 'rt',
            expires_at: Date.now() - 1,
            shop_id: '99',
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonRes(400, { error: 'invalid_grant' })),
        );
        const res = await post('sync', { tokens: blob });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.code).toBe('etsy_revoked');
        expect(body.tokens).toBeUndefined();
    });

    it('fails closed when unconfigured and 404s browser-side actions', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect((await post('status', {})).status).toBe(404);
        expect((await handler(new Request(`${BASE}/sync`))).status).toBe(405);
        delete process.env.ETSY_CLIENT_ID;
        expect((await post('sync', {})).status).toBe(503);
        const auth = await handler(new Request(`${BASE}/authorize`));
        expect(auth.headers.get('location')).toBe(
            '/#etsy-error=not_configured',
        );
    });
});
