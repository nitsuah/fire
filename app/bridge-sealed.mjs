/**
 * Sealed mode for the hosted MCP browser bridge (design §5.3, §7; #517).
 *
 * The browser shows a pairing string (its ephemeral ECDH P-256 public key, a
 * session id and a 128-bit secret). The user pastes it into the local
 * `fire-bridge` shim, which sends its own ephemeral public key through the
 * relay. Both sides compute
 *   HKDF-SHA256(ECDH(shared) || secret, info = "fire-bridge/v1/sealed" || 0x00 || sid)
 * into two directional AES-256-GCM keys. The secret travels out of band, so a
 * relay that swaps public keys cannot derive them. Requests and results are
 * AES-GCM ciphertext with a counter nonce and AAD = sid | direction | seq.
 *
 * Pure WebCrypto: the same file runs in the browser and in Node 22. No
 * storage, no network, no logging.
 */
/* global TextEncoder, TextDecoder, btoa, atob */
import { fitResult, ResultTooLarge } from './bridge-host.mjs';

export const SEALED_VERSION = 1;
export const PAIRING_PREFIX = 'fireb1.';
const INFO_LABEL = 'fire-bridge/v1/sealed';
const SECRET_BYTES = 16;
const SID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const DIR_CLIENT_TO_BROWSER = 'c2b';
export const DIR_BROWSER_TO_CLIENT = 'b2c';
const MAX_SEQ = Number.MAX_SAFE_INTEGER;
const MAX_ENVELOPE_CT_CHARS = 400 * 1024;

export class SealedError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SealedError';
        this.code = code;
    }
}

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64uEncode(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) {
        throw new SealedError('bad_encoding');
    }
    const pad = '='.repeat((4 - (str.length % 4)) % 4);
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const ecdhKeyPair = () =>
    subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
        'deriveBits',
    ]);

async function exportRaw(publicKey) {
    return new Uint8Array(await subtle().exportKey('raw', publicKey));
}

async function importPeer(raw) {
    // importKey rejects points that are not on the curve.
    if (!(raw instanceof Uint8Array) || raw.length !== 65 || raw[0] !== 4) {
        throw new SealedError('bad_public_key');
    }
    try {
        return await subtle().importKey(
            'raw',
            raw,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            [],
        );
    } catch {
        throw new SealedError('bad_public_key');
    }
}

async function deriveKeys(privateKey, peerPublic, secret, sid) {
    const shared = new Uint8Array(
        await subtle().deriveBits(
            { name: 'ECDH', public: peerPublic },
            privateKey,
            256,
        ),
    );
    const ikm = new Uint8Array(shared.length + secret.length);
    ikm.set(shared, 0);
    ikm.set(secret, shared.length);
    const base = await subtle().importKey('raw', ikm, 'HKDF', false, [
        'deriveBits',
    ]);
    const bits = new Uint8Array(
        await subtle().deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: new Uint8Array(32),
                info: enc.encode(`${INFO_LABEL}\u0000${sid}`),
            },
            base,
            512,
        ),
    );
    const key = (slice) =>
        subtle().importKey('raw', slice, { name: 'AES-GCM' }, false, [
            'encrypt',
            'decrypt',
        ]);
    return {
        c2b: await key(bits.slice(0, 32)),
        b2c: await key(bits.slice(32, 64)),
    };
}

const nonceFor = (seq) => {
    // 96-bit nonce: 4 zero bytes, then the 64-bit big-endian counter. Each
    // direction has its own key, so a counter value is never reused under a key.
    const n = new Uint8Array(12);
    new DataView(n.buffer).setBigUint64(4, BigInt(seq));
    return n;
};

const aadFor = (sid, dir, seq) => enc.encode(`${sid}|${dir}|${seq}`);

/** One end of an established sealed channel. */
export class SealedChannel {
    constructor({ sid, role, keys }) {
        this.sid = sid;
        this.sendDir =
            role === 'browser' ? DIR_BROWSER_TO_CLIENT : DIR_CLIENT_TO_BROWSER;
        this.recvDir =
            role === 'browser' ? DIR_CLIENT_TO_BROWSER : DIR_BROWSER_TO_CLIENT;
        this.sendKey = role === 'browser' ? keys.b2c : keys.c2b;
        this.recvKey = role === 'browser' ? keys.c2b : keys.b2c;
        this.sendSeq = 0;
        this.recvSeq = 0;
    }

