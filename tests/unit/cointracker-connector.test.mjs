import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import ct from '../../app/lib/cointracker-connector.js';
import handlers from '../../app/lib/cointracker-handlers.js';
import fn from '../../netlify/functions/cointracker.mjs';

// CoinTracker connector (OAuth + read-only MCP client), the shared handlers
// and the Netlify Function. Every network call goes through a fake fetch.

const ENV = {
    // Test-only 64-hex-char key, not a real secret.
    SYNC_MASTER_KEY: '33'.repeat(32),
    COINTRACKER_CLIENT_ID: undefined,
    COINTRACKER_BALANCE_TOOL: undefined,
    COINTRACKER_REDIRECT_URI: undefined,
};
const saved = {};

beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    for (const k of Object.keys(ENV)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const jsonRes = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });

const TOOLS = [
    {
        name: 'get_transactions',
        description: 'List wallet transactions',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_wallet_balances',
        description:
            'Current balances for each connected wallet and exchange account',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_wallet_detail',
        description: 'Balances for one wallet',
        inputSchema: {
            type: 'object',
            properties: { wallet_id: { type: 'string' } },
            required: ['wallet_id'],
        },
    },
];

const BALANCES = {
    wallets: [
        {
            id: 'w1',
            name: 'Ledger ETH',
            blockchain: 'ethereum',
            address: '0xAbC0000000000000000000000000000000000001',
            holdings: [
                { symbol: 'eth', amount: '1.5', usd_value: '$4,500.00' },
                { symbol: 'USDC', amount: 100, usd_value: 100 },
            ],
        },
        { id: 'w2', name: 'Coinbase', type: 'exchange', total_value: 250.5 },
        { id: 'w3', name: 'Dust wallet', address: 'bc1qxyz' },
    ],
};

// Fake MCP server + token endpoint. `opts.unauthorizedOnce` makes the
// first initialize answer 401; `opts.sse` answers in SSE framing.
function fakeCoinTracker(opts = {}) {
    const calls = [];
    let rejected = false;
    const impl = vi.fn(async (url, init = {}) => {
        const body = init.body ? String(init.body) : '';
        calls.push({ url: String(url), init, body });
        if (String(url) === ct.ENDPOINTS.token) {
            const params = new URLSearchParams(body);
            if (opts.tokenError)
                return jsonRes(400, { error: opts.tokenError });
            return jsonRes(200, {
                access_token: `at-${params.get('grant_type')}`,
                refresh_token: 'rt-new',
                expires_in: 3600,
            });
        }
        if (String(url) === ct.ENDPOINTS.register) {
            return jsonRes(201, { client_id: 'dcr-client' });
        }
        if (String(url) === ct.ENDPOINTS.revoke)
            return new Response(null, { status: 200 });
        if (String(url) === ct.MCP_URL) {
            if (opts.forbidden) return new Response('', { status: 403 });
            const msg = JSON.parse(body);
            if (
                msg.method === 'initialize' &&
                opts.unauthorizedOnce &&
                !rejected
            ) {
                rejected = true;
                return new Response('', { status: 401 });
            }
            if (!('id' in msg)) return new Response(null, { status: 202 });
            let result;
            if (msg.method === 'initialize')
                result = { protocolVersion: '2025-06-18', capabilities: {} };
            if (msg.method === 'tools/list')
                result = { tools: opts.tools || TOOLS };
            if (msg.method === 'tools/call')
                result = {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(opts.payload || BALANCES),
                        },
                    ],
                };
            const reply = { jsonrpc: '2.0', id: msg.id, result };
            if (opts.sse) {
                return new Response(
                    `event: message\ndata: ${JSON.stringify(reply)}\n\n`,
                    {
                        status: 200,
                        headers: {
                            'content-type': 'text/event-stream',
                            'mcp-session-id': 'sess-1',
                        },
                    },
                );
            }
            return jsonRes(200, reply, { 'mcp-session-id': 'sess-1' });
        }
        throw new Error(`unexpected fetch ${url}`);
    });
    return { impl, calls };
}

