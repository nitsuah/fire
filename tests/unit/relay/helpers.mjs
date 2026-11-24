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
