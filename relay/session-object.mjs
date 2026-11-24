/**
 * Durable Object adapter for one bridge session (#510, design §3).
 *
 * The browser socket is accepted with the standard WebSocket API
 * (`server.accept()`), never the hibernation API: an object holding a standard
 * socket is not hibernated, so the session key and policy stay in memory while
 * the browser is connected. Nothing here touches the Durable Object storage
 * API (alarms included); a test enforces that.
 *
 * The class uses the classic (non-extending) Durable Object shape so this
 * module also imports under Node for tests.
 */
import { BridgeSession } from './session.mjs';
import { bearerToken, handleMcpRequest } from './mcp.mjs';

const SID_FROM_PATH = /^\/bridge\/([0-9a-f]{32})$/;

export function sidFromPath(pathname) {
    const m = SID_FROM_PATH.exec(pathname);
    return m ? m[1] : null;
}

/** Access tokens are `<sid>.<random>`; the sid routes to this object. */
export function sidFromToken(token) {
    const m = /^([0-9a-f]{32})\.[A-Za-z0-9_-]{16,}$/.exec(token || '');
    return m ? m[1] : null;
}

export class BridgeSessionObject {
    // `deps` is for tests: WebSocketPair, upgradeResponse, verifyPendingAuth,
    // clock and log can all be replaced.
    constructor(state, env = {}, deps = {}) {
        this.env = env;
        this.deps = deps;
        this.session = null;
    }

    _session(sid, url) {
        if (!this.session) {
            this.session = new BridgeSession({
                sid,
                relayOrigin: this.env.RELAY_ORIGIN || url.origin,
                verifyPendingAuth: this.deps.verifyPendingAuth,
                clock: this.deps.clock,
                log: this.deps.log,
            });
        }
        return this.session.sid === sid ? this.session : null;
    }

    async _mcp(request, url) {
        const metadata = `${this.env.PUBLIC_ORIGIN || url.origin}/.well-known/oauth-protected-resource`;
        const sid = sidFromToken(bearerToken(request));
        // No sid in the token: nothing to look up, same answer as a bad token.
        const session = sid ? this._session(sid, url) : null;
        return handleMcpRequest(request, session, {
            resourceMetadataUrl: metadata,
        });
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/mcp') return this._mcp(request, url);
        const upgrade = request.headers.get('Upgrade');
        if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
            return new Response('Expected a WebSocket upgrade', {
                status: 426,
            });
        }
        const sid = sidFromPath(url.pathname);
        if (!sid) return new Response('Not found', { status: 404 });
        if (!this._session(sid, url)) {
            return new Response('Not found', { status: 404 });
        }

        const Pair = this.deps.WebSocketPair || globalThis.WebSocketPair;
        const { 0: client, 1: server } = new Pair();
        server.accept();
        const session = this.session;
        const socket = {
            send: (text) => server.send(text),
            close: (code, reason) => server.close(code, reason),
            // Workers expose no protocol-level ping, so the 20 s keepalive is
            // a small application frame the browser host ignores.
            ping: () =>
                server.send(JSON.stringify({ v: 1, type: 'PING', sid })),
        };
        session.attach(socket);
        server.addEventListener('message', (event) => {
            session.handleMessage(socket, event.data);
        });
        const closed = () => session.handleClose(socket);
        server.addEventListener('close', closed);
        server.addEventListener('error', closed);

        return this.deps.upgradeResponse
            ? this.deps.upgradeResponse(client)
            : new Response(null, { status: 101, webSocket: client });
    }
}
