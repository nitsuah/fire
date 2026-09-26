import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import deletion from '../../netlify/functions/ebay-marketplace-account-deletion.mjs';
import authorize from '../../netlify/functions/ebay-authorize.mjs';
import callback from '../../netlify/functions/ebay-callback.mjs';
import sync from '../../netlify/functions/ebay-sync.mjs';
import cryptoUtils from '../../app/lib/crypto-utils.js';
import ebayConnector from '../../app/lib/ebay-connector.js';

// Netlify Functions serving the eBay routes on the browser-only deploy
// (netlify/functions/ebay-*.mjs, Request → Response). Handlers are called
// directly with Web Request objects.
const { encrypt, decrypt } = cryptoUtils;
const BASE = 'https://lifefire.netlify.app/api/sync/ebay';
const ENDPOINT = `${BASE}/marketplace-account-deletion`;
const TOKEN = 'b'.repeat(64);
const ENV = {
    EBAY_VERIFICATION_TOKEN: TOKEN,
    EBAY_NOTIFICATION_ENDPOINT_URL: ENDPOINT,
    EBAY_CLIENT_ID: 'test-client-id',
    EBAY_CLIENT_SECRET: 'test-client-secret',
    EBAY_REDIRECT_URI: 'Test_RuName-test',
    // Test-only 64-hex-char key, not a real secret.
    SYNC_MASTER_KEY: '22'.repeat(32),
};
const saved = {};

beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) {
        saved[k] = process.env[k];
        process.env[k] = v;
    }
    ebayConnector.resetNotificationKeyCache();
});

afterEach(() => {
    for (const k of Object.keys(ENV)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const notification = {
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0' },
    notification: {
        notificationId: 'notif-123',
        data: { username: 'secret-user', userId: 'secret-id', eiasToken: 'x' },
    },
};

const get = (url, headers = {}) => new Request(url, { headers });
const post = (url, body, headers = {}) =>
    new Request(url, {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });

describe('ebay-marketplace-account-deletion function', () => {
    it('answers the challenge with sha256(code + token + endpoint)', async () => {
        const res = await deletion(get(`${ENDPOINT}?challenge_code=abc123`));
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json');
        const expected = crypto
            .createHash('sha256')
            .update('abc123' + TOKEN + ENDPOINT)
            .digest('hex');
        expect(await res.json()).toEqual({ challengeResponse: expected });
    });

    it('rejects a missing challenge_code with 400', async () => {
        const res = await deletion(get(ENDPOINT));
        expect(res.status).toBe(400);
    });

    it.each(['EBAY_VERIFICATION_TOKEN', 'EBAY_NOTIFICATION_ENDPOINT_URL'])(
        'returns 500 and never hashes when %s is missing',
        async (name) => {
            delete process.env[name];
            const err = vi.spyOn(console, 'error').mockImplementation(() => {});
            const hash = vi.spyOn(crypto, 'createHash');
            const res = await deletion(
                get(`${ENDPOINT}?challenge_code=abc123`),
            );
            expect(res.status).toBe(500);
            expect((await res.json()).challengeResponse).toBeUndefined();
            expect(hash).not.toHaveBeenCalled();
            expect(err.mock.calls.flat().join(' ')).toContain(name);
        },
    );

    it('rejects other methods with 405', async () => {
        const res = await deletion(new Request(ENDPOINT, { method: 'PUT' }));
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('GET, POST');
    });

    it('acks a deletion notification without logging PII (no app credentials)', async () => {
        delete process.env.EBAY_CLIENT_ID;
        delete process.env.EBAY_CLIENT_SECRET;
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const res = await deletion(post(ENDPOINT, notification));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'acknowledged' });
        const logged = log.mock.calls.flat().join(' ');
        expect(logged).toContain('notif-123');
        expect(logged).not.toMatch(/secret-user|secret-id/);
    });

    it('rejects a notification with a missing signature when credentials exist', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const res = await deletion(post(ENDPOINT, notification));
        expect(res.status).toBe(412);
    });

    it('rejects malformed JSON and wrong topics with 400', async () => {
        delete process.env.EBAY_CLIENT_ID;
        const bad = await deletion(post(ENDPOINT, '{'));
        expect(bad.status).toBe(400);
        const wrong = await deletion(
            post(ENDPOINT, { metadata: { topic: 'OTHER' }, notification: {} }),
        );
        expect(wrong.status).toBe(400);
    });
});

describe('ebay-authorize / ebay-callback functions', () => {
    it('redirects to eBay with a state cookie', async () => {
        const res = await authorize(get(`${BASE}/authorize`));
        expect(res.status).toBe(302);
        const location = new URL(res.headers.get('Location'));
        const state = location.searchParams.get('state');
        expect(location.searchParams.get('redirect_uri')).toBe(
            'Test_RuName-test',
        );
        const setCookie = res.headers.get('Set-Cookie');
        expect(setCookie).toContain(`ebay_oauth_state=${state};`);
        expect(setCookie).toMatch(/HttpOnly; Secure/);
    });

    it('returns 503 when OAuth env is missing', async () => {
        delete process.env.EBAY_REDIRECT_URI;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = await authorize(get(`${BASE}/authorize`));
        expect(res.status).toBe(503);
    });

    it('rejects a callback whose state does not match the cookie', async () => {
        const res = await callback(
            get(`${BASE}/callback?code=c&state=aaaa`, {
                cookie: 'ebay_oauth_state=bbbb',
            }),
        );
        expect(res.headers.get('Location')).toBe('/#ebay-error=invalid_state');
    });

    it('exchanges the code and returns an encrypted blob in the fragment', async () => {
        const tokens = { access_token: 'at', refresh_token: 'rt' };
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify(tokens))),
        );
        const res = await callback(
            get(`${BASE}/callback?code=c&state=abcd`, {
                cookie: 'other=1; ebay_oauth_state=abcd',
            }),
        );
        const match = res.headers
            .get('Location')
            .match(/^\/#ebay-connected=(.+)$/);
        expect(match).not.toBeNull();
        const blob = decodeURIComponent(match[1]);
        expect(blob).not.toContain('rt');
        expect(JSON.parse(decrypt(blob))).toEqual(tokens);
        expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    });
});

describe('ebay-sync function', () => {
    const blob = () =>
        encrypt(JSON.stringify({ access_token: 'old', refresh_token: 'rt' }));

    it('returns ledger entries for a valid blob', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            orders: [
                                {
                                    orderId: 'O1',
                                    creationDate: '2026-09-01T00:00:00Z',
                                    pricingSummary: { total: { value: '10' } },
                                },
                            ],
                        }),
                    ),
            ),
        );
        const res = await sync(post(`${BASE}/sync`, { tokens: blob() }));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.entries[0].id).toBe('ebay-O1');
        expect(data.tokens).toBeUndefined();
    });

    it('returns 401 ebay_revoked when the refresh token is rejected', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) =>
                String(url).includes('/oauth2/token')
                    ? new Response('{"error":"invalid_grant"}', { status: 400 })
                    : new Response('unauthorized', { status: 401 }),
            ),
        );
        const res = await sync(post(`${BASE}/sync`, { tokens: blob() }));
        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('ebay_revoked');
    });

    it('returns 401 ebay_token_invalid for an unreadable blob', async () => {
        const res = await sync(post(`${BASE}/sync`, { tokens: 'garbage' }));
        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('ebay_token_invalid');
    });

    it('rejects GET with 405', async () => {
        const res = await sync(get(`${BASE}/sync`));
        expect(res.status).toBe(405);
    });
});
