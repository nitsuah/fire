/**
 * Bridge Protocol Module
 * Pure, host-agnostic module for the MCP browser bridge protocol.
 * No network, no DOM — shared by browser and server.
 */

// Protocol version
export const PROTOCOL_VERSION = 1;

// Frame types
export const FrameType = {
    HELLO: 'HELLO',
    CHALLENGE: 'CHALLENGE',
    PROVE: 'PROVE',
    READY: 'READY',
    CALL: 'CALL',
    RESULT: 'RESULT',
    END: 'END',
};

// Default limits
export const Limits = {
    MAX_RESULT_BYTES: 256 * 1024, // 256 KB
    MAX_CALLS_IN_FLIGHT: 4,
    CALL_DEADLINE_MS: 15_000,
    RATE_LIMIT_CALLS_PER_MIN: 30,
    NONCE_EXPIRY_MS: 10_000,
    RECONNECT_GRACE_MS: 30_000,
    IDLE_TIMEOUT_MS: 10 * 60 * 1000,
    SESSION_MAX_MS: 60 * 60 * 1000, // 60 min absolute max
};

// Signing string prefix
export const SIGNING_PREFIX = 'fire-bridge/v1';

/**
 * Validates a frame has the required base fields.
 */
export function validateBaseFrame(frame) {
    if (!frame || typeof frame !== 'object') {
        return { ok: false, error: 'Frame must be an object' };
    }
    if (frame.v !== PROTOCOL_VERSION) {
        return { ok: false, error: `Unknown protocol version: ${frame.v}` };
    }
    if (!frame.type || !Object.values(FrameType).includes(frame.type)) {
        return { ok: false, error: `Unknown frame type: ${frame.type}` };
    }
    if (!frame.sid || typeof frame.sid !== 'string') {
        return { ok: false, error: 'Missing or invalid sid' };
    }
    return { ok: true };
}

/**
 * Validates a HELLO frame (browser → relay).
 */
export function validateHello(frame) {
    const base = validateBaseFrame(frame);
    if (!base.ok) return base;
    if (frame.type !== FrameType.HELLO) {
        return { ok: false, error: 'Not a HELLO frame' };
    }
    if (!frame.pub || typeof frame.pub !== 'object') {
        return { ok: false, error: 'HELLO requires pub (JWK)' };
    }
    const pubCheck = validatePublicJwk(frame.pub);
    if (!pubCheck.ok) return pubCheck;
    if (
        frame.pendingAuth !== undefined &&
        typeof frame.pendingAuth !== 'string'
    ) {
        return { ok: false, error: 'pendingAuth must be a string' };
    }
    if (frame.scope !== undefined) {
        if (
            !Array.isArray(frame.scope) ||
            !frame.scope.every((s) => typeof s === 'string')
        ) {
            return { ok: false, error: 'scope must be an array of strings' };
        }
    }
    if (frame.expiresAt !== undefined) {
        if (
            typeof frame.expiresAt !== 'number' ||
            !Number.isFinite(frame.expiresAt)
        ) {
            return { ok: false, error: 'expiresAt must be a finite number' };
        }
    }
    return { ok: true };
}

/**
 * Validates a CHALLENGE frame (relay → browser).
 */
export function validateChallenge(frame) {
    const base = validateBaseFrame(frame);
    if (!base.ok) return base;
    if (frame.type !== FrameType.CHALLENGE) {
        return { ok: false, error: 'Not a CHALLENGE frame' };
    }
    if (!frame.nonce || typeof frame.nonce !== 'string') {
        return { ok: false, error: 'CHALLENGE requires nonce' };
    }
    // nonce should be 128-bit = 32 hex chars
    if (!/^[0-9a-f]{32}$/i.test(frame.nonce)) {
        return { ok: false, error: 'nonce must be 128-bit hex' };
    }
    if (typeof frame.exp !== 'number' || !Number.isFinite(frame.exp)) {
        return { ok: false, error: 'CHALLENGE requires exp (number)' };
    }
    return { ok: true };
}