const TOKENS = {
    v: 1,
    client_id: 'dcr-client',
    access_token: 'at-old',
    refresh_token: 'rt-old',
    expires_at: Date.now() + 3600_000,
    connected_at: '2026-10-01T00:00:00.000Z',
};

describe('OAuth helpers', () => {
    it('builds an S256 PKCE authorization URL bound to the MCP resource', () => {
        const { verifier, challenge } = ct.createPkce();
        expect(challenge).toBe(
            crypto.createHash('sha256').update(verifier).digest('base64url'),
        );
        const url = new URL(
            ct.buildAuthorizationUrl({
                clientId: 'c1',
                redirectUri: 'https://x.test/api/sync/cointracker/callback',
                state: 's1',
                challenge,
            }),
        );
        expect(url.origin + url.pathname).toBe(ct.ENDPOINTS.authorize);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('scope')).toBe('mcp:read offline_access');
        expect(url.searchParams.get('resource')).toBe(ct.MCP_URL);
    });

    it('registers a public client dynamically, or uses COINTRACKER_CLIENT_ID', async () => {
        const { impl, calls } = fakeCoinTracker();
        expect(await ct.registerClient('https://x.test/cb', impl)).toBe(
            'dcr-client',
        );
        const reg = JSON.parse(calls[0].body);
        expect(reg.token_endpoint_auth_method).toBe('none');
        expect(reg.redirect_uris).toEqual(['https://x.test/cb']);
        expect(calls[0].init.headers['User-Agent']).toBe(ct.USER_AGENT);

        process.env.COINTRACKER_CLIENT_ID = 'pinned';
        const spy = vi.fn();
        expect(await ct.registerClient('https://x.test/cb', spy)).toBe(
            'pinned',
        );
        expect(spy).not.toHaveBeenCalled();
    });

    it('maps invalid_grant on refresh to cointracker_revoked', async () => {
        const { impl } = fakeCoinTracker({ tokenError: 'invalid_grant' });
        await expect(ct.refreshTokens(TOKENS, impl)).rejects.toMatchObject({
            code: 'cointracker_revoked',
            status: 401,
        });
    });

    it('keeps the old refresh token when none is rotated in', async () => {
        const impl = vi.fn(async () =>
            jsonRes(200, { access_token: 'a2', expires_in: 60 }),
        );
        const next = await ct.refreshTokens(TOKENS, impl);
        expect(next.refresh_token).toBe('rt-old');
        expect(next.connected_at).toBe(TOKENS.connected_at);
    });

    it('round-trips sealed tokens and rejects garbage', () => {
        expect(ct.unsealTokens(ct.sealTokens(TOKENS))).toEqual(TOKENS);
        expect(() => ct.unsealTokens('nope')).toThrow(/unreadable/);
    });

    it('expires the pending OAuth cookie', () => {
        const sealed = ct.sealPending({ state: 's', verifier: 'v' });
        expect(ct.unsealPending(sealed).state).toBe('s');
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
        expect(ct.unsealPending(sealed)).toBeNull();
    });
});

describe('MCP client', () => {
    it('parses JSON and SSE JSON-RPC responses', () => {
        expect(
            ct.parseRpcResponse('{"id":1,"result":{}}', 'application/json', 1),
        ).toEqual({
            id: 1,
            result: {},
        });
        const sse =
            'data: {"id":9}\n\nevent: message\ndata: {"id":2,"result":{"ok":true}}\n\n';
        expect(ct.parseRpcResponse(sse, 'text/event-stream', 2).result.ok).toBe(
            true,
        );
    });

    it('picks the wallet-balance tool, never transactions or tools needing arguments', () => {
        expect(ct.chooseBalanceTool(TOOLS).name).toBe('get_wallet_balances');
        expect(ct.chooseBalanceTool([TOOLS[0], TOOLS[2]])).toBeNull();
        process.env.COINTRACKER_BALANCE_TOOL = 'get_transactions';
        expect(ct.chooseBalanceTool(TOOLS).name).toBe('get_transactions');
    });

    it('surfaces tool errors and non-JSON output', () => {
        expect(() =>
            ct.extractPayload({
                isError: true,
                content: [{ type: 'text', text: 'boom' }],
            }),
        ).toThrow(/boom/);
        expect(() =>
            ct.extractPayload({ content: [{ type: 'text', text: 'hello' }] }),
        ).toThrow(/cannot read/);
        expect(ct.extractPayload({ structuredContent: { a: 1 } })).toEqual({
            a: 1,
        });
    });
});

