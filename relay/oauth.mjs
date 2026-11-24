/**
 * OAuth 2.1 authorization server endpoints that need no session (#512,
 * design §5.2): metadata, dynamic client registration and /authorize. All
 * state is in signed values (see signing.mjs); nothing is stored. /token and
 * /authorize/complete need the session and live in session-oauth.mjs.
 */
import { TOOL_GROUPS } from '../app/bridge-scope.mjs';
import { importHmacKey, signValue, verifyValue } from './signing.mjs';

export const REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PENDING_TTL_MS = 5 * 60 * 1000;
const PURPOSE_CLIENT = 'fire-bridge/client/v1';
const PURPOSE_PENDING = 'fire-bridge/pending/v1';
const MAX_REDIRECT_URIS = 5;
const SCOPES = Object.keys(TOOL_GROUPS);

export const noStore = {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
};

export function jsonResponse(body, status = 200, extra = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...noStore, ...extra },
    });
}

export const oauthError = (error, description, status = 400, extra = {}) =>
    jsonResponse({ error, error_description: description }, status, extra);

export function publicOrigin(env, url) {
    return env.PUBLIC_ORIGIN || url.origin;
}

export const mcpUrl = (env, url) => `${publicOrigin(env, url)}/mcp`;

/** https, or http on a loopback host (native clients); no userinfo/fragment. */
export function validRedirectUri(value) {
    if (typeof value !== 'string' || value.length > 512) return false;
    let u;
    try {
        u = new URL(value);
    } catch {
        return false;
    }
    if (u.username || u.password || u.hash) return false;
    if (u.protocol === 'https:') return true;
    const loopback = ['localhost', '127.0.0.1', '[::1]'];
    return u.protocol === 'http:' && loopback.includes(u.hostname);
}

// Control characters and bidi overrides are not allowed in a display name.
function printable(ch) {
    const c = ch.codePointAt(0);
    return !(
        c < 0x20 ||
        (c >= 0x7f && c <= 0x9f) ||
        (c >= 0x202a && c <= 0x202e) ||
        (c >= 0x2066 && c <= 0x2069)
    );
}

function cleanName(name) {
    if (typeof name !== 'string') return '';
    // Self-asserted display text: strip control characters and cap the length.
    return [...name].filter(printable).join('').trim().slice(0, 100);
}

export function metadataResponse(request, env, url) {
    const origin = publicOrigin(env, url);
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
        return jsonResponse({
            resource: mcpUrl(env, url),
            authorization_servers: [origin],
            bearer_methods_supported: ['header'],
            scopes_supported: SCOPES,
        });
    }
    return jsonResponse({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: SCOPES,
    });
}

/** POST /register: the returned client_id is the signed registration. */
export async function registerClient(request, key, now) {
    let body;
    try {
        body = JSON.parse(await request.text());
    } catch {
        return oauthError('invalid_client_metadata', 'Body must be JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return oauthError('invalid_client_metadata', 'Body must be an object');
    }
    const uris = body.redirect_uris;
    if (
        !Array.isArray(uris) ||
        uris.length < 1 ||
        uris.length > MAX_REDIRECT_URIS ||
        !uris.every(validRedirectUri)
    ) {
        return oauthError(
            'invalid_redirect_uri',
            'redirect_uris must be 1-5 https (or loopback http) URLs',
        );
    }
    const method = body.token_endpoint_auth_method;
    if (method !== undefined && method !== 'none') {
        return oauthError(
            'invalid_client_metadata',
            'Only public clients (token_endpoint_auth_method none)',
        );
    }
    const grants = body.grant_types;
    if (
        grants !== undefined &&
        !(
            Array.isArray(grants) &&
            grants.every((g) => g === 'authorization_code')
        )
    ) {
        return oauthError('invalid_client_metadata', 'Unsupported grant_types');
    }
    const registration = {
        redirect_uris: [...new Set(uris)],
        client_name: cleanName(body.client_name),
        iat: now,
        exp: now + REGISTRATION_TTL_MS,
    };
    const client_id = await signValue(key, PURPOSE_CLIENT, registration);
    return jsonResponse(
        {
            client_id,
            client_id_issued_at: Math.floor(now / 1000),
            redirect_uris: registration.redirect_uris,
            client_name: registration.client_name,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code'],
            response_types: ['code'],
        },
        201,
    );
}

/** The registration behind a client_id, or null if forged or expired. */
export async function verifyClientId(key, clientId, now) {
    const reg = await verifyValue(key, PURPOSE_CLIENT, clientId);
    if (!reg || !Array.isArray(reg.redirect_uris) || !(reg.exp > now)) {
        return null;
    }
    return reg;
}

/**
 * Check a pending authorization value (used for the HELLO check): the signed
 * payload plus the requested scope, or null if forged or expired.
 */
export async function verifyPending(key, value, now) {
    const p = await verifyValue(key, PURPOSE_PENDING, value);
    if (!p || !(p.exp > now) || !Array.isArray(p.scope)) return null;
    return { requestedScope: p.scope, pending: p };
}

function redirectWith(redirectUri, params) {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) u.searchParams.set(k, v);
    }
    return new Response(null, {
        status: 302,
        headers: { Location: u.toString(), ...noStore },
    });
}

