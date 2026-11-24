import { describe, it, expect } from 'vitest';
import { FrameType, Limits } from '../../../app/bridge-protocol.mjs';
import { PING_INTERVAL_MS, SessionError } from '../../../relay/session.mjs';
import {
    FakeSocket,
    connect,
    makeKey,
    reconnect,
    send,
    setup,
    sign,
} from './helpers.mjs';

const MIN = 60_000;

describe('relay session: handshake', () => {
    it('opens a session after HELLO/CHALLENGE/PROVE and echoes the approved scope', async () => {
        const ctx = setup();
        const { socket, scope, expiresAt } = await connect(ctx);
        const ready = socket.last(FrameType.READY);
        expect(ready.scope).toEqual(scope);
        expect(ready.expiresAt).toBe(expiresAt);
        expect(ready.idleTimeout).toBe(Limits.IDLE_TIMEOUT_MS);
        expect(ctx.session.status).toBe('live');
    });

    it('denies HELLO with no or invalid pending authorization', async () => {
        for (const pendingAuth of [undefined, 'forged']) {
            const ctx = setup();
            const key = await makeKey();
            const socket = new FakeSocket();
            ctx.session.attach(socket);
            await send(ctx.session, socket, {
                v: 1,
                type: FrameType.HELLO,
                sid: ctx.sid,
                pub: key.pub,
                pendingAuth,
                scope: ['accounts'],
                expiresAt: ctx.clock.now() + MIN,
            });
            expect(socket.closed).toBeTruthy();
            expect(socket.last(FrameType.CHALLENGE)).toBeUndefined();
            expect(ctx.session.status).toBe('new');
        }
    });

    it('rejects an approved scope outside the requested one, or empty', async () => {
        for (const scope of [['accounts', 'wallets'], []]) {
            const ctx = setup();
            const key = await makeKey();
            const socket = new FakeSocket();
            ctx.session.attach(socket);
            await send(ctx.session, socket, {
                v: 1,
                type: FrameType.HELLO,
                sid: ctx.sid,
                pub: key.pub,
                pendingAuth: 'good-pending',
                scope,
                expiresAt: ctx.clock.now() + MIN,
            });
            expect(socket.closed).toBeTruthy();
        }
    });

    it('rejects expiresAt in the past or beyond the 60 minute maximum', async () => {
        for (const delta of [-1, 0, Limits.SESSION_MAX_MS + 1]) {
            const ctx = setup();
            const key = await makeKey();
            const socket = new FakeSocket();
            ctx.session.attach(socket);
            await send(ctx.session, socket, {
                v: 1,
                type: FrameType.HELLO,
                sid: ctx.sid,
                pub: key.pub,
                pendingAuth: 'good-pending',
                scope: ['accounts'],
                expiresAt: ctx.clock.now() + delta,
            });
            expect(socket.closed).toBeTruthy();
        }
    });

    it('rejects a PROVE signed for a wider scope than the HELLO carried', async () => {
        const ctx = setup();
        const key = await makeKey();
        const socket = new FakeSocket();
        ctx.session.attach(socket);
        const expiresAt = ctx.clock.now() + MIN;
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.HELLO,
            sid: ctx.sid,
            pub: key.pub,
            pendingAuth: 'good-pending',
            scope: ['accounts'],
            expiresAt,
        });
        const ch = socket.last(FrameType.CHALLENGE);
        const sig = await sign(key, {
            sid: ctx.sid,
            nonce: ch.nonce,
            scope: ['accounts', 'transactions'],
            expiresAt,
        });
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.PROVE,
            sid: ctx.sid,
            sig,
        });
        expect(socket.closed).toBeTruthy();
        expect(ctx.session.status).toBe('new');
    });

    it('rejects a PROVE signed by a different key or for another relay origin', async () => {
        for (const mode of ['otherKey', 'otherOrigin']) {
            const ctx = setup();
            const key = await makeKey();
            const socket = new FakeSocket();
            ctx.session.attach(socket);
            const expiresAt = ctx.clock.now() + MIN;
            await send(ctx.session, socket, {
                v: 1,
                type: FrameType.HELLO,
                sid: ctx.sid,
                pub: key.pub,
                pendingAuth: 'good-pending',
                scope: ['accounts'],
                expiresAt,
            });
            const ch = socket.last(FrameType.CHALLENGE);
            const sig = await sign(
                mode === 'otherKey' ? await makeKey() : key,
                {
                    sid: ctx.sid,
                    nonce: ch.nonce,
                    scope: ['accounts'],
                    expiresAt,
                    origin:
                        mode === 'otherOrigin'
                            ? 'https://evil.example'
                            : undefined,
                },
            );
            await send(ctx.session, socket, {
                v: 1,
                type: FrameType.PROVE,
                sid: ctx.sid,
                sig,
            });
            expect(socket.closed).toBeTruthy();
            expect(ctx.session.status).toBe('new');
        }
    });

    it('accepts a nonce once: replaying the PROVE fails', async () => {
        const ctx = setup();
        const key = await makeKey();
        const socket = new FakeSocket();
        ctx.session.attach(socket);
        const expiresAt = ctx.clock.now() + MIN;
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.HELLO,
            sid: ctx.sid,
            pub: key.pub,
            pendingAuth: 'good-pending',
            scope: ['accounts'],
            expiresAt,
        });
        const ch = socket.last(FrameType.CHALLENGE);
        const sig = await sign(key, {
            sid: ctx.sid,
            nonce: ch.nonce,
            scope: ['accounts'],
            expiresAt,
        });
        const prove = { v: 1, type: FrameType.PROVE, sid: ctx.sid, sig };
        await send(ctx.session, socket, prove);
        expect(ctx.session.status).toBe('live');
        // A second socket replaying that PROVE has no challenge of its own.
        const attacker = new FakeSocket();
        ctx.session.attach(attacker);
        await send(ctx.session, attacker, prove);
        expect(attacker.closed).toBeTruthy();
        expect(ctx.session.status).toBe('live');
    });

    it('closes a socket that does not answer the challenge in 10 s', async () => {
        const ctx = setup();
        const key = await makeKey();
        const socket = new FakeSocket();
        ctx.session.attach(socket);
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.HELLO,
            sid: ctx.sid,
            pub: key.pub,
            pendingAuth: 'good-pending',
            scope: ['accounts'],
            expiresAt: ctx.clock.now() + MIN,
        });
        await ctx.clock.advance(Limits.NONCE_EXPIRY_MS + 1);
        expect(socket.closed).toBeTruthy();
    });

    it('rejects frames with a wrong sid, bad JSON, or oversize input', async () => {
        const ctx = setup();
        for (const data of [
            JSON.stringify({ v: 1, type: 'HELLO', sid: 'f'.repeat(32) }),
            '{not json',
            'x'.repeat(Limits.MAX_RESULT_BYTES + 5000),
        ]) {
            const socket = new FakeSocket();
            ctx.session.attach(socket);
            await ctx.session.handleMessage(socket, data);
            expect(socket.closed).toBeTruthy();
        }
    });

    it('caps unauthenticated sockets', async () => {
        const ctx = setup();
        const sockets = Array.from({ length: 6 }, () => new FakeSocket());
        sockets.forEach((s) => ctx.session.attach(s));
        expect(sockets.filter((s) => s.closed).length).toBe(2);
    });
});