describe('normalizeWallets', () => {
    it('normalizes wallets, sums holdings and skips value-less entries', () => {
        const { wallets, warnings } = ct.normalizeWallets(BALANCES);
        expect(wallets).toHaveLength(2);
        expect(wallets[0]).toMatchObject({
            providerId: 'w1',
            name: 'Ledger ETH',
            chains: ['ethereum'],
            addresses: ['0xAbC0000000000000000000000000000000000001'],
            usdValue: 4600,
        });
        expect(wallets[0].holdings[0]).toEqual({
            symbol: 'ETH',
            quantity: 1.5,
            usdValue: 4500,
        });
        expect(wallets[1]).toMatchObject({
            providerId: 'w2',
            kind: 'exchange',
            usdValue: 250.5,
        });
        expect(warnings[0]).toMatch(/Dust wallet/);
    });

    it('finds wallet arrays nested anywhere and derives stable ids', () => {
        const payload = {
            data: {
                accounts: [
                    { label: 'Phantom', addresses: ['SoLaddr'], value: '12' },
                ],
            },
        };
        const a = ct.normalizeWallets(payload).wallets[0];
        const b = ct.normalizeWallets(payload).wallets[0];
        expect(a.name).toBe('Phantom');
        expect(a.providerId).toMatch(/^[0-9a-f]{16}$/);
        expect(a.providerId).toBe(b.providerId);
    });

    it('warns instead of inventing wallets from an unrecognized payload', () => {
        const { wallets, warnings } = ct.normalizeWallets({ total: 5 });
        expect(wallets).toEqual([]);
        expect(warnings[0]).toMatch(/no wallets/);
    });
});

describe('syncWallets', () => {
    it('initializes, lists tools, calls the balance tool and reuses the session id', async () => {
        const { impl, calls } = fakeCoinTracker({ sse: true });
        const r = await ct.syncWallets(TOKENS, impl);
        expect(r.tool).toBe('get_wallet_balances');
        expect(r.wallets).toHaveLength(2);
        expect(r.refreshed).toBe(false);
        const mcp = calls.filter((c) => c.url === ct.MCP_URL);
        expect(mcp[0].init.headers.Authorization).toBe('Bearer at-old');
        expect(mcp[0].init.headers['Mcp-Session-Id']).toBeUndefined();
        expect(mcp[1].init.headers['Mcp-Session-Id']).toBe('sess-1');
        expect(JSON.parse(mcp.at(-1).body).params).toEqual({
            name: 'get_wallet_balances',
            arguments: {},
        });
    });

    it('refreshes an expired token before calling CoinTracker', async () => {
        const { impl, calls } = fakeCoinTracker();
        const r = await ct.syncWallets(
            { ...TOKENS, expires_at: Date.now() - 1 },
            impl,
        );
        expect(calls[0].url).toBe(ct.ENDPOINTS.token);
        expect(r.refreshed).toBe(true);
        expect(r.tokens.access_token).toBe('at-refresh_token');
    });

    it('refreshes once and retries when CoinTracker answers 401', async () => {
        const { impl } = fakeCoinTracker({ unauthorizedOnce: true });
        const r = await ct.syncWallets(TOKENS, impl);
        expect(r.refreshed).toBe(true);
        expect(r.wallets).toHaveLength(2);
    });

    it('reports a 403 as missing MCP access (plan / early access)', async () => {
        const { impl } = fakeCoinTracker({ forbidden: true });
        await expect(ct.syncWallets(TOKENS, impl)).rejects.toMatchObject({
            code: 'cointracker_forbidden',
        });
    });

    it('fails clearly when no balance tool exists', async () => {
        const { impl } = fakeCoinTracker({ tools: [TOOLS[0]] });
        await expect(ct.syncWallets(TOKENS, impl)).rejects.toMatchObject({
            code: 'no_balance_tool',
        });
    });
});

