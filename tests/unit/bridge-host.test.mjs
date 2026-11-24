import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { handleTool } from '../../app/mcp-tools.mjs';
import {
    ACTIVITY_KEY,
    ACTIVITY_MAX,
    BridgeHost,
    ResultTooLarge,
    acquireBridgeLock,
    fitResult,
    renderBanner,
} from '../../app/bridge-host.mjs';
import {
    FrameType,
    Limits,
    generateId,
    verifyProve,
} from '../../app/bridge-protocol.mjs';
import { FakeClock } from './relay/helpers.mjs';

const RELAY = 'wss://relay.example';
const ORIGIN = 'https://relay.example';
const MIN = 60_000;

class FakeWS {
    constructor(url) {
        this.url = url;
        this.sent = [];
        this.handlers = {};
        this.closed = false;
    }
    addEventListener(name, fn) {
        this.handlers[name] = fn;
    }
    send(t) {
        this.sent.push(JSON.parse(t));
    }
    close() {
        this.closed = true;
    }
    open() {
        this.handlers.open?.();
    }
    serverSend(frame) {
        return this.handlers.message?.({ data: JSON.stringify(frame) });
    }
    drop() {
        this.handlers.close?.();
    }
    last(type) {
        return [...this.sent].reverse().find((f) => f.type === type);
    }
}

function memoryStorage() {
    const data = new Map();
    const writes = [];
    return {
        data,
        writes,
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => {
            writes.push(k);
            data.set(k, v);
        },
    };
}

const until = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (!pred()) {
        if (Date.now() > end) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 1));
    }
};

function makeHost(over = {}) {
    const clock = new FakeClock(5_000_000);
    const sockets = [];
    const storage = memoryStorage();
    const state = { spendingTransactions: [], customAccounts: [] };
    const host = new BridgeHost({
        createSocket: (url) => {
            const ws = new FakeWS(url);
            sockets.push(ws);
            return ws;
        },
        relayUrl: RELAY,
        getState: () => state,
        handleTool:
            over.handleTool ||
            ((name, s, args) => ({
                tool: name,
                args,
                n: s.spendingTransactions.length,
            })),
        storage,
        clock,
        ...over,
    });
    return { host, clock, sockets, storage, state };
}

const SID = 'a'.repeat(32);

/** Run the handshake against a fake relay, up to READY. */
async function connect(t, { scope = ['summary'], lengthMs = 30 * MIN } = {}) {
    await t.host.start({
        sid: SID,
        pendingAuth: 'pending-value',
        scope,
        lengthMs,
        clientName: 'Test Agent',
    });
    const ws = t.sockets[t.sockets.length - 1];
    ws.open();
    const hello = ws.last(FrameType.HELLO);
    ws.serverSend({
        v: 1,
        type: 'CHALLENGE',
        sid: SID,
        nonce: 'b'.repeat(32),
        exp: t.clock.now() + 10_000,
    });
    await until(() => ws.last(FrameType.PROVE));
    await ws.serverSend({
        v: 1,
        type: 'READY',
        sid: SID,
        expiresAt: t.host.expiresAt,
        idleTimeout: Limits.IDLE_TIMEOUT_MS,
        scope,
    });
    return { ws, hello };
}

let seq = 0;
const call = (t, ws, tool, over = {}) => {
    seq += 1;
    return ws.serverSend({
        v: 1,
        type: 'CALL',
        sid: SID,
        seq: over.seq ?? seq,
        id: over.id ?? generateId(),
        deadline: over.deadline ?? t.clock.now() + 15_000,
        tool,
        args: over.args ?? {},
    });
};
const results = (ws) => ws.sent.filter((f) => f.type === FrameType.RESULT);

