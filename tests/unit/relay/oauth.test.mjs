import { describe, it, expect } from 'vitest';
import worker from '../../../relay/worker.mjs';
import {
    PENDING_TTL_MS,
    REGISTRATION_TTL_MS,
    handleOAuthStateless,
    validRedirectUri,
    verifyPending,
} from '../../../relay/oauth.mjs';
import {
    completionTicket,
    CODE_TTL_MS,
} from '../../../relay/session-oauth.mjs';
import { constantTimeEqual } from '../../../relay/session.mjs';
import {
    importHmacKey,
    signValue,
    verifyValue,
    b64urlDecode,
} from '../../../relay/signing.mjs';
import {
    FakeClock,
    HMAC_SECRET,
    PUBLIC,
    flowEnv,
    makeNamespace,
    openBrowserSession,
    pkce,
} from './helpers.mjs';

const REDIRECT = 'https://client.example/cb';

function world() {
    const clock = new FakeClock(Date.now());
    const env = flowEnv();
    const ns = makeNamespace(env, clock);
    env.BRIDGE_SESSIONS = ns;
    const f = (path, init) =>
        worker.fetch(new Request(`${PUBLIC}${path}`, init), env);
    return { clock, env, ns, f };
}

async function register(w, body = {}) {
    const res = await w.f('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            redirect_uris: [REDIRECT],
            client_name: 'Test Agent',
            ...body,
        }),
    });
    return { res, json: await res.json() };
}

function authorizeUrl(clientId, challenge, extra = {}) {
    const p = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'st-123',
        ...extra,
    });
    return `/authorize?${p}`;
}

/** Run register + authorize and return the pending value from the redirect. */
async function startAuth(w, extra = {}) {
    const { json } = await register(w);
    const { verifier, challenge } = await pkce();
    const res = await w.f(authorizeUrl(json.client_id, challenge, extra));
    const loc = res.headers.get('Location');
    const pending = loc ? new URL(loc).hash.split('req=')[1] : null;
    return { clientId: json.client_id, verifier, challenge, res, loc, pending };
}

/** Full happy path up to a live session, returning everything. */
async function liveFlow(w, scope = ['summary']) {
    const a = await startAuth(w);
    const s = await openBrowserSession(w.ns, w.env, a.pending, scope, w.clock);
    return { ...a, ...s };
}

const completePath = (sid, pending) =>
    completionTicket(pending).then(
        (t) => `/authorize/complete?sid=${sid}&t=${t}`,
    );

async function getCode(w, flow) {
    const res = await w.f(await completePath(flow.sid, flow.pending));
    const loc = res.headers.get('Location');
    return {
        res,
        loc,
        code: loc ? new URL(loc).searchParams.get('code') : null,
    };
}

const tokenReq = (w, params) =>
    w.f('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
    });

const exchange = (w, flow, code, over = {}) =>
    tokenReq(w, {
        grant_type: 'authorization_code',
        code,
        client_id: flow.clientId,
        redirect_uri: REDIRECT,
        code_verifier: flow.verifier,
        ...over,
    });

describe('signing primitives', () => {
    it('round-trips, and a value for one purpose never verifies as another', async () => {
        const key = await importHmacKey(HMAC_SECRET);
        const v = await signValue(key, 'a', { x: 1 });
        expect(await verifyValue(key, 'a', v)).toEqual({ x: 1 });
        expect(await verifyValue(key, 'b', v)).toBeNull();
    });

    it('rejects tampering, truncation, junk, and a different key', async () => {
        const key = await importHmacKey(HMAC_SECRET);
        const other = await importHmacKey(
            Buffer.alloc(32, 9).toString('base64url'),
        );
        const v = await signValue(key, 'a', { x: 1 });
        const [body, mac] = v.split('.');
        const forgedBody = Buffer.from(JSON.stringify({ x: 2 })).toString(
            'base64url',
        );
        for (const bad of [
            `${forgedBody}.${mac}`,
            `${body}.${mac.slice(1)}A`,
            body,
            '',
            'a.b.c',
            `${body}.`,
        ]) {
            expect(await verifyValue(key, 'a', bad)).toBeNull();
        }
        expect(await verifyValue(other, 'a', v)).toBeNull();
        expect(await verifyValue(key, 'a', 42)).toBeNull();
    });

    it('refuses a missing or short key (fail closed)', async () => {
        expect(await importHmacKey(undefined)).toBeNull();
        expect(await importHmacKey('short')).toBeNull();
        expect(await importHmacKey('!!!')).toBeNull();
        expect(b64urlDecode('a b')).toBeNull();
    });

    it('constantTimeEqual compares whole strings', () => {
        expect(constantTimeEqual('abc', 'abc')).toBe(true);
        expect(constantTimeEqual('abc', 'abd')).toBe(false);
        expect(constantTimeEqual('abc', 'abcd')).toBe(false);
        expect(constantTimeEqual('abc', undefined)).toBe(false);
    });
});

