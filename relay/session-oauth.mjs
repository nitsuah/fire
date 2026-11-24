/**
 * OAuth endpoints that need the session (#512, design §5.2, §7):
 * /authorize/complete mints the single-use authorization code and /token
 * exchanges it (PKCE S256) for the opaque access token. Codes and tokens are
 * `<sid>.<random>` so the Worker can route to the right object without a
 * table; the session keeps only their SHA-256 hashes, in memory. No refresh
 * tokens: the token's life is the session's remaining life.
 */
import { constantTimeEqual, sha256Hex } from './session.mjs';
import {
    jsonResponse,
    mcpUrl,
    noStore,
    oauthError,
    verifyClientId,
} from './oauth.mjs';
import { randomToken, sha256b64url } from './signing.mjs';

export const CODE_TTL_MS = 60_000;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
export const MAX_FORM_BYTES = 8 * 1024;

/**
 * The value the consent tab sends to /authorize/complete: a hash of the
 * pending authorization it used for HELLO, so the pending value itself never
 * appears in a URL the server sees.
 */
export const completionTicket = (pendingAuth) => sha256b64url(pendingAuth);

/** Mint the code for a live session; returns the client redirect or null. */
async function completeAuthorization(session, ticket) {
    const now = session.clock.now();
    if (
        session.status !== 'live' ||
        session.authCompleted ||
        !session.pending ||
        typeof ticket !== 'string'
    ) {
        return null;
    }
    const expected = await completionTicket(session.pendingAuth);
    if (!constantTimeEqual(expected, ticket)) return null;
    if (session.authCompleted) return null; // lost a race while hashing
    session.authCompleted = true;
    const code = `${session.sid}.${randomToken(32)}`;
    session.codes.set(await sha256Hex(code), { exp: now + CODE_TTL_MS });
    const p = session.pending;
    const u = new URL(p.redirect_uri);
    u.searchParams.set('code', code);
    if (typeof p.state === 'string') u.searchParams.set('state', p.state);
    return u.toString();
}

export async function handleAuthorizeComplete(request, session) {
    if (request.method !== 'GET') {
        return oauthError('invalid_request', 'GET only', 405, { Allow: 'GET' });
    }
    const t = new URL(request.url).searchParams.get('t');
    const location = session ? await completeAuthorization(session, t) : null;
    if (!location) {
        return oauthError(
            'access_denied',
            'Authorization is not available',
            403,
        );
    }
    return new Response(null, {
        status: 302,
        headers: { Location: location, ...noStore },
    });
}

/** POST /token body text, for a code that routes to this session. */
export async function handleToken(text, session, ctx) {
    if (text.length > MAX_FORM_BYTES) {
        return oauthError('invalid_request', 'Request too large');
    }
    const f = new URLSearchParams(text);
    if (f.get('grant_type') !== 'authorization_code') {
        return oauthError('unsupported_grant_type', 'authorization_code only');
    }
    const code = f.get('code');
    const bad = (description) => oauthError('invalid_grant', description);
    if (!session || !code) return bad('Invalid or expired code');
    const now = session.clock.now();
    // Single use: the code is spent by this attempt, whatever the outcome.
    const codeHash = await sha256Hex(code);
    const entry = session.codes.get(codeHash);
    session.codes.delete(codeHash);
    const p = session.pending;
    if (
        !entry ||
        !p ||
        !(entry.exp > now) ||
        session.status === 'ended' ||
        session.status === 'new'
    ) {
        return bad('Invalid or expired code');
    }
    const clientId = f.get('client_id');
    if (
        !clientId ||
        !constantTimeEqual(clientId, p.client_id) ||
        !(await verifyClientId(ctx.key, clientId, now))
    ) {
        return oauthError('invalid_client', 'Register the client again', 401);
    }
    if (f.get('redirect_uri') !== p.redirect_uri) {
        return bad('redirect_uri does not match the authorization request');
    }
    const resource = f.get('resource');
    if (resource !== null && resource !== mcpUrl(ctx.env, ctx.url)) {
        return oauthError('invalid_target', 'resource must be the MCP URL');
    }
    const verifier = f.get('code_verifier') || '';
    if (
        !VERIFIER.test(verifier) ||
        !constantTimeEqual(await sha256b64url(verifier), p.code_challenge)
    ) {
        return bad('PKCE verification failed');
    }
    const expiresIn = Math.floor((session.expiresAt - now) / 1000);
    if (expiresIn <= 0) return bad('Session expired');
    const token = `${session.sid}.${randomToken(32)}`;
    session.addTokenHash(await sha256Hex(token));
    return jsonResponse({
        access_token: token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        // The approved scope, never the requested one.
        scope: [...session.scope].join(' '),
    });
}