describe('handshake and key custody', () => {
    it('sends a public-only JWK and the browser-computed scope and expiry', async () => {
        const t = makeHost();
        const { hello } = await connect(t, { scope: ['summary', 'accounts'] });
        expect(hello.pub).not.toHaveProperty('d');
        expect(hello.pendingAuth).toBe('pending-value');
        expect(hello.scope).toEqual(['summary', 'accounts']);
        expect(hello.expiresAt).toBe(5_000_000 + 30 * MIN);
        expect(t.host.state).toBe('live');
    });

    it('holds a non-extractable private key', async () => {
        const t = makeHost();
        await connect(t);
        await expect(
            globalThis.crypto.subtle.exportKey('jwk', t.host.key),
        ).rejects.toThrow();
        expect(t.host.key.extractable).toBe(false);
    });

    it('signs PROVE over the relay origin, sid, nonce, scope and expiry', async () => {
        const t = makeHost();
        const { ws, hello } = await connect(t, { scope: ['accounts'] });
        const prove = ws.last(FrameType.PROVE);
        const ok = await verifyProve(prove.sig, hello.pub, {
            relayOrigin: ORIGIN,
            sid: SID,
            nonce: 'b'.repeat(32),
            scope: ['accounts'],
            expiresAt: hello.expiresAt,
        });
        expect(ok).toBe(true);
        const widerScope = await verifyProve(prove.sig, hello.pub, {
            relayOrigin: ORIGIN,
            sid: SID,
            nonce: 'b'.repeat(32),
            scope: ['accounts', 'transactions'],
            expiresAt: hello.expiresAt,
        });
        expect(widerScope).toBe(false);
    });

    it('rejects unsupported session lengths and empty scope', async () => {
        const t = makeHost();
        await expect(
            t.host.start({
                sid: SID,
                pendingAuth: 'p',
                scope: ['summary'],
                lengthMs: 120 * MIN,
            }),
        ).rejects.toThrow();
        await expect(
            t.host.start({
                sid: SID,
                pendingAuth: 'p',
                scope: [],
                lengthMs: 15 * MIN,
            }),
        ).rejects.toThrow();
    });

    it.each([
        ['scope', { scope: ['summary', 'transactions'] }],
        ['expiresAt', { expiresAt: 1 }],
        ['idleTimeout', { idleTimeout: 1 }],
    ])('ends the session when READY disagrees on %s', async (_n, bad) => {
        const t = makeHost();
        await t.host.start({
            sid: SID,
            pendingAuth: 'p',
            scope: ['summary'],
            lengthMs: 15 * MIN,
        });
        const ws = t.sockets[0];
        ws.open();
        await ws.serverSend({
            v: 1,
            type: 'READY',
            sid: SID,
            expiresAt: t.host.expiresAt,
            idleTimeout: Limits.IDLE_TIMEOUT_MS,
            scope: ['summary'],
            ...bad,
        });
        expect(t.host.state).toBe('ended');
        expect(t.host.key).toBeNull();
        expect(t.host.scope).toBeNull();
    });

    it('ignores relay keepalive PING frames', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        await ws.serverSend({ v: 1, type: 'PING', sid: SID });
        expect(t.host.state).toBe('live');
    });
});