describe('metadata', () => {
    it('serves protected-resource and authorization-server metadata', async () => {
        const w = world();
        const pr = await (
            await w.f('/.well-known/oauth-protected-resource')
        ).json();
        expect(pr.resource).toBe(`${PUBLIC}/mcp`);
        expect(pr.authorization_servers).toEqual([PUBLIC]);
        const pr2 = await (
            await w.f('/.well-known/oauth-protected-resource/mcp')
        ).json();
        expect(pr2.resource).toBe(`${PUBLIC}/mcp`);
        const as = await (
            await w.f('/.well-known/oauth-authorization-server')
        ).json();
        expect(as.code_challenge_methods_supported).toEqual(['S256']);
        expect(as.grant_types_supported).toEqual(['authorization_code']);
        expect(as.token_endpoint_auth_methods_supported).toEqual(['none']);
        expect(as.token_endpoint).toBe(`${PUBLIC}/token`);
        expect(as).not.toHaveProperty('refresh_token');
    });

    it('is GET only', async () => {
        const w = world();
        const res = await w.f('/.well-known/oauth-authorization-server', {
            method: 'POST',
        });
        expect(res.status).toBe(405);
    });
});

describe('dynamic client registration', () => {
    it('returns a signed client_id and no secret', async () => {
        const w = world();
        const { res, json } = await register(w);
        expect(res.status).toBe(201);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(json.client_secret).toBeUndefined();
        expect(json.token_endpoint_auth_method).toBe('none');
        const key = await importHmacKey(HMAC_SECRET);
        const reg = await verifyValue(
            key,
            'fire-bridge/client/v1',
            json.client_id,
        );
        expect(reg.redirect_uris).toEqual([REDIRECT]);
        expect(reg.exp - reg.iat).toBe(REGISTRATION_TTL_MS);
    });

    it('rejects bad redirect URIs, client auth methods and grants', async () => {
        const w = world();
        for (const body of [
            { redirect_uris: [] },
            { redirect_uris: ['http://client.example/cb'] },
            { redirect_uris: ['https://u:p@client.example/cb'] },
            { redirect_uris: ['https://client.example/cb#frag'] },
            { redirect_uris: ['javascript:alert(1)'] },
            {
                redirect_uris: Array.from(
                    { length: 6 },
                    (_, i) => `https://c.example/${i}`,
                ),
            },
            { token_endpoint_auth_method: 'client_secret_basic' },
            { grant_types: ['password'] },
        ]) {
            const { res } = await register(w, body);
            expect(res.status).toBe(400);
        }
        expect(
            (await w.f('/register', { method: 'POST', body: 'not json' }))
                .status,
        ).toBe(400);
        expect((await w.f('/register')).status).toBe(405);
    });

    it('accepts loopback http redirects and sanitizes the client name', async () => {
        const w = world();
        const { res, json } = await register(w, {
            redirect_uris: ['http://127.0.0.1:8123/cb', 'http://localhost/cb'],
            client_name: '  Evil\u0000‮Name\n'.padEnd(300, 'x'),
        });
        expect(res.status).toBe(201);
        const bad = [
            String.fromCharCode(0),
            String.fromCharCode(0x202e),
            String.fromCharCode(10),
        ];
        for (const ch of bad) {
            expect(json.client_name.includes(ch)).toBe(false);
        }
        expect(json.client_name.length).toBeLessThanOrEqual(100);
        expect(validRedirectUri('http://[::1]/cb')).toBe(true);
        expect(validRedirectUri('http://evil.example/cb')).toBe(false);
    });

    it('fails closed with no signing key', async () => {
        const w = world();
        w.env.RELAY_HMAC_KEY = undefined;
        expect((await register(w)).res.status).toBe(500);
    });
});

