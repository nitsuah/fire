/**
 * Relay Worker entry (#510). Routes a WebSocket upgrade for /bridge/<sid> to
 * that session's Durable Object. Everything else is 404 until later children
 * add /mcp and the OAuth endpoints. Deny by default: the Origin header must be
 * the configured app origin.
 */
import { bearerToken, handleMcpRequest } from './mcp.mjs';
import { handleOAuthStateless, oauthError } from './oauth.mjs';
import { MAX_FORM_BYTES } from './session-oauth.mjs';
import {
    BridgeSessionObject,
    sidFromPath,
    sidFromToken,
} from './session-object.mjs';

export { BridgeSessionObject };

export function originAllowed(request, env) {
    const allowed = env && env.APP_ORIGIN;
    if (!allowed) return false;
    return request.headers.get('Origin') === allowed;
}

// /mcp is called by MCP clients, not browsers, so there is no Origin
// allow-list here (the handler refuses any request that carries an Origin).
// Only a POST with a well-formed `<sid>.<random>` token reaches a session
// object; everything else is answered here without touching one.
function routeMcp(request, env, url) {
    const sid =
        request.method === 'POST' ? sidFromToken(bearerToken(request)) : null;
    if (!sid || request.headers.has('Origin')) {
        return handleMcpRequest(request, null, {
            resourceMetadataUrl: `${env.PUBLIC_ORIGIN || url.origin}/.well-known/oauth-protected-resource`,
        });
    }
    const ns = env.BRIDGE_SESSIONS;
    return ns.get(ns.idFromName(sid)).fetch(request);
}

// OAuth: metadata, /register and /authorize need no session. /authorize/complete
// (sid in the query) and /token (sid prefix of the code) go to that session.
async function routeOAuth(request, env, url) {
    const stateless = await handleOAuthStateless(request, env);
    if (stateless) return stateless;
    const ns = env.BRIDGE_SESSIONS;
    if (url.pathname === '/authorize/complete') {
        const sid = url.searchParams.get('sid') || '';
        if (!/^[0-9a-f]{32}$/.test(sid)) {
            return oauthError(
                'access_denied',
                'Authorization is not available',
                403,
            );
        }
        return ns.get(ns.idFromName(sid)).fetch(request);
    }
    if (url.pathname === '/token') {
        if (request.method !== 'POST') {
            return oauthError('invalid_request', 'POST only', 405, {
                Allow: 'POST',
            });
        }
        const text = await request.text();
        if (text.length > MAX_FORM_BYTES) {
            return oauthError('invalid_request', 'Request too large');
        }
        const sid = sidFromToken(new URLSearchParams(text).get('code'));
        if (!sid) return oauthError('invalid_grant', 'Invalid or expired code');
        return ns.get(ns.idFromName(sid)).fetch(
            new Request(request.url, {
                method: 'POST',
                headers: request.headers,
                body: text,
            }),
        );
    }
    return null;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/mcp') return routeMcp(request, env, url);
        const oauth = await routeOAuth(request, env, url);
        if (oauth) return oauth;
        const sid = sidFromPath(url.pathname);
        if (!sid) return new Response('Not found', { status: 404 });
        const upgrade = request.headers.get('Upgrade');
        if (
            request.method !== 'GET' ||
            upgrade?.toLowerCase() !== 'websocket'
        ) {
            return new Response('Expected a WebSocket upgrade', {
                status: 426,
            });
        }
        if (!originAllowed(request, env)) {
            return new Response('Forbidden', { status: 403 });
        }
        const ns = env.BRIDGE_SESSIONS;
        return ns.get(ns.idFromName(sid)).fetch(request);
    },
};