/**
 * Validates a PROVE frame (browser → relay).
 */
export function validateProve(frame) {
    const base = validateBaseFrame(frame);
    if (!base.ok) return base;
    if (frame.type !== FrameType.PROVE) {
        return { ok: false, error: 'Not a PROVE frame' };
    }
    if (!frame.sig || typeof frame.sig !== 'string') {
        return { ok: false, error: 'PROVE requires sig' };
    }
    // sig should be base64url
    if (!/^[A-Za-z0-9_-]+$/.test(frame.sig)) {
        return { ok: false, error: 'sig must be base64url' };
    }
    return { ok: true };
}

/**
 * Validates a READY frame (relay → browser).
 */
export function validateReady(frame) {
    const base = validateBaseFrame(frame);
    if (!base.ok) return base;
    if (frame.type !== FrameType.READY) {
        return { ok: false, error: 'Not a READY frame' };
    }
    if (
        typeof frame.expiresAt !== 'number' ||
        !Number.isFinite(frame.expiresAt)
    ) {
        return { ok: false, error: 'READY requires expiresAt' };
    }
    if (
        typeof frame.idleTimeout !== 'number' ||
        !Number.isFinite(frame.idleTimeout) ||
        frame.idleTimeout <= 0
    ) {
        return { ok: false, error: 'READY requires a positive idleTimeout' };
    }
    if (
        !Array.isArray(frame.scope) ||
        !frame.scope.every((s) => typeof s === 'string')
    ) {
        return { ok: false, error: 'READY requires scope array' };
    }
    return { ok: true };
}

/**
 * Validates a CALL frame (relay → browser).
 */
export function validateCall(frame) {
    const base = validateBaseFrame(frame);
    if (!base.ok) return base;
    if (frame.type !== FrameType.CALL) {
        return { ok: false, error: 'Not a CALL frame' };
    }
    if (
        typeof frame.seq !== 'number' ||
        !Number.isInteger(frame.seq) ||
        frame.seq < 1
    ) {
        return { ok: false, error: 'CALL requires seq (positive integer)' };
    }
    if (!frame.id || typeof frame.id !== 'string') {
        return { ok: false, error: 'CALL requires id' };
    }
    // id should be 128-bit = 32 hex chars
    if (!/^[0-9a-f]{32}$/i.test(frame.id)) {
        return { ok: false, error: 'id must be 128-bit hex' };
    }
    if (
        typeof frame.deadline !== 'number' ||
        !Number.isFinite(frame.deadline)
    ) {
        return { ok: false, error: 'CALL requires deadline' };
    }
    if (!frame.tool || typeof frame.tool !== 'string') {
        return { ok: false, error: 'CALL requires tool' };
    }
    if (
        frame.args !== undefined &&
        (typeof frame.args !== 'object' || frame.args === null)
    ) {
        return { ok: false, error: 'CALL args must be an object' };
    }
    return { ok: true };
}

/**
 * Validates a RESULT frame (browser → relay).
 */
export function validateResult(frame) {
    const base = validateBaseFrame(frame);
    if (!base.ok) return base;
    if (frame.type !== FrameType.RESULT) {
        return { ok: false, error: 'Not a RESULT frame' };
    }
    if (!frame.id || typeof frame.id !== 'string') {
        return { ok: false, error: 'RESULT requires id' };
    }
    if (typeof frame.ok !== 'boolean') {
        return { ok: false, error: 'RESULT requires ok (boolean)' };
    }
    if (frame.ok) {
        if (frame.content === undefined) {
            return { ok: false, error: 'Successful RESULT requires content' };
        }
    } else {
        if (!frame.error || typeof frame.error !== 'string') {
            return { ok: false, error: 'Failed RESULT requires error string' };
        }
    }
    return { ok: true };
}

/**
 * Validates an END frame (either direction).
 */