describe('/authorize', () => {
    it('redirects to the consent page with the pending value in the fragment', async () => {
        const w = world();
        const a = await startAuth(w);
        expect(a.res.status).toBe(302);
        const u = new URL(a.loc);
        expect(u.origin).toBe(PUBLIC);
        expect(u.hash.startsWith('#/mcp-connect?req=')).toBe(true);
        expect(u.search).toBe('');
        const key = await importHmacKey(HMAC_SECRET);
        const v = await verifyPending(key, a.pending, Date.now());
        expect(v.requestedScope.sort()).toEqual([
            'accounts',
            'income',
            'planning',
            'summary',
            'transactions',
        ]);
        expect(v.pending.redirect_uri).toBe(REDIRECT);
        expect(v.pending.state).toBe('st-123');
    });

    it('pending authorizations expire after 5 minutes and cannot be forged', async () => {
        const w = world();
        const a = await startAuth(w);
        const key = await importHmacKey(HMAC_SECRET);
        expect(
            await verifyPending(
                key,
                a.pending,
                Date.now() + PENDING_TTL_MS + 1000,
            ),
        ).toBeNull();
        const [body, mac] = a.pending.split('.');
        const forged = Buffer.from(
            JSON.stringify({
                ...JSON.parse(Buffer.from(body, 'base64url')),
                scope: ['transactions'],
            }),
        ).toString('base64url');
        expect(
            await verifyPending(key, `${forged}.${mac}`, Date.now()),
        ).toBeNull();
    });

    it('never redirects for an unknown, forged or expired client_id, or a wrong redirect_uri', async () => {
        const w = world();
        const { json } = await register(w);
        const { challenge } = await pkce();
        const cases = [
            authorizeUrl('forged.value', challenge),
            authorizeUrl(json.client_id + 'x', challenge),
            authorizeUrl(json.client_id, challenge, {
                redirect_uri: `${REDIRECT}/`,
            }),
            authorizeUrl(json.client_id, challenge, {
                redirect_uri: 'https://client.example/cb?x=1',
            }),
            authorizeUrl(json.client_id, challenge, {
                redirect_uri: 'https://evil.example/cb',
            }),
            authorizeUrl(json.client_id, challenge, { redirect_uri: '' }),
        ];
        for (const path of cases) {
            const res = await w.f(path);
            expect(res.status).toBe(400);
            expect(res.headers.get('Location')).toBeNull();
        }
        // expired registration (25 h later), checked against the clock directly
        const late = await handleOAuthStateless(
            new Request(`${PUBLIC}${authorizeUrl(json.client_id, challenge)}`),
            w.env,
            Date.now() + REGISTRATION_TTL_MS + 1000,
        );
        expect(late.status).toBe(400);
        expect((await late.json()).error).toBe('invalid_client');
    });

    it('requires PKCE S256, response_type code, a matching resource and known scopes', async () => {
        const w = world();
        const { json } = await register(w);
        const { challenge } = await pkce();
        const base = (extra) => authorizeUrl(json.client_id, challenge, extra);
        const errors = [
            [base({ code_challenge_method: 'plain' }), 'invalid_request'],
            [base({ code_challenge: 'short' }), 'invalid_request'],
            [base({ response_type: 'token' }), 'unsupported_response_type'],
            [base({ resource: 'https://other.example/mcp' }), 'invalid_target'],
            [base({ scope: 'summary bogus' }), 'invalid_scope'],
            [base({ state: 's'.repeat(600) }), 'invalid_request'],
        ];
        for (const [path, error] of errors) {
            const res = await w.f(path);
            expect(res.status).toBe(302);
            const loc = new URL(res.headers.get('Location'));
            expect(loc.origin + loc.pathname).toBe(REDIRECT);
            expect(loc.searchParams.get('error')).toBe(error);
        }
        const noPkce = new URL(`${PUBLIC}${base()}`);
        noPkce.searchParams.delete('code_challenge');
        const res = await w.f(noPkce.pathname + noPkce.search);
        expect(
            new URL(res.headers.get('Location')).searchParams.get('error'),
        ).toBe('invalid_request');
        const ok = await w.f(base({ resource: `${PUBLIC}/mcp` }));
        expect(new URL(ok.headers.get('Location')).hash).toContain(
            '#/mcp-connect',
        );
    });

    it('is GET only and fails closed with no signing key', async () => {
        const w = world();
        expect((await w.f('/authorize', { method: 'POST' })).status).toBe(405);
        w.env.RELAY_HMAC_KEY = '';
        expect((await w.f('/authorize')).status).toBe(500);
    });
});

