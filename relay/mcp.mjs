/**
 * Streamable HTTP /mcp for the relay (#511, design §2, §4, §6).
 *
 * Stateless JSON: every POST carries one JSON-RPC message and is answered with
 * application/json (no SSE stream, no Mcp-Session-Id), so GET and DELETE are
 * 405. `tools/call` is forwarded to the browser as a CALL frame; the browser
 * stays the policy enforcement point, the relay only filters by the *approved*
 * scope, never the requested one. No request or response bodies are logged.
 */
import { toolsForScope } from '../app/bridge-scope.mjs';
import catalog from './tool-catalog.json' with { type: 'json' };

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26'];
export const MAX_BODY_BYTES = 64 * 1024;
const SERVER_INFO = { name: 'fire-bridge', version: '1' };

const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};

const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({
    jsonrpc: '2.0',
    id,
    error: { code, message },
});

function json(body, status = 200, extra = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...JSON_HEADERS, ...extra },
    });
}

export function bearerToken(request) {
    const h = request.headers.get('Authorization') || '';
    const m = /^Bearer ([A-Za-z0-9._~+/=-]{1,512})$/.exec(h);
    return m ? m[1] : null;
}

/** 401 that points the client at the protected-resource metadata. */
export function unauthorized(resourceMetadataUrl, invalidToken) {
    const error = invalidToken ? ', error="invalid_token"' : '';
    return json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"${error}`,
    });
}

function toolResult(text, isError) {
    return { content: [{ type: 'text', text }], isError };
}

const ERROR_TEXT = {
    timeout: 'fire did not answer in time',
    rate_limited: 'rate_limited',
    result_too_large: 'result_too_large',
};

async function callTool(session, params) {
    const name = params && params.name;
    const allowed = toolsForScope(session.scope);
    // Unlisted means uncallable: same error as an unknown tool.
    if (typeof name !== 'string' || !allowed.has(name)) {
        return { rpcError: [-32602, 'Unknown tool'] };
    }
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return { rpcError: [-32602, 'arguments must be an object'] };
    }
    try {
        const res = await session.dispatchCall(name, args);
        if (res.ok) {
            return { result: toolResult(JSON.stringify(res.content), false) };
        }
        return { result: toolResult(String(res.error), true) };
    } catch (err) {
        const code = err && err.code;
        if (code === 'invalid_token') return { unauthorized: true };
        if (ERROR_TEXT[code]) {
            return { result: toolResult(ERROR_TEXT[code], true) };
        }
        return { result: toolResult('internal_error', true) };
    }
}

/** One JSON-RPC request. Resolves to {response}, {unauthorized} or {none}. */
async function handleRpc(session, msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        return { response: rpcErr(null, -32600, 'Invalid Request') };
    }
    const isNotification = msg.id === undefined;
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        // A response or malformed message from the client: accept and ignore.
        return isNotification
            ? { none: true }
            : { response: rpcErr(msg.id ?? null, -32600, 'Invalid Request') };
    }
    if (isNotification) return { none: true };
    const { id, method, params } = msg;
    switch (method) {
        case 'initialize': {
            const asked = params && params.protocolVersion;
            const protocolVersion = SUPPORTED_VERSIONS.includes(asked)
                ? asked
                : SUPPORTED_VERSIONS[0];
            return {
                response: rpcOk(id, {
                    protocolVersion,
                    capabilities: { tools: {} },
                    serverInfo: SERVER_INFO,
                }),
            };
        }
        case 'ping':
            return { response: rpcOk(id, {}) };
        case 'tools/list': {
            const allowed = toolsForScope(session.scope);
            const tools = catalog.filter((t) => allowed.has(t.name));
            return { response: rpcOk(id, { tools }) };
        }
        case 'tools/call': {
            const out = await callTool(session, params);
            if (out.unauthorized) return { unauthorized: true };
            if (out.rpcError) {
                return { response: rpcErr(id, ...out.rpcError) };
            }
            return { response: rpcOk(id, out.result) };
        }
        default:
            return { response: rpcErr(id, -32601, 'Method not found') };
    }
}

/**
 * @param {Request} request
 * @param {import('./session.mjs').BridgeSession|null} session
 * @param {{resourceMetadataUrl: string}} opts
 */
export async function handleMcpRequest(request, session, opts) {
    const { resourceMetadataUrl } = opts;
    if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    }
    // A browser has no business calling /mcp: refuse cross-origin requests.
    if (request.headers.has('Origin')) {
        return json({ error: 'forbidden' }, 403);
    }
    const token = bearerToken(request);
    if (!token || !session || !(await session.verifyToken(token))) {
        return unauthorized(resourceMetadataUrl, !!token);
    }
    const version = request.headers.get('MCP-Protocol-Version');
    if (version && !SUPPORTED_VERSIONS.includes(version)) {
        return json({ error: 'unsupported_protocol_version' }, 400);
    }
    const type = (request.headers.get('Content-Type') || '').toLowerCase();
    if (!type.startsWith('application/json')) {
        return json({ error: 'unsupported_media_type' }, 415);
    }
    const declared = Number(request.headers.get('Content-Length'));
    if (declared > MAX_BODY_BYTES) {
        return json({ error: 'payload_too_large' }, 413);
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
        return json({ error: 'payload_too_large' }, 413);
    }
    let msg;
    try {
        msg = JSON.parse(text);
    } catch {
        return json(rpcErr(null, -32700, 'Parse error'), 400);
    }
    const out = await handleRpc(session, msg);
    if (out.unauthorized) return unauthorized(resourceMetadataUrl, true);
    if (out.none) return new Response(null, { status: 202 });
    const bad = out.response.error && out.response.error.code === -32600;
    return json(out.response, bad ? 400 : 200);
}
