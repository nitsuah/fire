/**
 * Relay session core (#510, design §3, §4, §6). Memory only.
 *
 * One BridgeSession holds one browser WebSocket and its in-flight calls. It is
 * host-agnostic: the clock, the pending-authorization verifier and the log sink
 * are injected, and sockets are tiny `{ send, close, ping? }` objects, so the
 * Durable Object adapter stays thin and this file runs under a fake clock.
 *
 * Rules this module keeps (and tests enforce):
 *   - no storage of any kind, no payloads/tokens/session ids in logs;
 *   - deny by default: anything unexpected closes the socket or ends the
 *     session, and an unknown sid on reconnect fails closed;
 *   - the browser's key must sign the approved scope and expiry (PROVE).
 */
import {
    FrameType,
    Limits,
    checkChallengeFresh,
    checkResultSize,
    createCall,
    createChallenge,
    createEnd,
    createReady,
    generateId,
    generateNonce,
    validateEnd,
    validateHello,
    validateProve,
    validateResult,
    verifyProve,
} from '../app/bridge-protocol.mjs';

export const PING_INTERVAL_MS = 20_000;
// Wire-size cap for any frame the browser sends (RESULT is capped tighter).
const MAX_INBOUND_BYTES = Limits.MAX_RESULT_BYTES + 4096;
const MAX_PENDING_SOCKETS = 4;
const SID_PATTERN = /^[0-9a-f]{32}$/;

// The only strings that may reach the log sink: coarse events, no data.
const LOG_EVENTS = new Set([
    'session_opened',
    'session_ended',
    'socket_rejected',
    'call_sent',
    'call_timeout',
    'call_dropped',
]);

export class SessionError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SessionError';
        this.code = code;
    }
}

const realClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h),
};

function sameKey(a, b) {
    return !!a && !!b && a.x === b.x && a.y === b.y;
}

export class BridgeSession {
    /**
     * @param {object} opts
     * @param {string} opts.sid 32-hex session id (also the DO name)
     * @param {string} opts.relayOrigin signed into PROVE
     * @param {(pendingAuth: string) => Promise<{requestedScope: string[]}|null>} [opts.verifyPendingAuth]
     *   verifies the signed pending authorization; absent means deny.
     * @param {(event: string) => void} [opts.log] coarse events only
     * @param {(reason: string) => void} [opts.onEnd]
     */
    constructor({
        sid,
        relayOrigin,
        verifyPendingAuth = async () => null,
        log = () => {},
        onEnd = () => {},
        clock = realClock,
    }) {
        if (!SID_PATTERN.test(sid)) throw new TypeError('invalid sid');
        this.sid = sid;
        this.relayOrigin = relayOrigin;
        this.verifyPendingAuth = verifyPendingAuth;
        this._log = log;
        this._onEnd = onEnd;
        this.clock = clock;

        this.status = 'new'; // new | live | grace | ended
        this.pub = null;
        this.scope = null;
        this.expiresAt = 0;
        this.lastActivity = 0;
        this.seq = 0;
        this._graceDeadline = 0;

        this._sockets = new Map(); // socket -> per-socket handshake state
        this._live = null;
        this._pending = new Map(); // call id -> { resolve, reject, timer }
        this._waiting = []; // calls queued during the reconnect grace
        this._timers = {};
        this._callTimes = []; // start times of calls in the last minute
        this._tokenHashes = new Set(); // SHA-256 hex of live access tokens
        this.pending = null; // verified pending authorization (OAuth binding)
        this.pendingAuth = null; // its raw signed value
        this.authCompleted = false;
        this.codes = new Map(); // SHA-256 hex of authorization code -> {exp}
    }

    /** Register the hash of an access token the OAuth layer just minted. */
    addTokenHash(hashHex) {
        if (this.status === 'ended') return false;
        this._tokenHashes.add(hashHex);
        return true;
    }

    /** True while the token is one of this session's and the session is up. */
    async verifyToken(token) {
        if (this.status === 'ended' || this.status === 'new') return false;
        if (typeof token !== 'string' || token.length > 512) return false;
        const hash = await sha256Hex(token);
        let match = false;
        // Compare against every hash without an early exit.
        for (const known of this._tokenHashes) {
            if (constantTimeEqual(known, hash)) match = true;
        }
        return match && this.status !== 'ended';
    }

    log(event) {
        if (LOG_EVENTS.has(event)) this._log(event);
    }

    /** Register a freshly accepted socket. Messages go to handleMessage. */
    attach(socket) {
        if (this.status === 'ended') {
            this._reject(socket, 'session_ended');
            return;
        }
        if (this._sockets.size >= MAX_PENDING_SOCKETS) {
            this._reject(socket, 'too_many_sockets');
            return;
        }
        const state = { stage: 'hello', queue: Promise.resolve() };
        // An unauthenticated socket gets the nonce window to finish PROVE.
        state.timer = this.clock.setTimeout(
            () => this._dropSocket(socket, 'handshake_timeout'),
            Limits.NONCE_EXPIRY_MS,
        );
        this._sockets.set(socket, state);
    }