describe('call enforcement (the browser decides, not the relay)', () => {
    it('answers an allowed call and logs metadata only', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        call(t, ws, 'get_net_worth', { args: { secret: 'ARG-VALUE' } });
        expect(results(ws)[0]).toMatchObject({ ok: true });
        const log = JSON.parse(t.storage.data.get(ACTIVITY_KEY));
        expect(Object.keys(log[0]).sort()).toEqual([
            'bytes',
            'outcome',
            'tool',
            'ts',
        ]);
        expect(JSON.stringify(log)).not.toContain('ARG-VALUE');
        expect(t.host.status().calls).toBe(1);
    });

    it('reads the current state on every call', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        call(t, ws, 'get_net_worth');
        t.state.spendingTransactions.push({ id: 1 });
        call(t, ws, 'get_net_worth');
        const [a, b] = results(ws);
        expect([a.content.n, b.content.n]).toEqual([0, 1]);
    });

    it('refuses a tool outside the approved scope even if the relay sends it', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        call(t, ws, 'get_transactions');
        expect(results(ws)[0]).toMatchObject({
            ok: false,
            error: 'not_in_scope',
        });
    });

    it('drops replayed or reordered seq, duplicate ids, past deadlines and a wrong sid', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        const id = generateId();
        call(t, ws, 'get_net_worth', { seq: 10, id });
        call(t, ws, 'get_net_worth', { seq: 10, id: generateId() }); // replayed seq
        call(t, ws, 'get_net_worth', { seq: 9, id: generateId() }); // reordered
        call(t, ws, 'get_net_worth', { seq: 11, id }); // duplicate id
        call(t, ws, 'get_net_worth', { seq: 12, deadline: t.clock.now() - 1 });
        await ws.serverSend({
            v: 1,
            type: 'CALL',
            sid: 'f'.repeat(32),
            seq: 13,
            id: generateId(),
            deadline: t.clock.now() + 9999,
            tool: 'get_net_worth',
            args: {},
        });
        expect(results(ws).length).toBe(1);
        expect(t.host.state).toBe('live');
    });

    it('rate limits at 30 calls a minute, then recovers', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        for (let i = 0; i < 30; i++) call(t, ws, 'get_net_worth');
        call(t, ws, 'get_net_worth');
        expect(results(ws).at(-1)).toMatchObject({
            ok: false,
            error: 'rate_limited',
        });
        await t.clock.advance(MIN + 1);
        call(t, ws, 'get_net_worth');
        expect(results(ws).at(-1).ok).toBe(true);
    });

    it('turns a tool error into a short error RESULT', async () => {
        const t = makeHost({
            handleTool: () => {
                throw new Error('stale_offset: data changed');
            },
        });
        const { ws } = await connect(t);
        call(t, ws, 'get_net_worth');
        expect(results(ws)[0]).toMatchObject({
            ok: false,
            error: 'stale_offset: data changed',
        });
    });

    it('caps the activity log at 200 entries', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        for (let i = 0; i < ACTIVITY_MAX + 20; i++) {
            call(t, ws, 'get_net_worth');
            if (i % 25 === 24) await t.clock.advance(MIN + 1);
        }
        const log = JSON.parse(t.storage.data.get(ACTIVITY_KEY));
        expect(log.length).toBe(ACTIVITY_MAX);
    });
});

describe('lifetime: expiry, idle, grace, reload', () => {
    it('ends at its own expiry and refuses a later call', async () => {
        const t = makeHost();
        const { ws } = await connect(t, { lengthMs: 15 * MIN });
        // keep it active so the idle timer does not fire first
        for (let i = 0; i < 3; i++) {
            await t.clock.advance(5 * MIN - 1);
            call(t, ws, 'get_net_worth');
        }
        await t.clock.advance(5000);
        expect(t.host.state).toBe('ended');
        expect(ws.last(FrameType.END).reason).toBe('expired');
        call(t, ws, 'get_net_worth');
        expect(results(ws).length).toBe(3);
    });

    it('ends after 10 idle minutes; a call resets the idle timer', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        await t.clock.advance(9 * MIN);
        call(t, ws, 'get_net_worth');
        await t.clock.advance(9 * MIN);
        expect(t.host.state).toBe('live');
        await t.clock.advance(MIN + 1);
        expect(t.host.state).toBe('ended');
        expect(t.host.endReason).toBe('idle_timeout');
    });

    it('resumes within the 30 s grace and ends after it', async () => {
        const t = makeHost();
        const first = await connect(t);
        first.ws.drop();
        expect(t.host.state).toBe('grace');
        await t.clock.advance(2500);
        const ws2 = t.sockets[1];
        ws2.open();
        expect(ws2.last(FrameType.HELLO).pendingAuth).toBeUndefined();
        await ws2.serverSend({
            v: 1,
            type: 'READY',
            sid: SID,
            expiresAt: t.host.expiresAt,
            idleTimeout: Limits.IDLE_TIMEOUT_MS,
            scope: ['summary'],
        });
        expect(t.host.state).toBe('live');
        await t.clock.advance(Limits.RECONNECT_GRACE_MS * 2);
        expect(t.host.state).toBe('live');

        ws2.drop();
        await t.clock.advance(Limits.RECONNECT_GRACE_MS + 1);
        expect(t.host.state).toBe('ended');
        expect(t.host.endReason).toBe('grace_expired');
        expect(t.host.key).toBeNull();
    });

    it('a reload (pagehide) ends the session and a new host has nothing to resume', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        const listeners = {};
        t.host.attachPageLifecycle({
            addEventListener: (n, f) => (listeners[n] = f),
        });
        listeners.pagehide();
        expect(t.host.state).toBe('ended');
        expect(ws.last(FrameType.END).reason).toBe('page_unload');
        const fresh = makeHost({ storage: t.storage });
        expect(fresh.host.state).toBe('idle');
        expect(fresh.host.key).toBeNull();
        expect(fresh.host.status().scope).toEqual([]);
    });

    it('a relay END ends the session without echoing END back', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        const before = ws.sent.length;
        await ws.serverSend({ v: 1, type: 'END', sid: SID, reason: 'revoked' });
        expect(t.host.state).toBe('ended');
        expect(ws.sent.length).toBe(before);
    });

    it('Disconnect sends END and clears every timer', async () => {
        const t = makeHost();
        const { ws } = await connect(t);
        t.host.end('user_disconnect');
        expect(ws.last(FrameType.END).reason).toBe('user_disconnect');
        expect(t.clock.pending).toBe(0);
    });
});

