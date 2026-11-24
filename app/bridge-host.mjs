/**
 * Browser bridge host (#513, design §5.1, §6, §8). The browser is the policy
 * enforcement point: it checks scope, expiry, idle, grace, rate and sequence
 * itself, whatever the relay sends.
 *
 * Everything here lives in tab memory only: the non-extractable session key,
 * the approved scope and the deadlines are never written to localStorage,
 * IndexedDB or any backup, so a reload ends the session. The only thing
 * persisted is the metadata activity log, under its own key.
 *
 * All environment access is injected (WebSocket, clock, storage, locks, the
 * tool function and the state getter), so this module runs under Node tests.
 */
import {
    FrameType,
    Limits,
    buildProveSigningString,
    checkCallDeadline,
    checkCallSeq,
    createEnd,
    createHello,
    createProve,
    createResult,
    validateFrame,
} from './bridge-protocol.mjs';
import { toolsForScope } from './bridge-scope.mjs';

export const LOCK_NAME = 'fire-bridge-host';
export const ACTIVITY_KEY = 'fire_bridge_activity';
export const ACTIVITY_MAX = 200;
export const SESSION_LENGTHS_MS = [15, 30, 60].map((m) => m * 60_000);
const FRAME_OVERHEAD = 2048; // headroom for the RESULT envelope
const MAX_CATEGORIES = 50;
const RECONNECT_RETRY_MS = 2_000;

const enc = new TextEncoder();
const bytesOf = (value) => enc.encode(JSON.stringify(value)).length;

function b64url(buf) {
    let bin = '';
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const sameSet = (a, b) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    new Set(a).size === new Set(b).size &&
    a.every((x) => b.includes(x));

/**
 * Single-leader election across tabs (Web Locks). Resolves to {release} for
 * the tab that holds the bridge, or null when another tab already does.
 */
export function acquireBridgeLock(locks) {
    return new Promise((resolve) => {
        locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
            if (!lock) {
                resolve(null);
                return undefined;
            }
            return new Promise((release) => resolve({ release }));
        });
    });
}

/** Thrown when a result cannot be made to fit the frame cap. */
export class ResultTooLarge extends Error {
    constructor() {
        super('result_too_large');
        this.name = 'ResultTooLarge';
    }
}

/**
 * Keep a tool result under the cap (design §4). Only get_transactions can be
 * paged; every other tool must already fit or fails with result_too_large.
 * Rows are dropped from the end of the page and nextOffset points at the first
 * dropped row; byCategory is bounded only when not even one row fits next to it.
 */