describe('relay session: reconnect, grace and expiry (fake clock)', () => {
    it('fails closed on an unknown sid: reconnect HELLO with no session state', async () => {
        const ctx = setup();
        const key = await makeKey();
        const socket = new FakeSocket();
        ctx.session.attach(socket);
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.HELLO,
            sid: ctx.sid,
            pub: key.pub,
        });
        expect(socket.closed).toBeTruthy();
        expect(socket.last(FrameType.CHALLENGE)).toBeUndefined();
        expect(ctx.session.status).toBe('new');
    });

    it('rejects a constructor sid that is not 128-bit hex', () => {
        expect(() => setup({ sid: 'short' })).toThrow();
    });

    it('resumes within the 30 s grace with a proven reconnect', async () => {
        const ctx = setup();
        const first = await connect(ctx);
        first.socket.closed = null;
        ctx.session.handleClose(first.socket);
        expect(ctx.session.status).toBe('grace');
        await ctx.clock.advance(Limits.RECONNECT_GRACE_MS - 1000);
        const { socket } = await reconnect(ctx, first);
        expect(socket.last(FrameType.READY)).toBeTruthy();
        expect(ctx.session.status).toBe('live');
        await ctx.clock.advance(Limits.RECONNECT_GRACE_MS * 2);
        expect(ctx.session.status).toBe('live');
    });

    it('ends the session when the grace passes with no reconnect', async () => {
        const ctx = setup();
        const first = await connect(ctx);
        ctx.session.handleClose(first.socket);
        await ctx.clock.advance(Limits.RECONNECT_GRACE_MS + 1);
        expect(ctx.session.status).toBe('ended');
        expect(ctx.ended).toEqual(['grace_expired']);
        expect(ctx.session.pub).toBeNull();
        // A later reconnect is refused.
        const { socket } = await reconnect(ctx, first);
        expect(socket.closed).toBeTruthy();
        expect(socket.last(FrameType.READY)).toBeUndefined();
    });

    it('refuses a reconnect with a different key', async () => {
        const ctx = setup();
        const first = await connect(ctx);
        ctx.session.handleClose(first.socket);
        const other = await makeKey();
        const { socket } = await reconnect(ctx, { ...first, key: other });
        expect(socket.closed).toBeTruthy();
        expect(ctx.session.status).toBe('grace');
    });

    it('refuses a reconnect HELLO that tries to change scope or expiry', async () => {
        const ctx = setup();
        const first = await connect(ctx);
        ctx.session.handleClose(first.socket);
        const socket = new FakeSocket();
        ctx.session.attach(socket);
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.HELLO,
            sid: ctx.sid,
            pub: first.key.pub,
            scope: ['accounts', 'transactions'],
        });
        expect(socket.closed).toBeTruthy();
    });

    it('does not let an unproven socket displace the live one', async () => {
        const ctx = setup();
        const first = await connect(ctx);
        const intruder = new FakeSocket();
        ctx.session.attach(intruder);
        await send(ctx.session, intruder, {
            v: 1,
            type: FrameType.HELLO,
            sid: ctx.sid,
            pub: first.key.pub,
        });
        expect(first.socket.closed).toBeNull();
        expect(ctx.session.status).toBe('live');
    });

    it('replaces the old socket when the reconnect proves', async () => {
        const ctx = setup();
        const first = await connect(ctx);
        const { socket } = await reconnect(ctx, first);
        expect(first.socket.last(FrameType.END).reason).toBe('replaced');
        expect(socket.last(FrameType.READY)).toBeTruthy();
    });

    it('ends at the hard expiry', async () => {
        const ctx = setup();
        const { socket } = await connect(ctx, {
            expiresAt: 1_000_000 + 8 * MIN,
        });
        await ctx.clock.advance(8 * MIN + 1);
        expect(ctx.session.status).toBe('ended');
        expect(ctx.ended).toEqual(['expired']);
        expect(socket.last(FrameType.END).reason).toBe('expired');
        expect(socket.closed).toBeTruthy();
    });

    it('ends after 10 minutes with no tool calls, and a call resets the idle timer', async () => {
        const ctx = setup();
        const { socket } = await connect(ctx);
        await ctx.clock.advance(9 * MIN);
        const p = ctx.session.dispatchCall('get_net_worth', {});
        const call = socket.last(FrameType.CALL);
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.RESULT,
            sid: ctx.sid,
            id: call.id,
            ok: true,
            content: { total: 1 },
        });
        await p;
        await ctx.clock.advance(9 * MIN);
        expect(ctx.session.status).toBe('live');
        await ctx.clock.advance(MIN + 1);
        expect(ctx.session.status).toBe('ended');
        expect(ctx.ended).toEqual(['idle_timeout']);
    });

    it('pings the live socket every 20 s and stops after it drops', async () => {
        const ctx = setup();
        const { socket } = await connect(ctx);
        await ctx.clock.advance(PING_INTERVAL_MS * 3);
        expect(socket.pings).toBe(3);
        ctx.session.handleClose(socket);
        await ctx.clock.advance(PING_INTERVAL_MS * 3);
        expect(socket.pings).toBe(3);
    });

    it('ends on a browser END and rejects in-flight calls', async () => {
        const ctx = setup();
        const { socket } = await connect(ctx);
        const p = ctx.session.dispatchCall('get_net_worth', {});
        const settled = p.catch((e) => e);
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.END,
            sid: ctx.sid,
            reason: 'user_disconnect',
        });
        expect((await settled).code).toBe('invalid_token');
        expect(ctx.ended).toEqual(['browser_end']);
        expect(ctx.clock.pending).toBe(0);
    });
});

