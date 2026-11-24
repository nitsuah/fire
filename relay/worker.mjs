/**
 * Relay Worker entry (#510). Routes a WebSocket upgrade for /bridge/<sid> to
 * that session's Durable Object. Everything else is 404 until later children
 * add /mcp and the OAuth endpoints. Deny by default: the Origin header must be
 * the configured app origin.
 */
import { bearerToken, handleMcpRequest } from './mcp.mjs';
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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/mcp') return routeMcp(request, env, url);
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
