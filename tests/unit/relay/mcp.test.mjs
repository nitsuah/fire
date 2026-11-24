import { describe, it, expect } from 'vitest';
import { FrameType, Limits } from '../../../app/bridge-protocol.mjs';
import { TOOLS } from '../../../app/mcp-tools.mjs';
import { TOOL_GROUPS, toolsForScope } from '../../../app/bridge-scope.mjs';
import catalog from '../../../relay/tool-catalog.json' with { type: 'json' };
import { handleMcpRequest, MAX_BODY_BYTES } from '../../../relay/mcp.mjs';
import worker from '../../../relay/worker.mjs';
import { sidFromToken } from '../../../relay/session-object.mjs';
import { connect, send, setup } from './helpers.mjs';

const META = 'https://fire.example/.well-known/oauth-protected-resource';
const opts = { resourceMetadataUrl: META };
const MIN = 60_000;

async function sha256Hex(text) {
    const d = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(d), (b) =>
        b.toString(16).padStart(2, '0'),
    ).join('');
}

async function liveSession(scope = ['summary']) {
    const ctx = setup({
        verifyPendingAuth: async () => ({
            requestedScope: ['summary', 'accounts', 'transactions'],
        }),
    });
    const conn = await connect(ctx, { scope });
    const token = `${ctx.sid}.${'r'.repeat(43)}`;
    ctx.session.addTokenHash(await sha256Hex(token));
    return { ...ctx, ...conn, token };
}

const post = (body, token, headers = {}) =>
    new Request('https://fire.example/mcp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
const rpc = (method, params, id = 1) => ({
    jsonrpc: '2.0',
    id,
    method,
    params,
});

async function call(ctx, body, headers) {
    const res = await handleMcpRequest(
        post(body, ctx.token, headers),
        ctx.session,
        opts,
    );
    return {
        res,
        body: res.status === 202 ? null : await res.json().catch(() => null),
    };
}

/** Wait (bounded) until the browser socket has received n CALL frames. */
async function calls(ctx, n = 1) {
    const end = Date.now() + 3000;
    while (
        ctx.socket.sent.filter((f) => f.type === FrameType.CALL).length < n
    ) {
        if (Date.now() > end) throw new Error('no CALL frame arrived');
        await new Promise((r) => setTimeout(r, 1));
    }
}

/** Answer the next CALL the browser socket received. */
async function answer(ctx, result) {
    const frame = ctx.socket.last(FrameType.CALL);
    await send(ctx.session, ctx.socket, {
        v: 1,
        type: FrameType.RESULT,
        sid: ctx.sid,
        id: frame.id,
        ...result,
    });
}

describe('tool catalog and groups', () => {
    it('the checked-in catalog matches app/mcp-tools.mjs (run scripts/gen-relay-tool-catalog.mjs)', () => {
        expect(catalog).toEqual(
            TOOLS.map(({ name, description, inputSchema }) => ({
                name,
                description,
                inputSchema,
            })),
        );
    });

    it('every tool is in exactly one group, and every grouped tool exists', () => {
        const names = TOOLS.map((t) => t.name);
        const grouped = Object.values(TOOL_GROUPS).flatMap((g) => g.tools);
        expect(new Set(grouped).size).toBe(grouped.length);
        expect([...grouped].sort()).toEqual([...names].sort());
    });

    it('an unknown group or a non-array scope allows nothing', () => {
        expect(toolsForScope(['nope', 'constructor', '__proto__']).size).toBe(
            0,
        );
        expect(toolsForScope('summary').size).toBe(0);
    });
});

describe('/mcp: transport and auth', () => {
    it('GET and DELETE are 405 with Allow: POST', async () => {
        const ctx = await liveSession();
        for (const method of ['GET', 'DELETE']) {
            const res = await handleMcpRequest(
                new Request('https://fire.example/mcp', { method }),
                ctx.session,
                opts,
            );
            expect(res.status).toBe(405);
            expect(res.headers.get('Allow')).toBe('POST');
        }
    });

    it('a POST with no token is 401 with the protected-resource metadata', async () => {
        const ctx = await liveSession();
        const { res } = await call({ ...ctx, token: null }, rpc('ping'));
        expect(res.status).toBe(401);
        expect(res.headers.get('WWW-Authenticate')).toBe(
            `Bearer resource_metadata="${META}"`,
        );
    });

    it('a wrong, malformed or other-session token is 401 invalid_token', async () => {
        const ctx = await liveSession();
        for (const token of ['x', `${ctx.sid}.${'q'.repeat(43)}`, 'a b']) {
            const { res } = await call({ ...ctx, token }, rpc('ping'));
            expect(res.status).toBe(401);
        }
        const { res } = await call({ ...ctx, token: 'x' }, rpc('ping'));
        expect(res.headers.get('WWW-Authenticate')).toContain('invalid_token');
    });

    it('refuses any request that carries an Origin header', async () => {
        const ctx = await liveSession();
        const { res } = await call(ctx, rpc('ping'), {
            Origin: 'https://evil.example',
        });
        expect(res.status).toBe(403);
    });

    it('rejects bad content type, protocol version, oversize and bad JSON', async () => {
        const ctx = await liveSession();
        expect(
            (await call(ctx, rpc('ping'), { 'Content-Type': 'text/plain' })).res
                .status,
        ).toBe(415);
        expect(
            (
                await call(ctx, rpc('ping'), {
                    'MCP-Protocol-Version': '1999-01-01',
                })
            ).res.status,
        ).toBe(400);
        expect(
            (await call(ctx, 'x'.repeat(MAX_BODY_BYTES + 1))).res.status,
        ).toBe(413);
        const bad = await call(ctx, '{nope');
        expect(bad.res.status).toBe(400);
        expect(bad.body.error.code).toBe(-32700);
        expect((await call(ctx, [rpc('ping')])).res.status).toBe(400);
    });

    it('a notification gets 202 with no body', async () => {
        const ctx = await liveSession();
        const { res } = await call(ctx, {
            jsonrpc: '2.0',
            method: 'notifications/initialized',
        });
        expect(res.status).toBe(202);
    });

    it('initialize negotiates a supported version and advertises tools only', async () => {
        const ctx = await liveSession();
        const { body } = await call(
            ctx,
            rpc('initialize', {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'c', version: '1' },
            }),
        );
        expect(body.result.protocolVersion).toBe('2025-03-26');
        expect(body.result.capabilities).toEqual({ tools: {} });
        const other = await call(
            ctx,
            rpc('initialize', { protocolVersion: '1999-01-01' }),
        );
        expect(other.body.result.protocolVersion).toBe('2025-06-18');
    });

    it('an unknown method is -32601', async () => {
        const ctx = await liveSession();
        expect((await call(ctx, rpc('resources/list'))).body.error.code).toBe(
            -32601,
        );
    });
});