export function validateEnd(frame) {
    const base = validateBaseFrame(frame);
    if (!base.ok) return base;
    if (frame.type !== FrameType.END) {
        return { ok: false, error: 'Not an END frame' };
    }
    if (!frame.reason || typeof frame.reason !== 'string') {
        return { ok: false, error: 'END requires reason' };
    }
    return { ok: true };
}

/**
 * Dispatches to the appropriate validator.
 */
export function validateFrame(frame) {
    const base = validateBaseFrame(frame);
    if (!base.ok) return base;
    switch (frame.type) {
        case FrameType.HELLO:
            return validateHello(frame);
        case FrameType.CHALLENGE:
            return validateChallenge(frame);
        case FrameType.PROVE:
            return validateProve(frame);
        case FrameType.READY:
            return validateReady(frame);
        case FrameType.CALL:
            return validateCall(frame);
        case FrameType.RESULT:
            return validateResult(frame);
        case FrameType.END:
            return validateEnd(frame);
        default:
            return { ok: false, error: `Unhandled frame type: ${frame.type}` };
    }
}

/**
 * Builds the signing string for PROVE.
 * Format: "fire-bridge/v1" ‖ relayOrigin ‖ sid ‖ nonce ‖ scope ‖ expiresAt
 * All components are joined with '\x00' (null byte) to prevent ambiguity.
 */
export function buildProveSigningString(
    relayOrigin,
    sid,
    nonce,
    scope,
    expiresAt,
) {
    // Canonical, unambiguous encoding: NUL-separated fields, so no field may
    // contain NUL; scope entries are joined with ',' so they may not contain it.
    // Sort a copy (never mutate the caller's scope).
    const scopeList = Array.isArray(scope) ? [...scope].map(String).sort() : [];
    if (scopeList.some((s) => s.includes(',') || s.includes('\x00'))) {
        throw new TypeError('scope entries must not contain "," or NUL');
    }
    for (const part of [relayOrigin, sid, nonce, String(expiresAt)]) {
        if (typeof part !== 'string' || part.includes('\x00')) {
            throw new TypeError('signing fields must be strings without NUL');
        }
    }
    const scopeStr = scopeList.join(',');
    return [
        SIGNING_PREFIX,
        relayOrigin,
        sid,
        nonce,
        scopeStr,
        String(expiresAt),
    ].join('\x00');
}

/**
 * Checks that a signing string is the canonical one for these values (pure
 * string reconstruction, nothing secret). It does NOT verify a signature:
 * authenticity of a PROVE frame comes from verifyProve.
 */
export function verifyProveSigningString(
    signingString,
    relayOrigin,
    sid,
    nonce,
    scope,
    expiresAt,
) {
    const expected = buildProveSigningString(
        relayOrigin,
        sid,
        nonce,
        scope,
        expiresAt,
    );
    return signingString === expected;
}

/**
 * Checks CALL sequencing rules.
 */
export function checkCallSeq(frame, lastSeq) {
    if (frame.seq <= lastSeq) {
        return {
            ok: false,
            error: `Replayed or out-of-order seq: ${frame.seq} <= ${lastSeq}`,
        };
    }
    return { ok: true };
}

/**
 * Checks CALL deadline hasn't passed.
 */
/**
 * A CHALLENGE (and so its nonce) is only answerable before its exp.
 */
export function checkChallengeFresh(frame, now = Date.now()) {
    if (!(frame.exp > now)) {
        return { ok: false, error: 'Challenge expired' };
    }
    return { ok: true };
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/**
 * The HELLO key must be a public ECDSA P-256 JWK: kty EC, crv P-256, base64url
 * x and y, and never the private part (d).
 */
export function validatePublicJwk(jwk) {
    if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
        return { ok: false, error: 'pub must be a JWK object' };
    }
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
        return { ok: false, error: 'pub must be an EC P-256 JWK' };
    }
    for (const c of ['x', 'y']) {
        if (typeof jwk[c] !== 'string' || !B64URL.test(jwk[c])) {
            return { ok: false, error: `pub.${c} must be base64url` };
        }
    }
    if ('d' in jwk) {
        return { ok: false, error: 'pub must not contain a private key' };
    }
    return { ok: true };
}