export function fitResult(
    tool,
    result,
    offset = 0,
    cap = Limits.MAX_RESULT_BYTES - FRAME_OVERHEAD,
) {
    if (bytesOf(result) <= cap) return result;
    if (tool !== 'get_transactions' || !Array.isArray(result.transactions)) {
        throw new ResultTooLarge();
    }
    const rows = result.transactions;
    const build = (base, n) => {
        const out = { ...base, transactions: rows.slice(0, n), count: n };
        if (n < rows.length) {
            out.truncated = true;
            out.nextOffset = offset + n;
        }
        return out;
    };
    const largest = (base) => {
        // Binary search the most rows (at least one) that still fit.
        let lo = 0;
        let hi = rows.length;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (bytesOf(build(base, mid)) <= cap) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    };
    let base = result;
    let n = largest(base);
    if (n === 0 && rows.length > 0) {
        const entries = Object.entries(result.byCategory || {}).sort(
            (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
        );
        const rest = entries.slice(MAX_CATEGORIES);
        base = {
            ...result,
            byCategory: Object.fromEntries(entries.slice(0, MAX_CATEGORIES)),
            byCategoryTruncated: true,
            otherCategories: {
                count: rest.length,
                total:
                    Math.round(rest.reduce((s, [, v]) => s + v, 0) * 100) / 100,
            },
        };
        n = largest(base);
        if (n === 0) throw new ResultTooLarge();
    }
    const out = build(base, n);
    if (bytesOf(out) > cap) throw new ResultTooLarge();
    return out;
}

/** Metadata-only activity log: timestamp, tool, bytes, outcome. */
export class ActivityLog {
    constructor(storage) {
        this.storage = storage;
    }
    read() {
        try {
            const v = JSON.parse(this.storage.getItem(ACTIVITY_KEY) || '[]');
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    }
    add(ts, tool, bytes, outcome) {
        try {
            const list = this.read();
            list.push({ ts, tool, bytes, outcome });
            this.storage.setItem(
                ACTIVITY_KEY,
                JSON.stringify(list.slice(-ACTIVITY_MAX)),
            );
        } catch {
            /* storage unavailable: the log is best effort */
        }
    }
}

export class BridgeHost {
    /**
     * @param {object} deps
     * @param {(url: string) => WebSocket} deps.createSocket
     * @param {string} deps.relayUrl wss origin of the relay
     * @param {() => object} deps.getState current fire state, read per call
     * @param {(name: string, state: object, args: object) => object} deps.handleTool
     * @param {{getItem, setItem}} [deps.storage] for the activity log only
     * @param {object} [deps.clock] now / setTimeout / clearTimeout
     * @param {SubtleCrypto} [deps.subtle]
     */
    constructor({
        createSocket,
        relayUrl,
        getState,
        handleTool,
        storage,
        clock,
        subtle = globalThis.crypto.subtle,
        onChange = () => {},
    }) {
        this.createSocket = createSocket;
        this.relayUrl = relayUrl.replace(/\/$/, '');
        this.getState = getState;
        this.handleTool = handleTool;
        this.log = new ActivityLog(
            storage || { getItem: () => null, setItem: () => {} },
        );
        this.clock = clock || {
            now: () => Date.now(),
            setTimeout: (f, ms) => setTimeout(f, ms),
            clearTimeout: (h) => clearTimeout(h),
        };
        this.subtle = subtle;
        this.onChange = onChange;
        this.state = 'idle'; // idle | connecting | live | grace | ended
        this._gen = 0; // bumps on end(), so a pending start() can tell it was cancelled
        this._reset();
    }

    _reset() {
        this.sid = null;
        this.key = null; // CryptoKey, non-extractable
        this.pub = null;
        this.scope = null;
        this.allowed = new Set();
        this.expiresAt = 0;
        this.lastActivity = 0;
        this.lastSeq = 0;
        this.answered = new Set();
        this.callTimes = [];
        this.callCount = 0;
        this.clientName = '';
        this.pendingAuth = null;
        this.socket = null;
        this.timers = {};
        this.droppedAt = 0;
        this.bound = false; // true once the relay answered READY
    }

    /** Begin a session the user just approved on the consent page. */
    async start({ sid, pendingAuth, scope, lengthMs, clientName = '' }) {
        if (this.state !== 'idle' && this.state !== 'ended') {
            throw new Error('a session is already active');
        }
        if (!SESSION_LENGTHS_MS.includes(lengthMs)) {
            throw new Error('session length must be 15, 30 or 60 minutes');
        }
        if (!Array.isArray(scope) || scope.length === 0) {
            throw new Error('scope is required');
        }
        this._reset();
        // Claim the session before the first await, so end() (a reload or
        // Disconnect during key generation) cancels this start.
        this.state = 'connecting';
        const gen = ++this._gen;
        let keys;
        let jwk;
        try {
            keys = await this.subtle.generateKey(
                { name: 'ECDSA', namedCurve: 'P-256' },
                false, // the private key can never be exported
                ['sign', 'verify'],
            );
            if (gen !== this._gen) return;
            jwk = await this.subtle.exportKey('jwk', keys.publicKey);
        } catch (err) {
            if (gen === this._gen) this.end('crypto_failed', false);
            throw err;
        }
        if (gen !== this._gen) return;
        this.key = keys.privateKey;
        this.pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
        this.sid = sid;
        this.pendingAuth = pendingAuth;
        this.scope = [...new Set(scope)];
        this.allowed = toolsForScope(this.scope);
        this.clientName = clientName;
        // Our own deadline: never taken from the relay.
        this.expiresAt = this.clock.now() + lengthMs;
        this.lastActivity = this.clock.now();
        this.timers.expiry = this.clock.setTimeout(
            () => this.end('expired'),
            lengthMs,
        );
        this._armIdle();
        this._open(true);
        this.onChange();
    }

    _open(first) {
        const ws = this.createSocket(`${this.relayUrl}/bridge/${this.sid}`);
        this.socket = ws;
        ws.addEventListener('open', () => {
            if (this.socket !== ws) return;
            const hello = createHello(
                this.pub,
                first ? this.pendingAuth : undefined,
                first ? this.scope : undefined,
                first ? this.expiresAt : undefined,
            );
            hello.sid = this.sid;
            this._send(hello);
        });
        ws.addEventListener('message', (ev) => {
            if (this.socket === ws) this._onMessage(ev.data);
        });
        const closed = () => {
            if (this.socket === ws) this._onClose();
        };
        ws.addEventListener('close', closed);
        ws.addEventListener('error', closed);
    }

    _send(frame) {
        try {
            this.socket.send(JSON.stringify(frame));
        } catch {
            /* a dead socket surfaces through its close event */
        }
    }

    _onClose() {
        if (this.state === 'ended') return;
        this.socket = null;
        if (this.state === 'live' || this.state === 'connecting') {
            this.state = 'grace';
            this.droppedAt = this.clock.now();
            this.timers.grace = this.clock.setTimeout(
                () => this.end('grace_expired'),
                Limits.RECONNECT_GRACE_MS,
            );
        }
        if (this.state === 'grace') {
            this.timers.retry = this.clock.setTimeout(() => {
                // Until the relay has bound the session, retry with the
                // first-open credentials; afterwards use the reconnect form.
                if (this.state === 'grace' || this.state === 'connecting') {
                    this._open(!this.bound);
                }
            }, RECONNECT_RETRY_MS);
        }
        this.onChange();
    }

    async _onMessage(data) {
        let frame;
        try {
            frame = JSON.parse(data);
        } catch {
            return;
        }
        if (!frame || typeof frame !== 'object') return;
        if (frame.type === 'PING') return; // relay keepalive, nothing to do
        if (!validateFrame(frame).ok || frame.sid !== this.sid) return;
        switch (frame.type) {
            case FrameType.CHALLENGE:
                return this._onChallenge(frame);
            case FrameType.READY:
                return this._onReady(frame);
            case FrameType.CALL:
                return this._onCall(frame);
            case FrameType.END:
                return this.end('relay_end', false);
            default:
        }
    }

    async _onChallenge(frame) {
        if (this.state === 'ended' || !(frame.exp > this.clock.now())) return;
        const gen = this._gen;
        const ws = this.socket;
        // The session may end (and another start) while signing is pending.
        const current = () => gen === this._gen && ws === this.socket;
        try {
            const message = enc.encode(
                buildProveSigningString(
                    this.relayUrl.replace(/^wss:/, 'https:'),
                    this.sid,
                    frame.nonce,
                    this.scope,
                    this.expiresAt,
                ),
            );
            const sig = await this.subtle.sign(
                { name: 'ECDSA', hash: 'SHA-256' },
                this.key,
                message,
            );
            if (!current()) return;
            this._send(createProve(this.sid, b64url(sig)));
        } catch {
            if (current()) this.end('sign_failed');
        }
    }

    _onReady(frame) {
        // READY is informational: any disagreement with our own policy ends it.
        if (
            frame.expiresAt !== this.expiresAt ||
            frame.idleTimeout !== Limits.IDLE_TIMEOUT_MS ||
            !sameSet(frame.scope, this.scope)
        ) {
            this.end('ready_mismatch');
            return;
        }
        // Our own grace deadline: a late READY does not revive the session,
        // even if its timer has not run yet.
        if (
            this.state === 'grace' &&
            this.clock.now() - this.droppedAt >= Limits.RECONNECT_GRACE_MS
        ) {
            this.end('grace_expired');
            return;
        }
        this.clock.clearTimeout(this.timers.grace);
        this.clock.clearTimeout(this.timers.retry);
        this.bound = true;
        this.state = 'live';
        this.onChange();
    }

    _armIdle() {
        this.clock.clearTimeout(this.timers.idle);
        this.timers.idle = this.clock.setTimeout(
            () => this.end('idle_timeout'),
            Limits.IDLE_TIMEOUT_MS,
        );
    }

    _outcome(frame, outcome, bytes = 0) {
        this.log.add(
            this.clock.now(),
            String(frame.tool).slice(0, 64),
            bytes,
            outcome,
        );
        this.onChange();
    }

    _reply(frame, ok, payload, outcome) {
        const result = createResult(this.sid, frame.id, ok, payload);
        this._send(result);
        this._outcome(frame, outcome, bytesOf(result));
    }

    _onCall(frame) {
        const now = this.clock.now();
        // Anything outside our own policy is dropped, whatever the relay says.
        if (this.state !== 'live' || now >= this.expiresAt) return;
        if (now - this.lastActivity >= Limits.IDLE_TIMEOUT_MS) {
            this.end('idle_timeout');
            return;
        }
        if (!checkCallSeq(frame, this.lastSeq).ok)
            return this._outcome(frame, 'rejected_seq');
        if (!checkCallDeadline(frame, now).ok)
            return this._outcome(frame, 'rejected_deadline');
        if (this.answered.has(frame.id)) return;
        this.lastSeq = frame.seq;
        this.answered.add(frame.id);
        this.lastActivity = now;
        this._armIdle();
        if (!this.allowed.has(frame.tool)) {
            return this._reply(frame, false, 'not_in_scope', 'denied_scope');
        }
        this.callTimes = this.callTimes.filter((t) => now - t < 60_000);
        if (this.callTimes.length >= Limits.RATE_LIMIT_CALLS_PER_MIN) {
            return this._reply(frame, false, 'rate_limited', 'rate_limited');
        }
        this.callTimes.push(now);
        this.callCount += 1;
        try {
            let args = frame.args || {};
            if (frame.tool === 'get_transactions') {
                // Always page, so a trimmed answer carries nextOffset/pagingKey.
                args = { ...args, offset: args.offset ?? 0 };
            }
            const raw = this.handleTool(frame.tool, this.getState(), args);
            const content = fitResult(frame.tool, raw, args.offset ?? 0);
            this._reply(frame, true, content, 'ok');
        } catch (err) {
            if (err instanceof ResultTooLarge) {
                return this._reply(
                    frame,
                    false,
                    'result_too_large',
                    'result_too_large',
                );
            }
            const msg = String((err && err.message) || 'error').slice(0, 300);
            this._reply(frame, false, msg, 'error');
        }
    }

    /** End the session: delete the key and policy, tell the relay if we can. */
    end(reason = 'user_disconnect', notify = true) {
        if (this.state === 'ended' || this.state === 'idle') return;
        if (notify && this.socket) this._send(createEnd(this.sid, reason));
        try {
            this.socket && this.socket.close(1000, 'ended');
        } catch {
            /* already closed */
        }
        for (const h of Object.values(this.timers)) this.clock.clearTimeout(h);
        this._gen += 1;
        this.state = 'ended';
        this.endReason = reason;
        this._reset();
        this.onChange();
    }

    /** A reload or navigation away ends the session (nothing is restored). */
    attachPageLifecycle(win) {
        win.addEventListener('pagehide', () => this.end('page_unload'));
    }

    /** Snapshot for the "Connected agent" banner. */
    status() {
        const live = this.state === 'live' || this.state === 'grace';
        return {
            state: this.state,
            clientName: live ? this.clientName : '',
            msLeft: live ? Math.max(0, this.expiresAt - this.clock.now()) : 0,
            calls: this.callCount,
            scope: live ? [...this.scope] : [],
        };
    }
}

/**
 * Render the "Connected agent" banner with text nodes only (no innerHTML), so
 * a hostile client name cannot inject markup.
 */
export function renderBanner(doc, container, host) {
    const s = host.status();
    container.textContent = '';
    if (s.state === 'idle' || s.state === 'ended') {
        container.hidden = true;
        return;
    }
    container.hidden = false;
    const text = doc.createElement('span');
    const minutes = Math.ceil(s.msLeft / 60_000);
    text.textContent = `Connected agent: ${s.clientName || 'unnamed client'} · ${minutes} min left · ${s.calls} calls`;
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = 'Disconnect';
    button.addEventListener('click', () => host.end('user_disconnect'));
    container.append(text, button);
}