describe('handlers', () => {
    it('authorize registers a client and seals state + PKCE verifier in a cookie', async () => {
        const { impl } = fakeCoinTracker();
        const r = await handlers.authorize(
            { origin: 'https://lifefire.netlify.app' },
            impl,
        );
        const url = new URL(r.redirect);
        expect(url.searchParams.get('client_id')).toBe('dcr-client');
        expect(url.searchParams.get('redirect_uri')).toBe(
            'https://lifefire.netlify.app/api/sync/cointracker/callback',
        );
        expect(r.cookie).toMatch(
            /^cointracker_oauth=.+; Path=\/api\/sync\/cointracker; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/,
        );
        const pending = ct.unsealPending(r.cookie.split(';')[0].split('=')[1]);
        expect(pending.state).toBe(url.searchParams.get('state'));
    });

    it('authorize fails closed without SYNC_MASTER_KEY', async () => {
        delete process.env.SYNC_MASTER_KEY;
        const r = await handlers.authorize({ origin: 'http://localhost:3001' });
        expect(r).toEqual({ redirect: '/#cointracker-error=not_configured' });
        const s = await handlers.sync({ body: {} });
        expect(s.status).toBe(503);
    });

    it('callback rejects a state mismatch and exchanges a valid code', async () => {
        const { impl, calls } = fakeCoinTracker();
        const cookieValue = ct.sealPending({
            state: 'abc',
            verifier: 'ver',
            clientId: 'dcr-client',
            redirectUri: 'http://localhost:3001/api/sync/cointracker/callback',
        });
        const bad = await handlers.callback(
            {
                params: new URLSearchParams('code=c&state=zzz'),
                cookieValue,
                origin: 'http://localhost:3001',
            },
            impl,
        );
        expect(bad.redirect).toBe('/#cointracker-error=invalid_state');
        expect(bad.cookie).toMatch(/Max-Age=0/);

        const ok = await handlers.callback(
            {
                params: new URLSearchParams('code=c&state=abc'),
                cookieValue,
                origin: 'http://localhost:3001',
            },
            impl,
        );
        const blob = decodeURIComponent(
            ok.redirect.replace('/#cointracker-connected=', ''),
        );
        expect(ct.unsealTokens(blob).access_token).toBe(
            'at-authorization_code',
        );
        const form = new URLSearchParams(calls.at(-1).body);
        expect(form.get('code_verifier')).toBe('ver');
        expect(form.get('client_id')).toBe('dcr-client');
    });

    it('sync returns wallets, and a fresh blob only when tokens were refreshed', async () => {
        const { impl } = fakeCoinTracker();
        const r = await handlers.sync(
            { body: { token: ct.sealTokens(TOKENS) } },
            impl,
        );
        expect(r.status).toBe(200);
        expect(r.body.wallets).toHaveLength(2);
        expect(r.body.warnings).toHaveLength(1);
        expect(r.body.token).toBeUndefined();
    });

    it('sync answers 401 with a drop-the-token code for unreadable or revoked grants', async () => {
        const unreadable = await handlers.sync({ body: { token: 'garbage' } });
        expect(unreadable).toMatchObject({
            status: 401,
            body: { code: 'cointracker_token_invalid' },
        });
        const { impl } = fakeCoinTracker({ tokenError: 'invalid_grant' });
        const revoked = await handlers.sync(
            { body: { token: ct.sealTokens({ ...TOKENS, expires_at: 1 }) } },
            impl,
        );
        expect(revoked).toMatchObject({
            status: 401,
            body: { code: 'cointracker_revoked' },
        });
    });

    it('inspect lists tool metadata and the selected balance tool', async () => {
        const { impl } = fakeCoinTracker();
        const r = await handlers.inspect(
            { body: { token: ct.sealTokens(TOKENS) } },
            impl,
        );
        expect(r.body.selected).toBe('get_wallet_balances');
        expect(r.body.tools.map((t) => t.name)).toEqual(
            TOOLS.map((t) => t.name),
        );
        expect(r.body.tools[2].required).toEqual(['wallet_id']);
    });

    it('disconnect revokes the refresh token, and tolerates an unreadable blob', async () => {
        const { impl, calls } = fakeCoinTracker();
        const r = await handlers.disconnect(
            { body: { token: ct.sealTokens(TOKENS) } },
            impl,
        );
        expect(r.body).toEqual({ status: 'disconnected', revoked: true });
        expect(JSON.parse(calls[0].body).token).toBe('rt-old');
        const r2 = await handlers.disconnect({ body: { token: 'x' } }, impl);
        expect(r2.body.revoked).toBe(false);
    });
});