describe('pending authorization binds the session (HELLO)', () => {
    it('opens a session for a valid pending value with a subset scope', async () => {
        const w = world();
        const flow = await liveFlow(w, ['summary']);
        expect(flow.ready).toBe(true);
    });

    it('refuses a forged pending value, an expired one, and a wider scope', async () => {
        const w = world();
        const a = await startAuth(w);
        const forged = await openBrowserSession(
            w.ns,
            w.env,
            `${a.pending}x`,
            ['summary'],
            w.clock,
        );
        expect(forged.ready).toBeFalsy();
        const wider = await openBrowserSession(
            w.ns,
            w.env,
            a.pending,
            ['summary', 'bogus'],
            w.clock,
        );
        expect(wider.ready).toBeFalsy();
        w.clock.t += PENDING_TTL_MS + 1000;
        const late = await openBrowserSession(
            w.ns,
            w.env,
            a.pending,
            ['summary'],
            w.clock,
        );
        expect(late.ready).toBeFalsy();
    });

    it('refuses everything when the relay has no signing key', async () => {
        const w = world();
        const a = await startAuth(w);
        w.env.RELAY_HMAC_KEY = undefined;
        const s = await openBrowserSession(
            makeNamespace(w.env, w.clock),
            w.env,
            a.pending,
            ['summary'],
            w.clock,
        );
        expect(s.ready).toBeFalsy();
    });
});

