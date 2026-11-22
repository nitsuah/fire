'use strict';

// Connector grants (OAuth tokens sealed with SYNC_MASTER_KEY by
// crypto-utils.encrypt) live in HttpOnly cookies scoped to the connector's
// API path, so page scripts never hold them. Where the SPA used to keep the
// sealed blob it now keeps GRANT_MARKER, a non-secret "connected" flag.
//
// A sealed blob is hex `iv:tag:ciphertext`. In the cookie it is re-encoded
// as base64url (`iv.tag.ciphertext`, a third smaller) and split across
// numbered chunks (`<name>.0`, `<name>.1`, ...), since one cookie holds
// about 4 KB and an eBay grant can be larger.

// Browsers cap one cookie (name, value and attributes) at 4096 bytes; 3800
// value characters leave room for the name and the ~90-byte attribute suffix.
const CHUNK_CHARS = 3800;
const MAX_CHUNKS = 6;
// Browsers cap a cookie's lifetime at 400 days.
const MAX_AGE_S = 400 * 24 * 60 * 60;
const GRANT_MARKER = 'cookie';

const HEX = /^[0-9a-f]+$/i;
const B64URL = /^[A-Za-z0-9_-]+$/;

function toCookieValue(sealed) {
    const parts = String(sealed).split(':');
    if (parts.length !== 3 || !parts.every((p) => HEX.test(p)))
        throw new Error('not a sealed grant');
    return parts
        .map((h) => Buffer.from(h, 'hex').toString('base64url'))
        .join('.');
}

function fromCookieValue(value) {
    const parts = String(value).split('.');
    if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) return null;
    return parts
        .map((b) => Buffer.from(b, 'base64url').toString('hex'))
        .join(':');
}

function parseCookies(header) {
    const jar = new Map();
    for (const part of String(header || '').split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const k = part.slice(0, eq).trim();
        if (k && !jar.has(k)) jar.set(k, part.slice(eq + 1).trim());
    }
    return jar;
}

function attributes(path, secure, maxAge) {
    return `Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// The sealed grant from the request's Cookie header, or null.
function readGrant(cookieHeader, name) {
    const jar = parseCookies(cookieHeader);
    let joined = '';
    for (let i = 0; i < MAX_CHUNKS; i++) {
        const chunk = jar.get(`${name}.${i}`);
        if (!chunk) break;
        joined += chunk;
    }
    return joined ? fromCookieValue(joined) : null;
}

// Set-Cookie values that store `sealed`. Every chunk slot is written, the
// unused ones expired, so a shorter grant never leaves a stale tail behind.
function grantCookies(name, path, sealed, { secure = true } = {}) {
    const value = toCookieValue(sealed);
    const chunks = [];
    for (let i = 0; i < value.length; i += CHUNK_CHARS)
        chunks.push(value.slice(i, i + CHUNK_CHARS));
    if (chunks.length > MAX_CHUNKS) throw new Error('grant too large');
    return Array.from({ length: MAX_CHUNKS }, (_, i) =>
        i < chunks.length
            ? `${name}.${i}=${chunks[i]}; ${attributes(path, secure, MAX_AGE_S)}`
            : `${name}.${i}=; ${attributes(path, secure, 0)}`,
    );
}

function clearGrantCookies(name, path, { secure = true } = {}) {
    return Array.from(
        { length: MAX_CHUNKS },
        (_, i) => `${name}.${i}=; ${attributes(path, secure, 0)}`,
    );
}

// The grant to use for a request: the cookie, or else a sealed blob a client
// from before the cookie move still sends. `adopted` is true whenever such a
// blob arrived: the caller should store the grant in the cookie and answer
// with GRANT_MARKER, so the client overwrites the blob it still holds.
function pickGrant(cookieHeader, name, legacy) {
    const fromCookie = readGrant(cookieHeader, name);
    const sentBlob =
        typeof legacy === 'string' && legacy !== '' && legacy !== GRANT_MARKER;
    return {
        sealed: fromCookie || (sentBlob ? legacy : null),
        adopted: sentBlob,
    };
}

module.exports = {
    GRANT_MARKER,
    MAX_CHUNKS,
    readGrant,
    grantCookies,
    clearGrantCookies,
    pickGrant,
};