describe('/mcp: scope filtering', () => {
    it('tools/list shows only the approved scope, not the requested one', async () => {
        const ctx = await liveSession(['summary']);
        const { body } = await call(ctx, rpc('tools/list'));
        const names = body.result.tools.map((t) => t.name).sort();
        expect(names).toEqual([...toolsForScope(['summary'])].sort());
        expect(names).not.toContain('get_transactions');
        expect(names).not.toContain('get_accounts');
    });

    it('an unticked tool is not callable and nothing is sent to the browser', async () => {
        const ctx = await liveSession(['summary']);
        const before = ctx.socket.sent.length;
        const { body } = await call(
            ctx,
            rpc('tools/call', { name: 'get_transactions', arguments: {} }),
        );
        expect(body.error.code).toBe(-32602);
        const unknown = await call(
            ctx,
            rpc('tools/call', { name: 'nope', arguments: {} }),
        );
        expect(unknown.body.error.code).toBe(-32602);
        expect(ctx.socket.sent.length).toBe(before);
    });

    it('rejects non-object arguments', async () => {
        const ctx = await liveSession(['summary']);
        const { body } = await call(
            ctx,
            rpc('tools/call', { name: 'get_net_worth', arguments: [1] }),
        );
        expect(body.error.code).toBe(-32602);
    });
});