describe('/authorize/complete and /token', () => {
    it('completes the flow: code to the registered redirect with state, then a token', async () => {
        const w = world();
        const flow = await liveFlow(w, ['summary']);
        const { res, loc, code } = await getCode(w, flow);
        expect(res.status).toBe(302);
        const u = new URL(loc);
        expect(u.origin + u.pathname).toBe(REDIRECT);
        expect(u.searchParams.get('state')).toBe('st-123');
        expect(code.startsWith(`${flow.sid}.`)).toBe(true);

        const tokenRes = await exchange(w, flow, code);
        expect(tokenRes.status).toBe(200);
        expect(tokenRes.headers.get('Cache-Control')).toBe('no-store');
        const t = await tokenRes.json();
        expect(t.token_type).toBe('Bearer');
        expect(t.access_token.startsWith(`${flow.sid}.`)).toBe(true);
        expect(t).not.toHaveProperty('refresh_token');
        // token lifetime is the session's remaining life
        expect(t.expires_in).toBe(
            Math.floor((flow.expiresAt - w.clock.now()) / 1000),
        );
        // the scope is the approved scope, never the requested one
        expect(t.scope).toBe('summary');

        const list = await w.f('/mcp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${t.access_token}`,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
            }),
        });
        const names = (await list.json()).result.tools.map((x) => x.name);
        expect(names).toContain('get_net_worth');
        expect(names).not.toContain('get_transactions');
    });

    it('codes are single use: a replay fails, even though the first attempt succeeded', async () => {
        const w = world();
        const flow = await liveFlow(w);
        const { code } = await getCode(w, flow);
        expect((await exchange(w, flow, code)).status).toBe(200);
        const again = await exchange(w, flow, code);
        expect(again.status).toBe(400);
        expect((await again.json()).error).toBe('invalid_grant');
    });

    it('a code lives 60 seconds', async () => {
        const w = world();
        const flow = await liveFlow(w);
        const { code } = await getCode(w, flow);
        w.clock.t += CODE_TTL_MS + 1;
        expect((await (await exchange(w, flow, code)).json()).error).toBe(
            'invalid_grant',
        );
    });

    it('a wrong PKCE verifier fails and spends the code', async () => {
        const w = world();
        const flow = await liveFlow(w);
        const { code } = await getCode(w, flow);
        const bad = await exchange(w, flow, code, {
            code_verifier: 'z'.repeat(64),
        });
        expect((await bad.json()).error).toBe('invalid_grant');
        expect((await exchange(w, flow, code)).status).toBe(400);
        const missing = await getCode(w, flow); // already completed
        expect(missing.res.status).toBe(403);
    });

    it('rejects a missing or malformed verifier, redirect_uri mismatch and resource mismatch', async () => {
        const w = world();
        for (const over of [
            { code_verifier: '' },
            { code_verifier: 'short' },
            { redirect_uri: `${REDIRECT}/x` },
            { resource: 'https://other.example/mcp' },
        ]) {
            const flow = await liveFlow(w);
            const { code } = await getCode(w, flow);
            expect((await exchange(w, flow, code, over)).status).toBe(400);
        }
        const flow = await liveFlow(w);
        const { code } = await getCode(w, flow);
        const ok = await exchange(w, flow, code, { resource: `${PUBLIC}/mcp` });
        expect(ok.status).toBe(200);
    });

    it('rejects another client_id, an expired registration, or a different grant type', async () => {
        const w = world();
        const flow = await liveFlow(w);
        const { code } = await getCode(w, flow);
        const other = (await register(w)).json.client_id;
        expect(
            (await exchange(w, flow, code, { client_id: other })).status,
        ).toBe(401);
        const flow2 = await liveFlow(w);
        const c2 = (await getCode(w, flow2)).code;
        expect(
            (await exchange(w, flow2, c2, { grant_type: 'refresh_token' }))
                .status,
        ).toBe(400);
        const flow3 = await liveFlow(w);
        const c3 = (await getCode(w, flow3)).code;
        // the registration is signed against real time; expire it by signing an old one
        const key = await importHmacKey(HMAC_SECRET);
        const stale = await signValue(key, 'fire-bridge/client/v1', {
            redirect_uris: [REDIRECT],
            client_name: '',
            iat: 1,
            exp: 2,
        });
        expect(
            (await exchange(w, flow3, c3, { client_id: stale })).status,
        ).toBe(401);
    });

    it('rejects codes for an unknown session, a malformed code, and a stray sid', async () => {
        const w = world();
        const flow = await liveFlow(w);
        for (const code of [
            '',
            'garbage',
            `${'a'.repeat(32)}.${'b'.repeat(43)}`,
            `${flow.sid}.${'b'.repeat(43)}`,
        ]) {
            const res = await exchange(w, flow, code);
            expect(res.status).toBe(400);
        }
        expect((await w.f('/token')).status).toBe(405);
        const big = await w.f('/token', {
            method: 'POST',
            body: 'x'.repeat(9000),
        });
        expect(big.status).toBe(400);
    });

    it('completion needs the live session and the matching ticket, once', async () => {
        const w = world();
        const a = await startAuth(w);
        const early = await w.f(await completePath('f'.repeat(32), a.pending));
        expect(early.status).toBe(403);
        const flow = {
            ...a,
            ...(await openBrowserSession(
                w.ns,
                w.env,
                a.pending,
                ['summary'],
                w.clock,
            )),
        };
        for (const path of [
            `/authorize/complete?sid=${flow.sid}&t=wrong`,
            `/authorize/complete?sid=${flow.sid}`,
            `/authorize/complete?sid=nothex&t=x`,
            `/authorize/complete?t=x`,
        ]) {
            expect((await w.f(path)).status).toBe(403);
        }
        expect((await getCode(w, flow)).res.status).toBe(302);
        expect((await getCode(w, flow)).res.status).toBe(403);
        expect(
            (
                await w.f(`/authorize/complete?sid=${flow.sid}`, {
                    method: 'POST',
                })
            ).status,
        ).toBe(405);
    });

    it('the token dies when the session ends, and no code works afterwards', async () => {
        const w = world();
        const flow = await liveFlow(w);
        const { code } = await getCode(w, flow);
        const t = await (await exchange(w, flow, code)).json();
        const mcp = () =>
            w.f('/mcp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${t.access_token}`,
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
            });
        expect((await mcp()).status).toBe(200);
        flow.server.handlers.message({
            data: JSON.stringify({
                v: 1,
                type: 'END',
                sid: flow.sid,
                reason: 'user_disconnect',
            }),
        });
        await (async () => {
            const end = Date.now() + 3000;
            while ((await mcp()).status === 200 && Date.now() < end) {
                await new Promise((r) => setTimeout(r, 1));
            }
        })();
        expect((await mcp()).status).toBe(401);
    });

    it('a code minted for the session cannot be exchanged after it ended', async () => {
        const w = world();
        const flow = await liveFlow(w);
        const { code } = await getCode(w, flow);
        w.clock.t = flow.expiresAt + 1000;
        await w.clock.advance(0);
        expect((await exchange(w, flow, code)).status).toBe(400);
    });
});