function base64UrlToBytes(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * Verify a PROVE signature: ECDSA P-256 / SHA-256 (WebCrypto, raw r||s) by the
 * HELLO public key over the canonical signing string rebuilt from the values
 * the relay expects. Any malformed key, signature or field yields false.
 * Uses globalThis.crypto.subtle, so it runs in browsers and Node alike.
 * @returns {Promise<boolean>}
 */
export async function verifyProve(
    sig,
    pubJwk,
    { relayOrigin, sid, nonce, scope, expiresAt },
) {
    try {
        if (typeof sig !== 'string' || !B64URL.test(sig)) return false;
        if (!validatePublicJwk(pubJwk).ok) return false;
        const message = new TextEncoder().encode(
            buildProveSigningString(relayOrigin, sid, nonce, scope, expiresAt),
        );
        const { kty, crv, x, y } = pubJwk;
        const key = await globalThis.crypto.subtle.importKey(
            'jwk',
            { kty, crv, x, y, ext: true },
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify'],
        );
        return await globalThis.crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key,
            base64UrlToBytes(sig),
            message,
        );
    } catch {
        return false;
    }
}

export function checkCallDeadline(frame, now = Date.now()) {
    if (frame.deadline <= now) {
        return {
            ok: false,
            error: `Call deadline passed: ${frame.deadline} <= ${now}`,
        };
    }
    return { ok: true };
}

/**
 * Checks RESULT size limit.
 */
export function checkResultSize(frame) {
    const json = JSON.stringify(frame);
    const bytes = new TextEncoder().encode(json).length;
    if (bytes > Limits.MAX_RESULT_BYTES) {
        return {
            ok: false,
            error: `Result too large: ${bytes} > ${Limits.MAX_RESULT_BYTES}`,
            bytes,
        };
    }
    return { ok: true, bytes };
}

/**
 * Generates a 128-bit random ID as hex string.
 */
export function generateId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a 128-bit random nonce as hex string.
 */
export function generateNonce() {
    return generateId();
}

/**
 * Creates a HELLO frame.
 */
export function createHello(pub, pendingAuth, scope, expiresAt) {
    return {
        v: PROTOCOL_VERSION,
        type: FrameType.HELLO,
        sid: '', // filled by caller
        pub,
        pendingAuth,
        scope,
        expiresAt,
    };
}

/**
 * Creates a CHALLENGE frame.
 */
export function createChallenge(sid, nonce, exp) {
    return {
        v: PROTOCOL_VERSION,
        type: FrameType.CHALLENGE,
        sid,
        nonce,
        exp,
    };
}

/**
 * Creates a PROVE frame.
 */
export function createProve(sid, sig) {
    return {
        v: PROTOCOL_VERSION,
        type: FrameType.PROVE,
        sid,
        sig,
    };
}

/**
 * Creates a READY frame.
 */
export function createReady(sid, expiresAt, idleTimeout, scope) {
    return {
        v: PROTOCOL_VERSION,
        type: FrameType.READY,
        sid,
        expiresAt,
        idleTimeout,
        scope,
    };
}

/**
 * Creates a CALL frame.
 */
export function createCall(sid, seq, id, deadline, tool, args) {
    return {
        v: PROTOCOL_VERSION,
        type: FrameType.CALL,
        sid,
        seq,
        id,
        deadline,
        tool,
        args,
    };
}

/**
 * Creates a RESULT frame.
 */
export function createResult(sid, id, ok, contentOrError) {
    return {
        v: PROTOCOL_VERSION,
        type: FrameType.RESULT,
        sid,
        id,
        ok,
        ...(ok ? { content: contentOrError } : { error: contentOrError }),
    };
}

/**
 * Creates an END frame.
 */
export function createEnd(sid, reason) {
    return {
        v: PROTOCOL_VERSION,
        type: FrameType.END,
        sid,
        reason,
    };
}
