/**
 * Pure helpers for the hosted-MCP consent page (#514, design §5.2). No DOM.
 *
 * The pending authorization in the URL fragment is a value the relay signed;
 * the browser cannot verify it (it holds no key), so everything read from it
 * is display text and the relay re-verifies it when the bridge connects.
 */
import { TOOL_GROUPS, DEFAULT_UNTICKED_GROUPS } from '../bridge-scope.mjs';
import { SESSION_LENGTHS_MS } from '../bridge-host.mjs';

export const STATE_KEY = 'fire_tracker_state';
export const DEFAULT_LENGTH_MS = 30 * 60_000;

function b64urlToText(value) {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    return new TextDecoder().decode(
        Uint8Array.from(bin, (c) => c.charCodeAt(0)),
    );
}

/** The `req` value of `#/mcp-connect?req=...`, or null for any other hash. */
export function pendingFromHash(hash) {
    const m = /^#\/mcp-connect\?req=([A-Za-z0-9_.-]{1,4096})$/.exec(hash || '');
    return m ? m[1] : null;
}

/** Display fields from a pending authorization, or null if it is unreadable. */
export function describeRequest(req) {
    try {
        const body = JSON.parse(b64urlToText(req.split('.')[0]));
        const redirect = new URL(body.redirect_uri);
        const groups = (Array.isArray(body.scope) ? body.scope : []).filter(
            (g) => Object.hasOwn(TOOL_GROUPS, g),
        );
        if (groups.length === 0) return null;
        return {
            clientName: String(body.client_name || '').slice(0, 100),
            redirectHost: redirect.host,
            redirectUri: redirect.toString(),
            state: typeof body.state === 'string' ? body.state : undefined,
            groups: groups.map((id) => ({
                id,
                label: TOOL_GROUPS[id].label,
                // Transactions are the most detailed data: opt in, never out.
                checked: !DEFAULT_UNTICKED_GROUPS.includes(id),
            })),
            expiresAt: Number(body.exp) || 0,
        };
    } catch {
        return null;
    }
}

export const isValidLength = (ms) => SESSION_LENGTHS_MS.includes(ms);

/** True when this browser profile holds fire data worth sharing. */
export function hasFireData(storage) {
    try {
        const raw = storage.getItem(STATE_KEY);
        if (!raw) return false;
        const state = JSON.parse(raw);
        return (
            !!state &&
            typeof state === 'object' &&
            Object.keys(state).length > 0
        );
    } catch {
        return false;
    }
}

/** The error redirect when the user denies. */
export function denyUrl(info) {
    const u = new URL(info.redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (info.state !== undefined) u.searchParams.set('state', info.state);
    return u.toString();
}

/**
 * Where the user returns to the client once the session is live: the relay
 * checks the ticket (a hash of the pending value) and redirects with the code.
 */
export async function completionUrl(origin, sid, req) {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(req),
    );
    let bin = '';
    for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
    const t = btoa(bin)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `${origin}/authorize/complete?sid=${sid}&t=${t}`;
}

export function newSid() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, '0'),
    ).join('');
}