    handleMessage(socket, data) {
        const state = this._sockets.get(socket);
        if (!state) return Promise.resolve();
        // Serialize per socket: PROVE verification is async.
        state.queue = state.queue.then(() =>
            this._process(socket, state, data),
        );
        return state.queue;
    }

    handleClose(socket) {
        const state = this._sockets.get(socket);
        if (!state) return;
        this._sockets.delete(socket);
        this.clock.clearTimeout(state.timer);
        if (this._live === socket) {
            this._live = null;
            this._clearTimer('ping');
            if (this.status === 'live') this._enterGrace();
        }
    }

    /** One tool call. Resolves to {ok, content|error}; rejects SessionError. */
    dispatchCall(tool, args = {}) {
        if (this.status === 'ended' || this.status === 'new') {
            return Promise.reject(new SessionError('invalid_token'));
        }
        const now = this.clock.now();
        // 4 in flight and 30 calls per minute, enforced here so no caller can
        // skip them. The browser applies its own limits as well.
        this._callTimes = this._callTimes.filter((t) => now - t < 60_000);
        if (
            this._pending.size >= Limits.MAX_CALLS_IN_FLIGHT ||
            this._callTimes.length >= Limits.RATE_LIMIT_CALLS_PER_MIN
        ) {
            return Promise.reject(new SessionError('rate_limited'));
        }
        this._callTimes.push(now);
        const deadline = Math.min(
            now + Limits.CALL_DEADLINE_MS,
            this.expiresAt,
        );
        return new Promise((resolve, reject) => {
            const id = generateId();
            const entry = {
                resolve,
                reject,
                tool,
                args,
                deadline,
                sent: false,
            };
            entry.timer = this.clock.setTimeout(
                () => {
                    if (this._pending.delete(id)) {
                        this._waiting = this._waiting.filter(
                            (w) => w.id !== id,
                        );
                        this.log('call_timeout');
                        reject(new SessionError('timeout'));
                    }
                },
                Math.max(0, deadline - now),
            );
            entry.id = id;
            this._pending.set(id, entry);
            this.touch();
            if (this.status === 'live') this._sendCall(entry);
            else this._waiting.push(entry); // grace: wait for the reconnect
        });
    }

    get inFlight() {
        return this._pending.size;
    }

    /** Activity resets the idle timer. */
    touch() {
        this.lastActivity = this.clock.now();
        this._clearTimer('idle');
        if (this.status === 'ended') return;
        this._timers.idle = this.clock.setTimeout(
            () => this.end('idle_timeout'),
            Limits.IDLE_TIMEOUT_MS,
        );
    }

    end(reason = 'ended') {
        if (this.status === 'ended') return;
        this.status = 'ended';
        for (const [socket, state] of this._sockets) {
            this.clock.clearTimeout(state.timer);
            this._send(socket, createEnd(this.sid, reason));
            this._safeClose(socket, 1000, 'ended');
        }
        this._sockets.clear();
        this._live = null;
        for (const name of Object.keys(this._timers)) this._clearTimer(name);
        for (const entry of this._pending.values()) {
            this.clock.clearTimeout(entry.timer);
            entry.reject(new SessionError('invalid_token'));
        }
        this._pending.clear();
        this._waiting = [];
        // The key and policy go with the session: nothing to resume.
        this.pub = null;
        this.scope = null;
        this._tokenHashes.clear();
        this.codes.clear();
        this.pending = null;
        this.pendingAuth = null;
        this.log('session_ended');
        this._onEnd(reason);
    }

    // ---- internals -------------------------------------------------------

    async _process(socket, state, data) {
        if (this.status === 'ended' || !this._sockets.has(socket)) return;
        if (
            typeof data !== 'string' ||
            data.length > MAX_INBOUND_BYTES ||
            new TextEncoder().encode(data).length > MAX_INBOUND_BYTES
        ) {
            if (state.stage === 'live' && this._failOversizeResult(data)) {
                return;
            }
            this._dropSocket(socket, 'bad_frame');
            return;
        }
        let frame;
        try {
            frame = JSON.parse(data);
        } catch {
            this._dropSocket(socket, 'bad_frame');
            return;
        }
        if (!frame || frame.sid !== this.sid) {
            this._dropSocket(socket, 'bad_sid');
            return;
        }
        switch (state.stage) {
            case 'hello':
                return this._onHello(socket, state, frame);
            case 'challenged':
                return this._onProve(socket, state, frame);
            case 'live':
                return this._onLive(socket, frame);
            default:
                this._dropSocket(socket, 'bad_state');
        }
    }