    /** Encrypt a JSON value into an envelope. */
    async seal(value) {
        if (this.sendSeq >= MAX_SEQ) throw new SealedError('seq_exhausted');
        const seq = this.sendSeq + 1;
        const ct = new Uint8Array(
            await subtle().encrypt(
                {
                    name: 'AES-GCM',
                    iv: nonceFor(seq),
                    additionalData: aadFor(this.sid, this.sendDir, seq),
                },
                this.sendKey,
                enc.encode(JSON.stringify(value)),
            ),
        );
        this.sendSeq = seq;
        return {
            v: SEALED_VERSION,
            sid: this.sid,
            dir: this.sendDir,
            seq,
            ct: b64uEncode(ct),
        };
    }

    /**
     * Decrypt an envelope. Rejects a wrong version, session, direction or a
     * counter that does not increase (replay or reorder) before touching the
     * ciphertext, and a forged or altered one at the GCM tag. The counter only
     * advances after the tag verifies, so garbage cannot burn it.
     */
    async open(envelope) {
        const e = envelope;
        if (
            !e ||
            typeof e !== 'object' ||
            e.v !== SEALED_VERSION ||
            e.sid !== this.sid ||
            e.dir !== this.recvDir ||
            !Number.isSafeInteger(e.seq) ||
            e.seq < 1 ||
            typeof e.ct !== 'string' ||
            e.ct.length > MAX_ENVELOPE_CT_CHARS
        ) {
            throw new SealedError('bad_envelope');
        }
        if (e.seq <= this.recvSeq) throw new SealedError('replay');
        let plain;
        try {
            plain = await subtle().decrypt(
                {
                    name: 'AES-GCM',
                    iv: nonceFor(e.seq),
                    additionalData: aadFor(this.sid, this.recvDir, e.seq),
                },
                this.recvKey,
                b64uDecode(e.ct),
            );
        } catch {
            throw new SealedError('auth_failed');
        }
        this.recvSeq = e.seq;
        try {
            return JSON.parse(dec.decode(plain));
        } catch {
            throw new SealedError('bad_payload');
        }
    }
}

/**
 * Browser side, step 1: make the pairing string to show the user. Keep the
 * returned `pending` in tab memory only; it is consumed by `completePairing`.
 */
export async function createPairing(sid) {
    if (!SID_RE.test(sid || '')) throw new SealedError('bad_sid');
    const pair = await ecdhKeyPair();
    const secret = globalThis.crypto.getRandomValues(
        new Uint8Array(SECRET_BYTES),
    );
    const pub = await exportRaw(pair.publicKey);
    const body = JSON.stringify({
        v: SEALED_VERSION,
        sid,
        pub: b64uEncode(pub),
        secret: b64uEncode(secret),
    });
    return {
        pairing: PAIRING_PREFIX + b64uEncode(enc.encode(body)),
        pending: { sid, privateKey: pair.privateKey, secret, used: false },
    };
}

function parsePairing(pairing) {
    if (typeof pairing !== 'string' || !pairing.startsWith(PAIRING_PREFIX)) {
        throw new SealedError('bad_pairing');
    }
    let obj;
    try {
        obj = JSON.parse(
            dec.decode(b64uDecode(pairing.slice(PAIRING_PREFIX.length).trim())),
        );
    } catch {
        throw new SealedError('bad_pairing');
    }
    if (
        !obj ||
        obj.v !== SEALED_VERSION ||
        !SID_RE.test(obj.sid || '') ||
        typeof obj.pub !== 'string' ||
        typeof obj.secret !== 'string'
    ) {
        throw new SealedError('bad_pairing');
    }
    const secret = b64uDecode(obj.secret);
    if (secret.length !== SECRET_BYTES) throw new SealedError('bad_pairing');
    return { sid: obj.sid, pub: b64uDecode(obj.pub), secret };
}

