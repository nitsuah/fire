import { describe, it, expect } from 'vitest';
import { FrameType } from '../../../app/bridge-protocol.mjs';
import {
    BridgeSessionObject,
    sidFromPath,
} from '../../../relay/session-object.mjs';
import worker, { originAllowed } from '../../../relay/worker.mjs';
import { FakeClock, makeKey, sign } from './helpers.mjs';

const sid = 'a'.repeat(32);

// Poll for an async effect, failing after a bounded wait instead of sleeping
// a fixed time.
async function until(predicate, ms = 3000) {
    const end = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > end) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 1));
    }
}

class FakeServerSocket {
    constructor() {
        this.handlers = {};
        this.sent = [];
        this.accepted = false;
        this.closed = null;
    }
    accept() {
        this.accepted = true;
    }
    addEventListener(name, fn) {
        this.handlers[name] = fn;
    }
    send(t) {
        this.sent.push(JSON.parse(t));
    }
    close(code, reason) {
        this.closed = { code, reason };
    }
}

function makeObject(extra = {}) {
    const server = new FakeServerSocket();
    const obj = new BridgeSessionObject(
        {},
        { RELAY_ORIGIN: 'https://relay.example' },
        {
            WebSocketPair: class {
                constructor() {
                    this[0] = { client: true };
                    this[1] = server;
                }
            },
            upgradeResponse: (client) => ({ status: 101, webSocket: client }),
            clock: new FakeClock(),
            verifyPendingAuth: async () => ({ requestedScope: ['accounts'] }),
            ...extra,
        },
    );
    return { obj, server };
}

const upgrade = (path, headers = {}) =>
    new Request(`https://relay.example${path}`, {
        headers: { Upgrade: 'websocket', ...headers },
    });

describe('Durable Object adapter', () => {
    it('accepts the socket with the standard accept() and runs the handshake', async () => {
        const { obj, server } = makeObject();
        const res = await obj.fetch(upgrade(`/bridge/${sid}`));
        expect(res.status).toBe(101);
        expect(server.accepted).toBe(true);
        const key = await makeKey();
        // The fake clock starts at 1_000_000.
        const exp = 1_000_000 + 5 * 60_000;
        server.handlers.message({
            data: JSON.stringify({
                v: 1,
                type: FrameType.HELLO,
                sid,
                pub: key.pub,
                pendingAuth: 'p',
                scope: ['accounts'],
                expiresAt: exp,
            }),
        });
        await until(() =>
            server.sent.some((f) => f.type === FrameType.CHALLENGE),
        );
        const ch = server.sent.find((f) => f.type === FrameType.CHALLENGE);
        expect(ch).toBeTruthy();
        const sig = await sign(key, {
            sid,
            nonce: ch.nonce,
            scope: ['accounts'],
            expiresAt: exp,
            origin: 'https://relay.example',
        });
        server.handlers.message({
            data: JSON.stringify({ v: 1, type: FrameType.PROVE, sid, sig }),
        });
        await until(() => server.sent.some((f) => f.type === FrameType.READY));
        expect(server.sent.some((f) => f.type === FrameType.READY)).toBe(true);
    });

    it('sends a PING keepalive every 20 s through the Workers socket', async () => {
        const clock = new FakeClock();
        const { obj, server } = makeObject({ clock });
        await obj.fetch(upgrade(`/bridge/${sid}`));
        const key = await makeKey();
        const exp = clock.now() + 5 * 60_000;
        server.handlers.message({
            data: JSON.stringify({
                v: 1,
                type: FrameType.HELLO,
                sid,
                pub: key.pub,
                pendingAuth: 'p',
                scope: ['accounts'],
                expiresAt: exp,
            }),
        });
        await until(() =>
            server.sent.some((f) => f.type === FrameType.CHALLENGE),
        );
        const ch = server.sent.find((f) => f.type === FrameType.CHALLENGE);
        const sig = await sign(key, {
            sid,
            nonce: ch.nonce,
            scope: ['accounts'],
            expiresAt: exp,
            origin: 'https://relay.example',
        });
        server.handlers.message({
            data: JSON.stringify({ v: 1, type: FrameType.PROVE, sid, sig }),
        });
        await until(() => server.sent.some((f) => f.type === FrameType.READY));
        await clock.advance(60_000);
        expect(server.sent.filter((f) => f.type === 'PING').length).toBe(3);
    });

    it('denies by default when no pending-authorization verifier is wired', async () => {
        const { obj, server } = makeObject({ verifyPendingAuth: undefined });
        await obj.fetch(upgrade(`/bridge/${sid}`));
        const key = await makeKey();
        server.handlers.message({
            data: JSON.stringify({
                v: 1,
                type: FrameType.HELLO,
                sid,
                pub: key.pub,
                pendingAuth: 'p',
                scope: ['accounts'],
                expiresAt: 1_000_000 + 60_000,
            }),
        });
        await until(() => server.closed);
        expect(server.closed).toBeTruthy();
    });

    it('refuses non-upgrade requests, bad paths and a different sid', async () => {
        const { obj } = makeObject();
        expect(
            (
                await obj.fetch(
                    new Request(`https://relay.example/bridge/${sid}`),
                )
            ).status,
        ).toBe(426);
        expect((await obj.fetch(upgrade('/bridge/nope'))).status).toBe(404);
        await obj.fetch(upgrade(`/bridge/${sid}`));
        expect(
            (await obj.fetch(upgrade(`/bridge/${'b'.repeat(32)}`))).status,
        ).toBe(404);
    });
});

describe('Worker entry', () => {
    const env = {
        APP_ORIGIN: 'https://fire.example',
        BRIDGE_SESSIONS: {
            idFromName: (n) => n,
            get: (id) => ({
                fetch: async () => ({ status: 101, routedTo: id }),
            }),
        },
    };

    it('routes an allowed-origin upgrade to the session named by the sid', async () => {
        const res = await worker.fetch(
            upgrade(`/bridge/${sid}`, { Origin: 'https://fire.example' }),
            env,
        );
        expect(res.routedTo).toBe(sid);
    });

    it('denies a missing, wrong or unconfigured origin', async () => {
        for (const [req, e] of [
            [upgrade(`/bridge/${sid}`), env],
            [
                upgrade(`/bridge/${sid}`, { Origin: 'https://evil.example' }),
                env,
            ],
            [
                upgrade(`/bridge/${sid}`, { Origin: 'https://fire.example' }),
                { ...env, APP_ORIGIN: '' },
            ],
        ]) {
            expect((await worker.fetch(req, e)).status).toBe(403);
        }
        expect(originAllowed(upgrade('/x'), undefined)).toBe(false);
    });

    it('404s unknown paths and 426s plain requests', async () => {
        expect((await worker.fetch(upgrade('/other'), env)).status).toBe(404);
        expect(
            (
                await worker.fetch(
                    new Request(`https://relay.example/bridge/${sid}`),
                    env,
                )
            ).status,
        ).toBe(426);
        expect(sidFromPath('/bridge/xyz')).toBeNull();
    });
});
