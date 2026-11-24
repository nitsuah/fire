/* global setTimeout, Request */
import { webcrypto as crypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TextEncoder } from 'node:util';
import {
    buildProveSigningString,
    FrameType,
    generateId,
} from '../../../app/bridge-protocol.mjs';
import { BridgeSession } from '../../../relay/session.mjs';

export const ORIGIN = 'https://relay.example';

export class FakeClock {
    constructor(start = 1_000_000) {
        this.t = start;
        this.timers = new Map();
        this.next = 1;
    }
    now = () => this.t;
    setTimeout = (fn, ms) => this._add(fn, ms, null);
    setInterval = (fn, ms) => this._add(fn, ms, ms);
    clearTimeout = (h) => this.timers.delete(h);
    clearInterval = (h) => this.timers.delete(h);
    _add(fn, ms, every) {
        const h = this.next++;
        this.timers.set(h, { fn, at: this.t + ms, every });
        return h;
    }
    get pending() {
        return this.timers.size;
    }
    async advance(ms) {
        const target = this.t + ms;
        for (;;) {
            let best = null;
            for (const [h, tm] of this.timers) {
                if (tm.at <= target && (!best || tm.at < best[1].at)) {
                    best = [h, tm];
                }
            }
            if (!best) break;
            const [h, tm] = best;
            this.t = tm.at;
            if (tm.every) tm.at += tm.every;
            else this.timers.delete(h);
            tm.fn();
            await Promise.resolve();
        }
        this.t = target;
    }
}

export class FakeSocket {
    constructor() {
        this.sent = [];
        this.closed = null;
        this.pings = 0;
    }
    send(text) {
        this.sent.push(JSON.parse(text));
    }
    close(code, reason) {
        this.closed = { code, reason };
    }
    ping() {
        this.pings += 1;
    }
    last(type) {
        return [...this.sent].reverse().find((f) => f.type === type);
    }
}

export async function makeKey() {
    const pair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    );
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return {
        privateKey: pair.privateKey,
        pub: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    };
}

function b64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

export async function sign(key, { sid, nonce, scope, expiresAt, origin }) {
    const msg = new TextEncoder().encode(
        buildProveSigningString(origin ?? ORIGIN, sid, nonce, scope, expiresAt),
    );
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key.privateKey,
        msg,
    );
    return b64url(sig);
}

export function setup(over = {}) {
    const clock = over.clock ?? new FakeClock();
    const logs = [];
    const ended = [];
    const sid = over.sid ?? generateId();
    const session = new BridgeSession({
        sid,
        relayOrigin: ORIGIN,
        clock,
        log: (e) => logs.push(e),
        onEnd: (r) => ended.push(r),
        verifyPendingAuth: async (p) =>
            p === 'good-pending'
                ? { requestedScope: ['accounts', 'transactions'] }
                : null,
        ...over,
    });
    return { clock, logs, ended, sid, session };
}

export const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

export function send(session, socket, frame) {
    return session.handleMessage(socket, JSON.stringify(frame));
}

/** Drive a full first-time handshake; returns everything a test needs. */
export async function connect(ctx, over = {}) {
    const { session, clock, sid } = ctx;
    const key = over.key ?? (await makeKey());
    const scope = over.scope ?? ['accounts'];
    const expiresAt = over.expiresAt ?? clock.now() + 30 * 60_000;
    const socket = new FakeSocket();
    session.attach(socket);
    await send(session, socket, {
        v: 1,
        type: FrameType.HELLO,
        sid,
        pub: key.pub,
        pendingAuth: 'good-pending',
        scope,
        expiresAt,
    });
    const ch = socket.last(FrameType.CHALLENGE);
    const sig = await sign(key, { sid, nonce: ch.nonce, scope, expiresAt });
    await send(session, socket, { v: 1, type: FrameType.PROVE, sid, sig });
    return { socket, key, scope, expiresAt };
}

export async function reconnect(ctx, { key, scope, expiresAt }) {
    const { session, sid } = ctx;
    const socket = new FakeSocket();
    session.attach(socket);
    await send(session, socket, {
        v: 1,
        type: FrameType.HELLO,
        sid,
        pub: key.pub,
    });
    const ch = socket.last(FrameType.CHALLENGE);
    if (!ch) return { socket };
    const sig = await sign(key, { sid, nonce: ch.nonce, scope, expiresAt });
    await send(session, socket, { v: 1, type: FrameType.PROVE, sid, sig });
    return { socket };
}

// ---- OAuth flow helpers (real HMAC key, real DO adapter, fake sockets) ----
import { BridgeSessionObject } from '../../../relay/session-object.mjs';
import { b64urlEncode, sha256b64url } from '../../../relay/signing.mjs';

export const PUBLIC = 'https://fire.example';
export const HMAC_SECRET = b64urlEncode(new Uint8Array(32).fill(7));

export class FakeServerSocket {
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
    last(type) {
        return [...this.sent].reverse().find((f) => f.type === type);
    }
}

export async function until(predicate, ms = 3000) {
    const end = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > end) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 1));
    }
}

/** A Durable Object namespace backed by real BridgeSessionObjects. */
export function makeNamespace(env, clock) {
    const objects = new Map();
    const sockets = new Map();
    return {
        sockets,
        idFromName: (n) => n,
        get: (sid) => {
            if (!objects.has(sid)) {
                const server = new FakeServerSocket();
                sockets.set(sid, server);
                objects.set(
                    sid,
                    new BridgeSessionObject({}, env, {
                        WebSocketPair: class {
                            constructor() {
                                this[0] = {};
                                this[1] = server;
                            }
                        },
                        upgradeResponse: () => ({ status: 101 }),
                        clock,
                    }),
                );
            }
            return objects.get(sid);
        },
    };
}

export const flowEnv = (over = {}) => ({
    PUBLIC_ORIGIN: PUBLIC,
    APP_ORIGIN: PUBLIC,
    RELAY_HMAC_KEY: HMAC_SECRET,
    ...over,
});

export const pkce = async (verifier = 'v'.repeat(64)) => ({
    verifier,
    challenge: await sha256b64url(verifier),
});

export async function openBrowserSession(ns, env, pendingAuth, scope, clock) {
    const sid = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const key = await makeKey();
    const obj = ns.get(sid);
    await obj.fetch(
        new Request(`${PUBLIC}/bridge/${sid}`, {
            headers: { Upgrade: 'websocket' },
        }),
    );
    const server = ns.sockets.get(sid);
    const expiresAt = clock.now() + 30 * 60_000;
    server.handlers.message({
        data: JSON.stringify({
            v: 1,
            type: 'HELLO',
            sid,
            pub: key.pub,
            pendingAuth,
            scope,
            expiresAt,
        }),
    });
    await until(() => server.last('CHALLENGE') || server.closed);
    const ch = server.last('CHALLENGE');
    if (!ch) return { sid, server, key, closed: true };
    const sig = await sign(key, {
        sid,
        nonce: ch.nonce,
        scope,
        expiresAt,
        origin: PUBLIC,
    });
    server.handlers.message({
        data: JSON.stringify({ v: 1, type: 'PROVE', sid, sig }),
    });
    await until(() => server.last('READY') || server.closed);
    return { sid, server, key, expiresAt, ready: !!server.last('READY') };
}