/** GET /authorize: validate, then send the user to the consent page. */
export async function authorize(request, env, key, now, url) {
    const q = url.searchParams;
    // Errors about the client or redirect URI are shown, never redirected.
    const reg = await verifyClientId(key, q.get('client_id'), now);
    if (!reg) {
        return oauthError(
            'invalid_client',
            'Unknown or expired client_id',
            400,
        );
    }
    const redirectUri = q.get('redirect_uri');
    if (!redirectUri || !reg.redirect_uris.includes(redirectUri)) {
        return oauthError('invalid_request', 'redirect_uri is not registered');
    }
    const state = q.get('state') ?? undefined;
    const fail = (error, description) =>
        redirectWith(redirectUri, {
            error,
            error_description: description,
            state,
        });
    if (state !== undefined && state.length > 512) {
        return fail('invalid_request', 'state is too long');
    }
    if (q.get('response_type') !== 'code') {
        return fail('unsupported_response_type', 'response_type must be code');
    }
    const challenge = q.get('code_challenge');
    if (
        q.get('code_challenge_method') !== 'S256' ||
        !challenge ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge)
    ) {
        return fail(
            'invalid_request',
            'PKCE with code_challenge_method S256 is required',
        );
    }
    const resource = q.get('resource');
    if (resource !== null && resource !== mcpUrl(env, url)) {
        return fail('invalid_target', 'resource must be the MCP URL');
    }
    const asked = (q.get('scope') || '').split(/\s+/).filter(Boolean);
    const scope = asked.length ? [...new Set(asked)] : SCOPES;
    if (!scope.every((s) => SCOPES.includes(s))) {
        return fail('invalid_scope', 'Unknown scope');
    }
    const pending = await signValue(key, PURPOSE_PENDING, {
        client_id: q.get('client_id'),
        client_name: reg.client_name,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        state,
        scope,
        resource: resource ?? undefined,
        exp: now + PENDING_TTL_MS,
    });
    // The value goes in the fragment, which browsers never send to a server.
    const target = `${env.APP_ORIGIN || publicOrigin(env, url)}/#/mcp-connect?req=${pending}`;
    return new Response(null, {
        status: 302,
        headers: { Location: target, ...noStore },
    });
}

/** Route the endpoints that need no session. Returns null if not one. */
export async function handleOAuthStateless(request, env, now = Date.now()) {
    const url = new URL(request.url);
    const p = url.pathname;
    const isMeta =
        p.startsWith('/.well-known/oauth-protected-resource') ||
        p === '/.well-known/oauth-authorization-server';
    if (isMeta) {
        return request.method === 'GET'
            ? metadataResponse(request, env, url)
            : oauthError('invalid_request', 'GET only', 405, { Allow: 'GET' });
    }
    if (p !== '/register' && p !== '/authorize') return null;
    const expected = p === '/register' ? 'POST' : 'GET';
    if (request.method !== expected) {
        return oauthError('invalid_request', `${expected} only`, 405, {
            Allow: expected,
        });
    }
    const key = await importHmacKey(env.RELAY_HMAC_KEY);
    // Fail closed: no usable signing key, no OAuth.
    if (!key) return oauthError('server_error', 'Relay is not configured', 500);
    return p === '/register'
        ? registerClient(request, key, now)
        : authorize(request, env, key, now, url);
}
