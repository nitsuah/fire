/**
 * Stateless signed values for the relay (#512, design §3, §5.2).
 *
 * Client registrations and pending authorizations are not stored anywhere:
 * each is a self-contained `<base64url JSON>.<base64url HMAC>` value signed
 * with the relay HMAC key (a Worker secret). The MAC covers a purpose tag, so
 * a value minted for one purpose never verifies as another. Verification uses
 * WebCrypto `verify`, which compares in constant time. Nothing here logs.
 */
const enc = new TextEncoder();
const MIN_KEY_BYTES = 32;

export function b64urlEncode(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    for (const b of arr) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    try {
        const bin = atob(padded);
        return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch {
        return null;
    }
}

/**
 * Import the relay HMAC key from its secret (base64url, at least 32 bytes).
 * A missing or short secret returns null so callers fail closed.
 */
export async function importHmacKey(secret) {
    const raw = typeof secret === 'string' ? b64urlDecode(secret.trim()) : null;
    if (!raw || raw.length < MIN_KEY_BYTES) return null;
    return crypto.subtle.importKey(
        'raw',
        raw,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    );
}

export async function signValue(key, purpose, payload) {
    const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
    const mac = await crypto.subtle.sign(
        'HMAC',
        key,
        enc.encode(`${purpose}.${body}`),
    );
    return `${body}.${b64urlEncode(mac)}`;
}

/** The payload if the MAC is valid for this purpose, else null. */
export async function verifyValue(key, purpose, value) {
    if (typeof value !== 'string' || value.length > 4096) return null;
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    const [body, mac] = parts;
    const macBytes = b64urlDecode(mac);
    if (!macBytes || !b64urlDecode(body)) return null;
    const ok = await crypto.subtle.verify(
        'HMAC',
        key,
        macBytes,
        enc.encode(`${purpose}.${body}`),
    );
    if (!ok) return null;
    try {
        const payload = JSON.parse(
            new TextDecoder().decode(b64urlDecode(body)),
        );
        return payload && typeof payload === 'object' ? payload : null;
    } catch {
        return null;
    }
}

export async function sha256b64url(text) {
    return b64urlEncode(
        await crypto.subtle.digest('SHA-256', enc.encode(text)),
    );
}

export function randomToken(bytes = 32) {
    return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}