describe('nothing sensitive reaches storage', () => {
    it('writes only the activity log key, and never the key, scope or pending value', async () => {
        const t = makeHost();
        const { ws } = await connect(t, { scope: ['summary', 'accounts'] });
        call(t, ws, 'get_net_worth');
        expect(new Set(t.storage.writes)).toEqual(new Set([ACTIVITY_KEY]));
        const dump = JSON.stringify([...t.storage.data.entries()]);
        for (const secret of ['pending-value', 'accounts', '"x"', SID]) {
            expect(dump).not.toContain(secret);
        }
    });

    it('the module never touches localStorage, IndexedDB or sessionStorage directly', () => {
        const src = fs.readFileSync(
            new URL('../../app/bridge-host.mjs', import.meta.url),
            'utf8',
        );
        const code = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/);
    });
});

describe('result trimming (design §4)', () => {
    const rows = (n, pad = 40) =>
        Array.from({ length: n }, (_, i) => ({
            id: `t${i}`,
            date: '2026-01-01',
            merchant: 'm'.repeat(pad),
            amount: 1,
            category: `cat${i % 7}`,
        }));
    const base = (transactions, extra = {}) => ({
        transactions,
        count: transactions.length,
        matched: transactions.length,
        total: transactions.length,
        byCategory: { cat0: 1 },
        limit: 1000,
        pagingKey: 'k',
        ...extra,
    });

    it('returns a result that fits unchanged', () => {
        const r = base(rows(3));
        expect(fitResult('get_transactions', r)).toBe(r);
    });

    it('drops rows from the end, sets truncated and nextOffset, keeps totals exact', () => {
        const r = base(rows(3000));
        const out = fitResult('get_transactions', r, 40, 50_000);
        expect(out.transactions.length).toBeGreaterThan(0);
        expect(out.transactions.length).toBeLessThan(3000);
        expect(out.truncated).toBe(true);
        expect(out.nextOffset).toBe(40 + out.transactions.length);
        expect(out.count).toBe(out.transactions.length);
        expect(out.matched).toBe(3000);
        expect(out.total).toBe(3000);
        expect(out.pagingKey).toBe('k');
        expect(JSON.stringify(out).length).toBeLessThanOrEqual(50_000);
    });

    it('bounds byCategory when not even one row fits beside it', () => {
        const byCategory = Object.fromEntries(
            Array.from({ length: 4000 }, (_, i) => [
                `category-${i}-${'x'.repeat(20)}`,
                i + 1,
            ]),
        );
        const r = base(rows(10), { byCategory });
        const out = fitResult('get_transactions', r, 0, 8000);
        expect(out.byCategoryTruncated).toBe(true);
        expect(Object.keys(out.byCategory).length).toBe(50);
        expect(out.otherCategories.count).toBe(3950);
        expect(out.otherCategories.total).toBe(
            Object.values(byCategory)
                .sort((a, b) => b - a)
                .slice(50)
                .reduce((a, b) => a + b, 0),
        );
        expect(out.transactions.length).toBeGreaterThanOrEqual(1);
        expect(out).not.toHaveProperty('byCategory.other');
    });

    it('fails with result_too_large when a single row cannot fit', () => {
        const r = base(rows(2, 100_000));
        expect(() => fitResult('get_transactions', r, 0, 50_000)).toThrow(
            ResultTooLarge,
        );
    });

    it('does not page other tools: too large is an error', () => {
        expect(() =>
            fitResult('get_net_worth', { x: 'y'.repeat(300_000) }),
        ).toThrow(ResultTooLarge);
    });

    it('integrates with the real tool: pages through a big ledger with no gaps', async () => {
        const txns = Array.from({ length: 6000 }, (_, i) => ({
            id: `id-${i}`,
            date: `2026-0${(i % 9) + 1}-1${i % 9}`,
            merchant: `Merchant ${i} ${'z'.repeat(60)}`,
            amount: 5,
            category: `Category ${i % 400}`,
        }));
        const t = makeHost({ handleTool });
        t.state.spendingTransactions = txns;
        const { ws } = await connect(t, { scope: ['transactions'] });
        const seen = new Set();
        let args = { limit: 1000 };
        for (let page = 0; page < 40; page++) {
            call(t, ws, 'get_transactions', { args });
            const res = results(ws).at(-1);
            expect(res.ok).toBe(true);
            expect(JSON.stringify(res).length).toBeLessThanOrEqual(
                Limits.MAX_RESULT_BYTES,
            );
            for (const row of res.content.transactions) seen.add(row.id);
            if (res.content.nextOffset === undefined) break;
            args = {
                limit: 1000,
                offset: res.content.nextOffset,
                pagingKey: res.content.pagingKey,
            };
            await t.clock.advance(3000); // stay under the rate limit
        }
        expect(seen.size).toBe(6000);
    });
});