describe('relay session: calls', () => {
    async function live() {
        const ctx = setup();
        const conn = await connect(ctx);
        return { ctx, ...conn };
    }
    const result = (ctx, id, extra = {}) => ({
        v: 1,
        type: FrameType.RESULT,
        sid: ctx.sid,
        id,
        ok: true,
        content: { value: 1 },
        ...extra,
    });

    it('sends strictly increasing seq, fresh ids and a deadline', async () => {
        const { ctx, socket } = await live();
        ctx.session.dispatchCall('a', {}).catch(() => {});
        ctx.session.dispatchCall('b', {}).catch(() => {});
        const calls = socket.sent.filter((f) => f.type === FrameType.CALL);
        expect(calls.map((c) => c.seq)).toEqual([1, 2]);
        expect(calls[0].id).not.toBe(calls[1].id);
        expect(calls[0].id).toMatch(/^[0-9a-f]{32}$/);
        expect(calls[0].deadline).toBe(
            ctx.clock.now() + Limits.CALL_DEADLINE_MS,
        );
    });

    it('answers a call once; a duplicate or unknown RESULT is dropped', async () => {
        const { ctx, socket } = await live();
        const p = ctx.session.dispatchCall('get_net_worth', {});
        const call = socket.last(FrameType.CALL);
        await send(ctx.session, socket, result(ctx, call.id));
        await send(
            ctx.session,
            socket,
            result(ctx, call.id, { content: { value: 2 } }),
        );
        await send(ctx.session, socket, result(ctx, 'a'.repeat(32)));
        expect(await p).toEqual({ ok: true, content: { value: 1 } });
        expect(ctx.session.status).toBe('live');
    });

    it('maps an error RESULT and rejects an oversize one', async () => {
        const { ctx, socket } = await live();
        const p1 = ctx.session.dispatchCall('t', {});
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.RESULT,
            sid: ctx.sid,
            id: socket.last(FrameType.CALL).id,
            ok: false,
            error: 'rate_limited',
        });
        expect(await p1).toEqual({ ok: false, error: 'rate_limited' });
        const p2 = ctx.session.dispatchCall('t', {});
        const settled = p2.catch((e) => e);
        await send(
            ctx.session,
            socket,
            result(ctx, socket.last(FrameType.CALL).id, {
                content: 'x'.repeat(Limits.MAX_RESULT_BYTES),
            }),
        );
        expect((await settled).code).toBe('result_too_large');
    });

    it('times out at the call deadline and drops a late RESULT', async () => {
        const { ctx, socket } = await live();
        const p = ctx.session.dispatchCall('t', {});
        const settled = p.catch((e) => e);
        const id = socket.last(FrameType.CALL).id;
        await ctx.clock.advance(Limits.CALL_DEADLINE_MS + 1);
        const err = await settled;
        expect(err).toBeInstanceOf(SessionError);
        expect(err.code).toBe('timeout');
        await send(ctx.session, socket, result(ctx, id));
        expect(ctx.logs).toContain('call_dropped');
    });

    it('never sets a call deadline beyond the session expiry', async () => {
        const ctx = setup();
        const { socket } = await connect(ctx, { expiresAt: 1_000_000 + 5000 });
        ctx.session.dispatchCall('t', {}).catch(() => {});
        expect(socket.last(FrameType.CALL).deadline).toBe(1_000_000 + 5000);
    });

    it('holds a call during the grace and sends it on reconnect', async () => {
        const ctx = setup();
        const first = await connect(ctx);
        ctx.session.handleClose(first.socket);
        const p = ctx.session.dispatchCall('t', {});
        await ctx.clock.advance(5000);
        const { socket } = await reconnect(ctx, first);
        const call = socket.last(FrameType.CALL);
        expect(call.tool).toBe('t');
        await send(ctx.session, socket, result(ctx, call.id));
        expect((await p).ok).toBe(true);
    });

    it('a call held in the grace times out at its deadline', async () => {
        const ctx = setup();
        const first = await connect(ctx);
        ctx.session.handleClose(first.socket);
        const settled = ctx.session.dispatchCall('t', {}).catch((e) => e);
        await ctx.clock.advance(Limits.RECONNECT_GRACE_MS + 1);
        // the grace (30 s) outlasts the call deadline (15 s), so it timed out first
        expect((await settled).code).toBe('timeout');
    });

    it('rejects calls on a session that never opened or has ended', async () => {
        const ctx = setup();
        await expect(ctx.session.dispatchCall('t', {})).rejects.toMatchObject({
            code: 'invalid_token',
        });
        await connect(ctx);
        ctx.session.end('test');
        await expect(ctx.session.dispatchCall('t', {})).rejects.toMatchObject({
            code: 'invalid_token',
        });
    });
});