    /**
     * An oversize RESULT is too big to parse, but the call it answers should
     * still fail as result_too_large, not time out. The id sits at the front
     * of a RESULT frame, so read it from the first bytes.
     */
    _failOversizeResult(data) {
        if (typeof data !== 'string') return false;
        const head = data.slice(0, 512);
        const m = /"type":"RESULT"[^]*?"id":"([0-9a-f]{32})"/.exec(head);
        const entry = m && this._pending.get(m[1]);
        if (!entry || !entry.sent) return false;
        this._pending.delete(m[1]);
        this.clock.clearTimeout(entry.timer);
        entry.reject(new SessionError('result_too_large'));
        return true;
    }

    async _onHello(socket, state, frame) {
        if (frame.type !== FrameType.HELLO || !validateHello(frame).ok) {
            this._dropSocket(socket, 'bad_hello');
            return;
        }
        if (this.status === 'new') {
            const candidate = await this._checkFirstHello(frame);
            // The socket may have closed, or the session ended, while the
            // authorization was being verified.
            if (
                this.status === 'ended' ||
                this._sockets.get(socket) !== state
            ) {
                return;
            }
            if (!candidate) {
                this._dropSocket(socket, 'invalid_hello');
                return;
            }
            state.candidate = candidate;
        } else {
            // Reconnect: same key, and no new policy. Fail closed otherwise
            // (an unknown sid lands in status 'new' and is refused above).
            if (
                frame.pendingAuth !== undefined ||
                !sameKey(frame.pub, this.pub) ||
                (frame.scope !== undefined &&
                    !sameSet(frame.scope, this.scope)) ||
                (frame.expiresAt !== undefined &&
                    frame.expiresAt !== this.expiresAt)
            ) {
                this._dropSocket(socket, 'invalid_hello');
                return;
            }
            state.candidate = null;
        }
        // The HELLO has to carry pendingAuth on a first open; a HELLO that
        // reaches a session with no state and no pendingAuth fails above.
        state.nonce = generateNonce();
        state.stage = 'challenged';
        this.clock.clearTimeout(state.timer);
        const exp = this.clock.now() + Limits.NONCE_EXPIRY_MS;
        state.exp = exp;
        state.timer = this.clock.setTimeout(
            () => this._dropSocket(socket, 'challenge_expired'),
            Limits.NONCE_EXPIRY_MS,
        );
        this._send(socket, createChallenge(this.sid, state.nonce, exp));
    }

    async _checkFirstHello(frame) {
        const { pendingAuth, scope, expiresAt } = frame;
        if (
            typeof pendingAuth !== 'string' ||
            !Array.isArray(scope) ||
            scope.length === 0 ||
            !Number.isInteger(expiresAt)
        ) {
            return null;
        }
        let verified;
        try {
            verified = await this.verifyPendingAuth(pendingAuth);
        } catch {
            return null;
        }
        const requested = verified && verified.requestedScope;
        if (!Array.isArray(requested)) return null;
        // Unique entries only, so the scope the browser signed is the scope
        // that is stored.
        const approved = [...new Set(scope)];
        if (approved.length !== scope.length) return null;
        if (!approved.every((s) => requested.includes(s))) return null;
        const now = this.clock.now();
        if (expiresAt <= now || expiresAt > now + Limits.SESSION_MAX_MS) {
            return null;
        }
        return {
            pub: frame.pub,
            scope: approved,
            expiresAt,
            pending: verified.pending ?? null,
            pendingAuth,
        };
    }