describe('/mcp: tools/call forwarding and the §6 failure table', () => {
    it('forwards a call as a CALL frame and returns the browser result', async () => {
        const ctx = await liveSession(['summary']);
        const p = call(
            ctx,
            rpc('tools/call', { name: 'get_net_worth', arguments: { a: 1 } }),
        );
        await calls(ctx);
        const frame = ctx.socket.last(FrameType.CALL);
        expect(frame.tool).toBe('get_net_worth');
        expect(frame.args).toEqual({ a: 1 });
        await answer(ctx, { ok: true, content: { total: 42 } });
        const { body } = await p;
        expect(body.result.isError).toBe(false);
        expect(JSON.parse(body.result.content[0].text)).toEqual({ total: 42 });
    });

    it('a browser error result is a tool error', async () => {
        const ctx = await liveSession(['summary']);
        const p = call(
            ctx,
            rpc('tools/call', { name: 'get_net_worth', arguments: {} }),
        );
        await calls(ctx);
        await answer(ctx, { ok: false, error: 'rate_limited' });
        const { body } = await p;
        expect(body.result).toMatchObject({ isError: true });
        expect(body.result.content[0].text).toBe('rate_limited');
    });

    it('call deadline passes: tool result isError "fire did not answer in time"', async () => {
        const ctx = await liveSession(['summary']);
        const p = call(
            ctx,
            rpc('tools/call', { name: 'get_net_worth', arguments: {} }),
        );
        await calls(ctx);
        await ctx.clock.advance(Limits.CALL_DEADLINE_MS + 1);
        const { res, body } = await p;
        expect(res.status).toBe(200);
        expect(body.result.isError).toBe(true);
        expect(body.result.content[0].text).toBe('fire did not answer in time');
    });

    it('tab gone within the grace: the call waits, then times out at its deadline', async () => {
        const ctx = await liveSession(['summary']);
        ctx.session.handleClose(ctx.socket);
        const p = call(
            ctx,
            rpc('tools/call', { name: 'get_net_worth', arguments: {} }),
        );
        while (!ctx.session.inFlight) {
            await new Promise((r) => setTimeout(r, 1));
        }
        await ctx.clock.advance(Limits.CALL_DEADLINE_MS + 1);
        expect((await p).body.result.content[0].text).toBe(
            'fire did not answer in time',
        );
    });

    it('after the grace the session is over: 401 invalid_token', async () => {
        const ctx = await liveSession(['summary']);
        ctx.session.handleClose(ctx.socket);
        await ctx.clock.advance(Limits.RECONNECT_GRACE_MS + 1);
        const { res } = await call(ctx, rpc('tools/list'));
        expect(res.status).toBe(401);
        expect(res.headers.get('WWW-Authenticate')).toContain('invalid_token');
    });

    it('the session ending mid-call returns 401 to that call', async () => {
        const ctx = await liveSession(['summary']);
        const p = call(
            ctx,
            rpc('tools/call', { name: 'get_net_worth', arguments: {} }),
        );
        await calls(ctx);
        ctx.session.end('user_disconnect');
        expect((await p).res.status).toBe(401);
    });

    it('an oversize RESULT becomes the result_too_large tool error', async () => {
        const ctx = await liveSession(['summary']);
        const p = call(
            ctx,
            rpc('tools/call', { name: 'get_net_worth', arguments: {} }),
        );
        await calls(ctx);
        await answer(ctx, {
            ok: true,
            content: 'x'.repeat(Limits.MAX_RESULT_BYTES),
        });
        expect((await p).body.result.content[0].text).toBe('result_too_large');
    });

    it('the 5th concurrent call is refused with rate_limited', async () => {
        const ctx = await liveSession(['summary']);
        const run = () =>
            call(
                ctx,
                rpc('tools/call', { name: 'get_net_worth', arguments: {} }),
            );
        const first = Array.from({ length: Limits.MAX_CALLS_IN_FLIGHT }, run);
        await calls(ctx, Limits.MAX_CALLS_IN_FLIGHT);
        const fifth = await run();
        expect(fifth.body.result).toMatchObject({ isError: true });
        expect(fifth.body.result.content[0].text).toBe('rate_limited');
        ctx.session.end('done');
        await Promise.all(first);
    });

    it('the 31st call within a minute is rate limited, and the window slides', async () => {
        const ctx = await liveSession(['summary']);
        const one = async (n) => {
            const p = call(
                ctx,
                rpc('tools/call', { name: 'get_net_worth', arguments: {} }),
            );
            await calls(ctx, n);
            await answer(ctx, { ok: true, content: {} });
            return p;
        };
        for (let i = 1; i <= Limits.RATE_LIMIT_CALLS_PER_MIN; i++) {
            expect((await one(i)).body.result.isError).toBe(false);
        }
        const over = await call(
            ctx,
            rpc('tools/call', { name: 'get_net_worth', arguments: {} }),
        );
        expect(over.body.result.content[0].text).toBe('rate_limited');
        await ctx.clock.advance(MIN + 1);
        expect(ctx.session.status).toBe('live');
        expect(
            (await one(Limits.RATE_LIMIT_CALLS_PER_MIN + 1)).body.result
                .isError,
        ).toBe(false);
    });
});

describe('worker routing for /mcp', () => {
    const sid = 'c'.repeat(32);
    const forwarded = [];
    const env = {
        PUBLIC_ORIGIN: 'https://fire.example',
        BRIDGE_SESSIONS: {
            idFromName: (n) => n,
            get: (id) => ({
                fetch: async () => {
                    forwarded.push(id);
                    return new Response('{}');
                },
            }),
        },
    };

    it('routes a POST with a sid-prefixed token to that session object', async () => {
        const res = await worker.fetch(
            post(rpc('ping'), `${sid}.${'r'.repeat(43)}`),
            env,
        );
        expect(res.status).toBe(200);
        expect(forwarded).toEqual([sid]);
    });

    it('answers 401/405/403 without touching a session object', async () => {
        forwarded.length = 0;
        expect((await worker.fetch(post(rpc('ping')), env)).status).toBe(401);
        expect(
            (await worker.fetch(post(rpc('ping'), 'garbage'), env)).status,
        ).toBe(401);
        expect(
            (await worker.fetch(new Request('https://fire.example/mcp'), env))
                .status,
        ).toBe(405);
        expect(
            (
                await worker.fetch(
                    post(rpc('ping'), `${sid}.${'r'.repeat(43)}`, {
                        Origin: 'https://x.example',
                    }),
                    env,
                )
            ).status,
        ).toBe(403);
        expect(forwarded).toEqual([]);
        expect(sidFromToken(null)).toBeNull();
    });
});