describe('tab leader election and banner', () => {
    it('only one tab holds the lock until it is released', async () => {
        let held = false;
        const locks = {
            request: (name, opts, cb) => {
                if (held) return cb(null);
                held = true;
                return cb({ name }).finally(() => {
                    held = false;
                });
            },
        };
        const a = await acquireBridgeLock(locks);
        expect(a).toBeTruthy();
        expect(await acquireBridgeLock(locks)).toBeNull();
        a.release();
        await new Promise((r) => setTimeout(r, 5));
        expect(await acquireBridgeLock(locks)).toBeTruthy();
    });

    it('renders the banner with text nodes only, and Disconnect ends the session', async () => {
        const t = makeHost();
        await connect(t);
        t.host.clientName = '<img src=x onerror=alert(1)>';
        const made = [];
        const doc = {
            createElement: (tag) => {
                const el = {
                    tag,
                    children: [],
                    handlers: {},
                    textContent: '',
                    addEventListener(n, f) {
                        this.handlers[n] = f;
                    },
                };
                made.push(el);
                return el;
            },
        };
        const container = {
            textContent: 'old',
            hidden: true,
            append(...c) {
                this.kids = c;
            },
        };
        renderBanner(doc, container, t.host);
        expect(container.hidden).toBe(false);
        const [text, button] = container.kids;
        expect(text.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(made.every((m) => !('innerHTML' in m))).toBe(true);
        expect(text.textContent).toMatch(/\d+ min left · 0 calls/);
        button.handlers.click();
        expect(t.host.state).toBe('ended');
        renderBanner(doc, container, t.host);
        expect(container.hidden).toBe(true);
    });
});
