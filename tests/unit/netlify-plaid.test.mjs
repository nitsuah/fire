import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const MASTER_KEY = '22'.repeat(32);
const BASE = 'https://lifefire.netlify.app/api/sync/plaid';

// Routes stubbed Plaid calls by API path; each route returns a JSON body, or
// [status, body] for an error. Every call gets a fresh Response.
function plaidMock(routes) {
    return vi.fn(async (url, init) => {
        const route = routes[new URL(url).pathname];
        if (!route) throw new Error(`unexpected Plaid call ${url}`);
        const result = await route(JSON.parse(init.body));
        const [status, body] = Array.isArray(result) ? result : [200, result];
        return new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
        });
    });
}

function statusRequest(token) {
    return new Request(`${BASE}/status`, {
        headers: token ? { 'x-fire-plaid-token': token } : {},
    });
}

function postRequest(endpoint, token, body) {
    return new Request(`${BASE}/${endpoint}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(token ? { 'x-fire-plaid-token': token } : {}),
        },
        body: JSON.stringify(body || {}),
    });
}

// Links each access token in turn and returns the resulting browser token.
async function linkItems(handler, accessTokens) {
    let token = '';
    for (const accessToken of accessTokens) {
        vi.stubGlobal(
            'fetch',
            plaidMock({
                '/item/public_token/exchange': () => ({
                    access_token: accessToken,
                    item_id: accessToken.replace('access', 'item'),
                }),
            }),
        );
        const res = await handler(
            postRequest('exchange', null, {
                public_token: 'public-sandbox',
                ...(token ? { plaidToken: token } : {}),
            }),
        );
        token = (await res.json()).plaidToken;
    }
    return token;
}

describe('hosted Plaid Netlify function', () => {
    beforeEach(() => {
        process.env.PLAID_CLIENT_ID = 'client-id';
        process.env.PLAID_SECRET = 'secret';
        process.env.PLAID_ENV = 'sandbox';
        process.env.SYNC_MASTER_KEY = MASTER_KEY;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        delete process.env.PLAID_HOSTED_ACCESS_KEY;
        delete process.env.PLAID_CLIENT_ID;
        delete process.env.PLAID_SECRET;
        delete process.env.PLAID_ENV;
        delete process.env.SYNC_MASTER_KEY;
        vi.resetModules();
    });

    it('creates a Link token', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(
                () =>
                    new Response(
                        JSON.stringify({ link_token: 'link-sandbox' }),
                        {
                            status: 200,
                            headers: { 'content-type': 'application/json' },
                        },
                    ),
            ),
        );

        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/create-link-token',
                { method: 'POST' },
            ),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ linkToken: 'link-sandbox' });
    });

    it('rate-limits hosted Link token creation without an Origin header', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(
                () =>
                    new Response(
                        JSON.stringify({ link_token: 'link-sandbox' }),
                        {
                            status: 200,
                            headers: { 'content-type': 'application/json' },
                        },
                    ),
            ),
        );

        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');

        for (let i = 0; i < 10; i++) {
            const response = await handler(
                new Request(
                    'https://lifefire.netlify.app/api/sync/plaid/create-link-token',
                    { method: 'POST' },
                ),
            );
            expect(response.status).toBe(200);
        }

        const limited = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/create-link-token',
                { method: 'POST' },
            ),
        );
        expect(limited.status).toBe(429);
    });

    it('exchanges a public token into an encrypted browser token', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        access_token: 'access-secret',
                        item_id: 'item-1',
                    }),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            ),
        );

        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/exchange',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ public_token: 'public-sandbox' }),
                },
            ),
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.status).toBe('success');
        expect(body.plaidToken).toMatch(/^1\./);
        expect(body.plaidToken).not.toContain('access-secret');
    });

    it('returns disconnected status without a hosted token', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request('https://lifefire.netlify.app/api/sync/plaid/status', {
                method: 'GET',
            }),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            connected: false,
            itemCount: 0,
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('links a new item instead of failing when the stored token is unreadable', async () => {
        const fetchMock = plaidMock({
            '/item/public_token/exchange': () => ({
                access_token: 'access-new',
                item_id: 'item-new',
            }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/exchange',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        public_token: 'public-sandbox',
                        plaidToken: '1.invalid.invalid.invalid',
                    }),
                },
            ),
        );

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.warning).toMatch(/could not be read/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const status = await handler(statusRequest(body.plaidToken));
        expect((await status.json()).itemCount).toBe(1);
    });

    it('refreshes the encrypted token expiry on authenticated status', async () => {
        const plaidFetch = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    access_token: 'access-secret',
                    item_id: 'item-1',
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        );
        vi.stubGlobal('fetch', plaidFetch);
        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const exchange = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/exchange',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ public_token: 'public-sandbox' }),
                },
            ),
        );
        const token = (await exchange.json()).plaidToken;

        const status = await handler(
            new Request('https://lifefire.netlify.app/api/sync/plaid/status', {
                method: 'GET',
                headers: { 'x-fire-plaid-token': token },
            }),
        );

        expect(status.status).toBe(200);
        const body = await status.json();
        expect(body.connected).toBe(true);
        expect(body.plaidToken).toMatch(/^1\./);
        expect(body.plaidToken).not.toBe(token);
    });

    it('rejects a cross-origin hosted request', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request('https://lifefire.netlify.app/api/sync/plaid/status', {
                method: 'GET',
                headers: { origin: 'https://evil.example' },
            }),
        );

        expect(response.status).toBe(403);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('converts non-JSON Plaid failures to JSON', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response('Bad request', {
                    status: 400,
                    headers: { 'content-type': 'text/plain' },
                }),
            ),
        );

        const { default: handler } =
            await import('../../netlify/functions/plaid.mjs');
        const response = await handler(
            new Request(
                'https://lifefire.netlify.app/api/sync/plaid/create-link-token',
                { method: 'POST' },
            ),
        );

        expect(response.status).toBe(502);
        expect(response.headers.get('content-type')).toContain(
            'application/json',
        );
        expect((await response.json()).error).toContain(
            'Plaid returned a non-JSON response',
        );
    });
});

describe('hosted Plaid token integrity and configuration', () => {
    beforeEach(() => {
        process.env.PLAID_CLIENT_ID = 'client-id';
        process.env.PLAID_SECRET = 'secret';
        process.env.PLAID_ENV = 'sandbox';
        process.env.SYNC_MASTER_KEY = MASTER_KEY;
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        delete process.env.PLAID_HOSTED_ACCESS_KEY;
        delete process.env.PLAID_CLIENT_ID;
        delete process.env.PLAID_SECRET;
        delete process.env.PLAID_ENV;
        delete process.env.SYNC_MASTER_KEY;
        vi.resetModules();
    });

    async function loadHandler() {
        return (await import('../../netlify/functions/plaid.mjs')).default;
    }

    function mutatePart(token, index, mutate) {
        const parts = token.split('.');
        parts[index] = Buffer.from(
            mutate(Buffer.from(parts[index], 'base64url')),
        ).toString('base64url');
        return parts.join('.');
    }

    async function expectInvalidToken(handler, token) {
        const res = await handler(statusRequest(token));
        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('INVALID_TOKEN');
    }

    it('rejects a token whose ciphertext was altered', async () => {
        const handler = await loadHandler();
        const token = await linkItems(handler, ['access-1']);
        await expectInvalidToken(
            handler,
            mutatePart(token, 3, (buf) => {
                buf[0] ^= 1;
                return buf;
            }),
        );
    });

    it('rejects a truncated GCM auth tag', async () => {
        const handler = await loadHandler();
        const token = await linkItems(handler, ['access-1']);
        await expectInvalidToken(
            handler,
            mutatePart(token, 2, (buf) => buf.subarray(0, 4)),
        );
    });

    it('rejects a token sealed under a different master key', async () => {
        const handler = await loadHandler();
        const token = await linkItems(handler, ['access-1']);
        process.env.SYNC_MASTER_KEY = '33'.repeat(32);
        await expectInvalidToken(handler, token);
    });

    it('rejects a token idle past its rolling expiry', async () => {
        const handler = await loadHandler();
        const token = await linkItems(handler, ['access-1']);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 181 * 24 * 60 * 60 * 1000);
        await expectInvalidToken(handler, token);
    });

    it('refuses to exchange before calling Plaid when SYNC_MASTER_KEY is missing', async () => {
        delete process.env.SYNC_MASTER_KEY;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const handler = await loadHandler();
        const res = await handler(
            postRequest('exchange', null, { public_token: 'public-sandbox' }),
        );
        expect(res.status).toBe(503);
        expect((await res.json()).error).not.toContain('SYNC_MASTER_KEY');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to run outside the sandbox without an access key', async () => {
        process.env.PLAID_ENV = 'production';
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const handler = await loadHandler();
        const res = await handler(postRequest('create-link-token'));
        expect(res.status).toBe(503);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requires the configured access key on every request', async () => {
        process.env.PLAID_HOSTED_ACCESS_KEY = 'owner-key';
        const fetchMock = plaidMock({
            '/link/token/create': () => ({ link_token: 'lt' }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const handler = await loadHandler();

        const denied = await handler(postRequest('create-link-token'));
        expect(denied.status).toBe(401);
        expect((await denied.json()).code).toBe('ACCESS_KEY_REQUIRED');
        expect(fetchMock).not.toHaveBeenCalled();

        const allowed = await handler(
            new Request(`${BASE}/create-link-token`, {
                method: 'POST',
                headers: { 'x-fire-plaid-access': 'owner-key' },
            }),
        );
        expect(allowed.status).toBe(200);
    });

    it('serves the rewritten function URL form', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const handler = await loadHandler();
        const res = await handler(
            new Request(
                'https://lifefire.netlify.app/.netlify/functions/plaid/status',
            ),
        );
        expect(res.status).toBe(200);
        expect((await res.json()).connected).toBe(false);
    });
});

describe('hosted Plaid data sync', () => {
    beforeEach(() => {
        process.env.PLAID_CLIENT_ID = 'client-id';
        process.env.PLAID_SECRET = 'secret';
        process.env.PLAID_ENV = 'sandbox';
        process.env.SYNC_MASTER_KEY = MASTER_KEY;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        delete process.env.PLAID_CLIENT_ID;
        delete process.env.PLAID_SECRET;
        delete process.env.PLAID_ENV;
        delete process.env.SYNC_MASTER_KEY;
        vi.resetModules();
    });

    async function loadHandler() {
        return (await import('../../netlify/functions/plaid.mjs')).default;
    }

    const loginRequired = [
        400,
        {
            error_code: 'ITEM_LOGIN_REQUIRED',
            error_message: 'login required',
        },
    ];

    it('returns partial accounts with sanitized per-item failures', async () => {
        const handler = await loadHandler();
        const token = await linkItems(handler, ['access-1', 'access-2']);
        vi.stubGlobal(
            'fetch',
            plaidMock({
                '/accounts/balance/get': ({ access_token }) =>
                    access_token === 'access-1'
                        ? {
                              accounts: [
                                  {
                                      account_id: 'acc1',
                                      name: 'Checking',
                                      type: 'depository',
                                      balances: { current: 10 },
                                  },
                              ],
                          }
                        : loginRequired,
            }),
        );

        const res = await handler(postRequest('accounts', token));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.syncedItemIds).toEqual(['item-1']);
        expect(body.failedItems).toEqual([
            { itemId: 'item-2', code: 'ITEM_LOGIN_REQUIRED' },
        ]);
        expect(body.warning).toMatch(/Re-link/);
        expect(body.accounts).toEqual([
            expect.objectContaining({
                id: 'plaid-acc1',
                plaidItemId: 'item-1',
                type: 'Cash',
            }),
        ]);
        expect(JSON.stringify(body)).not.toContain('access-');
    });

    it('returns 502 with failures when every position fetch fails', async () => {
        const handler = await loadHandler();
        const token = await linkItems(handler, ['access-1']);
        vi.stubGlobal(
            'fetch',
            plaidMock({ '/investments/holdings/get': () => loginRequired }),
        );

        const res = await handler(postRequest('positions', token));
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toMatch(/Existing data preserved/);
        expect(body.failedItems).toEqual([
            { itemId: 'item-1', code: 'ITEM_LOGIN_REQUIRED' },
        ]);
    });

    it('carries the transaction cursor across pages and into the next sync', async () => {
        const handler = await loadHandler();
        const token = await linkItems(handler, ['access-1']);
        const cursors = [];
        vi.stubGlobal(
            'fetch',
            plaidMock({
                '/transactions/sync': ({ cursor }) => {
                    cursors.push(cursor);
                    return cursor === undefined
                        ? {
                              added: [
                                  {
                                      transaction_id: 'txn-1',
                                      amount: 12,
                                      date: '2026-01-05',
                                      name: 'Whole Foods',
                                      merchant_name: 'Whole Foods',
                                      pending: false,
                                      personal_finance_category: {
                                          primary: 'FOOD_AND_DRINK',
                                          detailed: 'FOOD_AND_DRINK_GROCERIES',
                                      },
                                  },
                              ],
                              has_more: true,
                              next_cursor: 'c1',
                          }
                        : { has_more: false, next_cursor: 'c2' };
                },
            }),
        );

        const first = await handler(postRequest('transactions', token));
        expect(first.status).toBe(200);
        const firstBody = await first.json();
        expect(firstBody.added).toBe(1);
        expect(firstBody.warning).toBeNull();
        await handler(postRequest('transactions', firstBody.plaidToken));
        expect(cursors).toEqual([undefined, 'c1', 'c2']);
    });

    it('keeps the original cursor for an item that hits the page cap while a sibling advances', async () => {
        const handler = await loadHandler();
        const token = await linkItems(handler, ['access-1', 'access-2']);
        const calls = { 'access-1': [], 'access-2': [] };
        vi.stubGlobal(
            'fetch',
            plaidMock({
                '/transactions/sync': ({ access_token, cursor }) => {
                    calls[access_token].push(cursor);
                    return access_token === 'access-1'
                        ? { has_more: true, next_cursor: 'endless' }
                        : { has_more: false, next_cursor: 'done' };
                },
            }),
        );

        const res = await handler(postRequest('transactions', token));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(calls['access-1']).toHaveLength(20);
        expect(body.failedItems).toEqual([
            { itemId: 'item-1', code: 'PAGINATION_LIMIT' },
        ]);

        calls['access-1'] = [];
        calls['access-2'] = [];
        await handler(postRequest('transactions', body.plaidToken));
        expect(calls['access-1'][0]).toBeUndefined();
        expect(calls['access-2'][0]).toBe('done');
    });
});