/**
 * Shim side: accept the pasted pairing string. Returns the channel and the
 * `hello` (the shim's ephemeral public key) to send through the relay. The
 * secret and the browser key never leave the shim and the browser.
 */
export async function acceptPairing(pairing) {
    const { sid, pub, secret } = parsePairing(pairing);
    const browserPub = await importPeer(pub);
    const pair = await ecdhKeyPair();
    const keys = await deriveKeys(pair.privateKey, browserPub, secret, sid);
    const hello = {
        v: SEALED_VERSION,
        sid,
        pub: b64uEncode(await exportRaw(pair.publicKey)),
    };
    return { channel: new SealedChannel({ sid, role: 'client', keys }), hello };
}

/**
 * Browser side, step 2: take the shim's public key from the relay and
 * finish. One shot: a second hello for the same pairing is refused, so a
 * relay cannot probe with several keys. A swapped key derives the wrong keys
 * and the first request fails its GCM tag (it has no secret to do better).
 */
export async function completePairing(pending, hello) {
    if (!pending || pending.used) throw new SealedError('pairing_used');
    if (
        !hello ||
        hello.v !== SEALED_VERSION ||
        hello.sid !== pending.sid ||
        typeof hello.pub !== 'string'
    ) {
        throw new SealedError('bad_hello');
    }
    const peer = await importPeer(b64uDecode(hello.pub));
    pending.used = true;
    const keys = await deriveKeys(
        pending.privateKey,
        peer,
        pending.secret,
        pending.sid,
    );
    pending.secret = null;
    return new SealedChannel({ sid: pending.sid, role: 'browser', keys });
}

/**
 * Browser-side responder. `execute(tool, args)` is the page's policy-enforcing
 * runner (scope, rate limit, idle and expiry checks live in BridgeHost); the
 * responder only adds what sealed mode itself needs: authentication, ordering,
 * deadline, one answer per request id and the 256 KB result cap.
 */
export class SealedResponder {
    constructor({ channel, execute, now = () => Date.now() }) {
        this.channel = channel;
        this.execute = execute;
        this.now = now;
        this.answered = new Set();
    }

    /** Returns the sealed reply envelope, or null when nothing is sent. */
    async handle(envelope) {
        let req;
        try {
            req = await this.channel.open(envelope);
        } catch {
            return null; // forged, replayed or reordered: say nothing
        }
        if (
            !req ||
            typeof req.id !== 'string' ||
            req.id.length < 8 ||
            req.id.length > 64 ||
            typeof req.tool !== 'string' ||
            !Number.isFinite(req.deadline) ||
            this.now() >= req.deadline ||
            this.answered.has(req.id)
        ) {
            return null;
        }
        this.answered.add(req.id);
        let reply;
        try {
            const raw = await this.execute(req.tool, req.args || {});
            const offset = (req.args && req.args.offset) || 0;
            reply = {
                id: req.id,
                ok: true,
                content: fitResult(req.tool, raw, offset),
            };
        } catch (err) {
            reply = {
                id: req.id,
                ok: false,
                error:
                    err instanceof ResultTooLarge
                        ? 'result_too_large'
                        : String((err && err.message) || 'error').slice(0, 300),
            };
        }
        return this.channel.seal(reply);
    }
}

/**
 * Shim-side client: seals one request, hands the envelope to `send` (the
 * relay carrier) and opens the sealed reply. The relay sees envelopes only.
 */
export class SealedClient {
    constructor({ channel, send, now = () => Date.now(), timeoutMs = 15_000 }) {
        this.channel = channel;
        this.send = send;
        this.now = now;
        this.timeoutMs = timeoutMs;
    }

    async call(tool, args = {}) {
        const id = b64uEncode(
            globalThis.crypto.getRandomValues(new Uint8Array(16)),
        );
        const sealed = await this.channel.seal({
            id,
            tool,
            args,
            deadline: this.now() + this.timeoutMs,
        });
        const replyEnvelope = await this.send(sealed);
        const reply = await this.channel.open(replyEnvelope);
        if (!reply || reply.id !== id) throw new SealedError('id_mismatch');
        if (!reply.ok) throw new Error(String(reply.error || 'error'));
        return reply.content;
    }
}