describe('Netlify function', () => {
    const BASE = 'https://lifefire.netlify.app/api/sync/cointracker';

    it('routes by action and enforces methods', async () => {
        expect((await fn(new Request(`${BASE}/nope`))).status).toBe(404);
        expect((await fn(new Request(`${BASE}/sync`))).status).toBe(405);
        expect(
            (await fn(new Request(`${BASE}/authorize`, { method: 'POST' })))
                .status,
        ).toBe(405);
    });

    it('authorize redirects to CoinTracker with the pending cookie', async () => {
        vi.stubGlobal('fetch', fakeCoinTracker().impl);
        const res = await fn(new Request(`${BASE}/authorize`));
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toMatch(
            /^https:\/\/login\.cointracker\.com\/authorize\?/,
        );
        expect(res.headers.get('set-cookie')).toMatch(/^cointracker_oauth=/);
    });

    it('sync with an unreadable token is a JSON 401', async () => {
        const res = await fn(
            new Request(`${BASE}/sync`, {
                method: 'POST',
                body: JSON.stringify({ token: 'bad' }),
            }),
        );
        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('cointracker_token_invalid');
    });
});

describe('review hardening', () => {
    it('bounds every CoinTracker request with an abort signal', async () => {
        const { impl, calls } = fakeCoinTracker();
        await ct.syncWallets({ ...TOKENS, expires_at: 1 }, impl);
        await ct.registerClient('https://x.test/cb', impl);
        await ct.revokeTokens(TOKENS, impl);
        expect(calls.length).toBeGreaterThan(4);
        for (const c of calls)
            expect(c.init.signal).toBeInstanceOf(AbortSignal);
    });

    it('maps a timeout to a 504 the browser can retry', async () => {
        const impl = vi.fn(async () => {
            throw Object.assign(new Error('The operation timed out.'), {
                name: 'TimeoutError',
            });
        });
        const r = await handlers.sync(
            { body: { token: ct.sealTokens(TOKENS) } },
            impl,
        );
        expect(r).toMatchObject({ status: 504, body: { code: 'timeout' } });
    });

    it('returns the rotated token even when the call after a refresh fails', async () => {
        const { impl } = fakeCoinTracker({ forbidden: true });
        const r = await handlers.sync(
            { body: { token: ct.sealTokens({ ...TOKENS, expires_at: 1 }) } },
            impl,
        );
        expect(r.status).toBe(403);
        expect(ct.unsealTokens(r.body.token)).toMatchObject({
            access_token: 'at-refresh_token',
            refresh_token: 'rt-new',
        });
        // No refresh happened: nothing rotated, nothing to hand back.
        const r2 = await handlers.sync(
            { body: { token: ct.sealTokens(TOKENS) } },
            impl,
        );
        expect(r2.body.token).toBeUndefined();
    });

    it('inspect selects from raw tools, so required-argument tools are never "in use"', async () => {
        const { impl } = fakeCoinTracker({ tools: [TOOLS[0], TOOLS[2]] });
        const r = await handlers.inspect(
            { body: { token: ct.sealTokens(TOKENS) } },
            impl,
        );
        expect(r.body.selected).toBeNull();
    });

    it('reports wallets it could not value instead of marking the sync partial', () => {
        const r = ct.normalizeWallets(BALANCES);
        expect(r.skippedProviderIds).toEqual(['w3']);
        expect(r.partial).toBe(false);
        expect(ct.normalizeWallets({ total: 1 }).partial).toBe(true);
    });
});