    async _onProve(socket, state, frame) {
        const nonce = state.nonce;
        state.nonce = null; // single use, whatever the outcome
        if (
            frame.type !== FrameType.PROVE ||
            !validateProve(frame).ok ||
            !nonce ||
            !checkChallengeFresh({ exp: state.exp }, this.clock.now()).ok
        ) {
            this._dropSocket(socket, 'bad_proof');
            return;
        }
        const first = state.candidate;
        const pub = first ? first.pub : this.pub;
        const scope = first ? first.scope : this.scope;
        const expiresAt = first ? first.expiresAt : this.expiresAt;
        const ok = await verifyProve(frame.sig, pub, {
            relayOrigin: this.relayOrigin,
            sid: this.sid,
            nonce,
            scope,
            expiresAt,
        });
        // State may have moved while verifying (ended, or another socket won).
        if (!ok || this.status === 'ended' || !this._sockets.has(socket)) {
            this._dropSocket(socket, 'bad_proof');
            return;
        }
        const now = this.clock.now();
        if (
            (first && this.status !== 'new') ||
            expiresAt <= now ||
            (this.status === 'grace' && now >= this._graceDeadline)
        ) {
            this._dropSocket(socket, 'bad_proof');
            return;
        }
        if (first) {
            this.pub = pub;
            this.scope = scope;
            this.pending = first.pending;
            this.pendingAuth = first.pendingAuth;
            this.expiresAt = expiresAt;
            this._timers.hard = this.clock.setTimeout(
                () => this.end('expired'),
                Math.max(0, expiresAt - this.clock.now()),
            );
            this.touch();
            this.log('session_opened');
        }
        this._clearTimer('grace');
        this.clock.clearTimeout(state.timer);
        state.stage = 'live';
        const previous = this._live;
        this._live = socket;
        this.status = 'live';
        if (previous && previous !== socket) {
            this._sockets.delete(previous);
            this._send(previous, createEnd(this.sid, 'replaced'));
            this._safeClose(previous, 1000, 'replaced');
        }
        this._send(
            socket,
            createReady(this.sid, this.expiresAt, Limits.IDLE_TIMEOUT_MS, [
                ...this.scope,
            ]),
        );
        this._clearTimer('ping');
        this._timers.ping = this.clock.setInterval(() => {
            if (this._live && typeof this._live.ping === 'function') {
                try {
                    this._live.ping();
                } catch {
                    /* a dead socket surfaces through its close event */
                }
            }
        }, PING_INTERVAL_MS);
        const queued = this._waiting;
        this._waiting = [];
        for (const entry of queued) this._sendCall(entry);
    }

    _onLive(socket, frame) {
        if (frame.type === FrameType.RESULT) {
            this._onResult(frame);
        } else if (frame.type === FrameType.END && validateEnd(frame).ok) {
            this.end('browser_end');
        } else {
            this._dropSocket(socket, 'protocol_error');
        }
    }

    _onResult(frame) {
        // Late, duplicate or unknown ids are dropped without a trace of data.
        const entry = validateResult(frame).ok
            ? this._pending.get(frame.id)
            : null;
        if (!entry || !entry.sent) {
            this.log('call_dropped');
            return;
        }
        this._pending.delete(frame.id);
        this.clock.clearTimeout(entry.timer);
        if (this.clock.now() >= entry.deadline) {
            // Late: the deadline passed even if its timer has not run yet.
            this.log('call_timeout');
            entry.reject(new SessionError('timeout'));
            return;
        }
        if (!checkResultSize(frame).ok) {
            entry.reject(new SessionError('result_too_large'));
            return;
        }
        this.touch();
        entry.resolve(
            frame.ok
                ? { ok: true, content: frame.content }
                : { ok: false, error: frame.error },
        );
    }

    _sendCall(entry) {
        this.seq += 1;
        entry.sent = true;
        this._send(
            this._live,
            createCall(
                this.sid,
                this.seq,
                entry.id,
                entry.deadline,
                entry.tool,
                entry.args,
            ),
        );
        this.log('call_sent');
    }

    _enterGrace() {
        this.status = 'grace';
        this._graceDeadline = this.clock.now() + Limits.RECONNECT_GRACE_MS;
        this._timers.grace = this.clock.setTimeout(
            () => this.end('grace_expired'),
            Limits.RECONNECT_GRACE_MS,
        );
        // Calls already sent can no longer be answered by a new socket's
        // relay-side bookkeeping if the browser lost them: keep them until
        // their own deadline, which is at most CALL_DEADLINE_MS away.
    }

    _dropSocket(socket, reason) {
        const state = this._sockets.get(socket);
        if (state) this.clock.clearTimeout(state.timer);
        this._sockets.delete(socket);
        this.log('socket_rejected');
        this._send(socket, createEnd(this.sid, reason));
        this._safeClose(socket, 1008, reason);
        if (this._live === socket) {
            this._live = null;
            this._clearTimer('ping');
            if (this.status === 'live') this._enterGrace();
        }
    }

    _reject(socket, reason) {
        this.log('socket_rejected');
        this._send(socket, createEnd(this.sid, reason));
        this._safeClose(socket, 1008, reason);
    }

    _send(socket, frame) {
        if (!socket) return;
        try {
            socket.send(JSON.stringify(frame));
        } catch {
            /* closed sockets are cleaned up by their close event */
        }
    }

    _safeClose(socket, code, reason) {
        try {
            socket.close(code, reason);
        } catch {
            /* already closed */
        }
    }

    _clearTimer(name) {
        const h = this._timers[name];
        if (h === undefined) return;
        if (name === 'ping') this.clock.clearInterval(h);
        else this.clock.clearTimeout(h);
        delete this._timers[name];
    }
}

export async function sha256Hex(text) {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
    ).join('');
}

/** Strings compared without an early exit on the first difference. */
export function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    let diff = a.length ^ b.length;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
}

function sameSet(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    const sa = new Set(a);
    const sb = new Set(b);
    return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}