describe('audience + 401 diagnostics', () => {
    it('asks Auth0 for an MCP-audience token', () => {
        const url = new URL(
            ct.buildAuthorizationUrl({
                clientId: 'c',
                redirectUri: 'https://x.test/cb',
                state: 's',
                challenge: 'ch',
            }),
        );
        expect(url.searchParams.get('audience')).toBe(ct.AUDIENCE);
        expect(ct.AUDIENCE).toBe(ct.MCP_URL);
    });

    it('describes tokens without leaking them', () => {
        const payload = Buffer.from(
            JSON.stringify({
                aud: ['a', 'b'],
                scope: 'mcp:read',
                sub: 'secret-user',
            }),
        ).toString('base64url');
        const d = ct.describeToken(`h.${payload}.sig`);
        expect(d).toEqual({
            format: 'jwt',
            aud: ['a', 'b'],
            scope: 'mcp:read',
            iss: null,
            permissions: null,
        });
        expect(JSON.stringify(d)).not.toContain('secret-user');
        expect(ct.describeToken('a.b.c.d.e').format).toMatch(/^jwe/);
        expect(ct.describeToken('opaque123').format).toBe('opaque');
    });

    it('returns the token shape when CoinTracker rejects it', async () => {
        const impl = vi.fn(async (url) =>
            String(url) === ct.ENDPOINTS.token
                ? jsonRes(200, { access_token: 'still-opaque', expires_in: 60 })
                : new Response('', { status: 401 }),
        );
        const r = await handlers.sync(
            { body: { token: ct.sealTokens(TOKENS) } },
            impl,
        );
        expect(r.status).toBe(401);
        expect(r.body.code).toBe('cointracker_revoked');
        expect(r.body.diagnostic).toEqual({ format: 'opaque' });
    });

    it('passes CoinTracker login errors through the fragment', async () => {
        const cookieValue = ct.sealPending({
            state: 'abc',
            verifier: 'v',
            clientId: 'c',
            redirectUri: 'r',
        });
        const r = await handlers.callback({
            params: new URLSearchParams(
                'state=abc&error=access_denied&error_description=Service%20not%20found',
            ),
            cookieValue,
            origin: 'https://x.test',
        });
        expect(decodeURIComponent(r.redirect)).toBe(
            '/#cointracker-error=access_denied: Service not found',
        );
    });
});

describe('account without MCP access', () => {
    it('explains early access instead of reporting a bad token', async () => {
        const payload = Buffer.from(
            JSON.stringify({
                aud: ct.MCP_URL,
                scope: 'offline_access',
                permissions: [],
            }),
        ).toString('base64url');
        const jwt = `h.${payload}.sig`;
        const impl = vi.fn(async (url) =>
            String(url) === ct.ENDPOINTS.token
                ? jsonRes(200, { access_token: jwt, expires_in: 60 })
                : new Response('', { status: 401 }),
        );
        const r = await handlers.sync(
            {
                body: {
                    token: ct.sealTokens({ ...TOKENS, access_token: jwt }),
                },
            },
            impl,
        );
        expect(r.status).toBe(401);
        expect(r.body.code).toBe('cointracker_no_access');
        expect(r.body.error).toMatch(/early access/);
    });
});
