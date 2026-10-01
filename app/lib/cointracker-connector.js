'use strict';

// CoinTracker connector: OAuth 2.1 (PKCE + dynamic client registration)
// against CoinTracker's Auth0 tenant, and a minimal read-only MCP client
// for https://mcp.cointracker.com/mcp. CoinTracker has no public REST API
// or personal read token; its MCP server is the only programmatic surface,
// and it accepts nothing but OAuth bearer tokens (scope `mcp:read`).
//
// Shared by the Express routes (app/routes/cointracker.js) and the Netlify
// Function (netlify/functions/cointracker.mjs). Tokens are never stored
// server-side: they travel to the browser sealed with SYNC_MASTER_KEY and
// come back on every call, so both runtimes are stateless.
//
// fire only reads wallets and their current balances. P&L, cost basis and
// tax lots stay in CoinTracker.

const crypto = require('crypto');
const { encrypt, decrypt } = require('./crypto-utils');

const MCP_URL =
    process.env.COINTRACKER_MCP_URL || 'https://mcp.cointracker.com/mcp';
const AUTH_BASE = (
    process.env.COINTRACKER_AUTH_BASE || 'https://login.cointracker.com'
).replace(/\/$/, '');
const ENDPOINTS = {
    authorize: `${AUTH_BASE}/authorize`,
    token: `${AUTH_BASE}/oauth/token`,
    register: `${AUTH_BASE}/oidc/register`,
    revoke: `${AUTH_BASE}/oauth/revoke`,
};
// Auth0 only issues a JWT for an API when the authorize request names it
// as `audience`; without one it returns an opaque token for /userinfo,
// which the MCP server rejects. RFC 8707 `resource` is sent too, but Auth0
// honors it only with its resource-parameter profile enabled.
// COINTRACKER_AUDIENCE overrides the value; `none` omits the parameter.
const AUDIENCE =
    process.env.COINTRACKER_AUDIENCE === 'none'
        ? null
        : process.env.COINTRACKER_AUDIENCE || MCP_URL;
// offline_access yields a refresh token so the connection outlives the
// short-lived access token.
const SCOPE = 'mcp:read offline_access';
// CoinTracker sits behind Cloudflare bot rules that reject the default
// Node/undici user agent (403); a named client UA is allowed.
const USER_AGENT = 'fire-tracker/1.1 (+https://github.com/nitsuah/fire)';
const MCP_PROTOCOL_VERSION = '2025-06-18';
const TOKEN_VERSION = 1;
const PENDING_TTL_MS = 10 * 60 * 1000;
// Refresh a little early so a token can't expire mid-sync.
const EXPIRY_SKEW_MS = 60 * 1000;
const CALLBACK_PATH = '/api/sync/cointracker/callback';
// Every CoinTracker request is bounded, so a stalled upstream can't hang
// the handler (or the browser's Sync button) indefinitely.
const REQUEST_TIMEOUT_MS = 15 * 1000;

function timeoutSignal() {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function connectorError(message, code, status) {
    return Object.assign(new Error(message), { code, status });
}

function isConfigured() {
    return /^[0-9a-f]{64}$/i.test(process.env.SYNC_MASTER_KEY || '');
}

function redirectUriFor(origin) {
    return process.env.COINTRACKER_REDIRECT_URI || `${origin}${CALLBACK_PATH}`;
}

function base64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

function createPkce() {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(
        crypto.createHash('sha256').update(verifier).digest(),
    );
    return { verifier, challenge };
}

async function readJson(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return { raw: text.slice(0, 200) };
    }
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

// A pre-registered public client wins; otherwise register one with
// CoinTracker's dynamic client registration endpoint (what every MCP client
// does). The client_id rides inside the sealed token so refreshes reuse it.
async function registerClient(redirectUri, fetchImpl = fetch) {
    if (process.env.COINTRACKER_CLIENT_ID)
        return process.env.COINTRACKER_CLIENT_ID;
    const res = await fetchImpl(ENDPOINTS.register, {
        signal: timeoutSignal(),
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
            client_name: 'fire tracker',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        }),
    });
    const body = await readJson(res);
    if (!res.ok || !body.client_id) {
        throw connectorError(
            `CoinTracker client registration failed (HTTP ${res.status}).`,
            'registration_failed',
            502,
        );
    }
    return body.client_id;
}

function buildAuthorizationUrl({ clientId, redirectUri, state, challenge }) {
    const url = new URL(ENDPOINTS.authorize);
    url.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        // RFC 8707: bind the token to the MCP server.
        resource: MCP_URL,
        ...(AUDIENCE ? { audience: AUDIENCE } : {}),
    }).toString();
    return url.toString();
}

function normalizeTokenResponse(body, clientId, previous = {}) {
    if (!body.access_token) {
        throw connectorError(
            'CoinTracker returned no access token.',
            'exchange_failed',
            502,
        );
    }
    const expiresIn = Number(body.expires_in);
    return {
        v: TOKEN_VERSION,
        client_id: clientId,
        access_token: body.access_token,
        // Auth0 rotates refresh tokens; keep the old one if none came back.
        refresh_token: body.refresh_token || previous.refresh_token || null,
        expires_at: Number.isFinite(expiresIn)
            ? Date.now() + expiresIn * 1000
            : null,
        connected_at: previous.connected_at || new Date().toISOString(),
    };
}

async function tokenRequest(params, fetchImpl) {
    const res = await fetchImpl(ENDPOINTS.token, {
        signal: timeoutSignal(),
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams(params).toString(),
    });
    const body = await readJson(res);
    if (!res.ok) {
        const revoked =
            body.error === 'invalid_grant' ||
            body.error === 'unauthorized_client';
        throw connectorError(
            revoked
                ? 'CoinTracker access was revoked or has expired. Reconnect CoinTracker.'
                : `CoinTracker token request failed (HTTP ${res.status}).`,
            revoked ? 'cointracker_revoked' : 'token_request_failed',
            revoked ? 401 : 502,
        );
    }
    return body;
}

async function exchangeCode(
    { code, verifier, clientId, redirectUri },
    fetchImpl = fetch,
) {
    const body = await tokenRequest(
        {
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
            client_id: clientId,
            redirect_uri: redirectUri,
            resource: MCP_URL,
        },
        fetchImpl,
    );
    return normalizeTokenResponse(body, clientId);
}

async function refreshTokens(tokens, fetchImpl = fetch) {
    if (!tokens.refresh_token) {
        throw connectorError(
            'CoinTracker session expired. Reconnect CoinTracker.',
            'cointracker_revoked',
            401,
        );
    }
    const body = await tokenRequest(
        {
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: tokens.client_id,
            resource: MCP_URL,
        },
        fetchImpl,
    );
    return normalizeTokenResponse(body, tokens.client_id, tokens);
}

// Best effort: the grant is dropped in the browser either way.
async function revokeTokens(tokens, fetchImpl = fetch) {
    if (!tokens?.refresh_token) return false;
    try {
        const res = await fetchImpl(ENDPOINTS.revoke, {
            signal: timeoutSignal(),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT,
            },
            body: JSON.stringify({
                client_id: tokens.client_id,
                token: tokens.refresh_token,
            }),
        });
        return res.ok;
    } catch {
        return false;
    }
}

// Non-secret shape of an access token, for diagnosing a 401: whether it
// is a JWT (and its audience/scope/issuer) or an opaque/encrypted token.
// Never includes the token, its signature or the subject.
function describeToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length === 5) return { format: 'jwe (opaque, encrypted)' };
    if (parts.length !== 3) return { format: 'opaque' };
    try {
        const claims = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf8'),
        );
        return {
            format: 'jwt',
            aud: claims.aud ?? null,
            scope: claims.scope ?? claims.scp ?? null,
            iss: claims.iss ?? null,
        };
    } catch {
        return { format: 'unparseable jwt' };
    }
}

// ─── Sealed blobs (token + pending OAuth state) ──────────────────────────────

function sealTokens(tokens) {
    return encrypt(JSON.stringify(tokens));
}

function unsealTokens(blob) {
    try {
        const tokens = JSON.parse(decrypt(String(blob || '')));
        if (tokens?.v !== TOKEN_VERSION || !tokens.access_token)
            throw new Error('bad token');
        return tokens;
    } catch {
        throw connectorError(
            'Stored CoinTracker connection is unreadable. Reconnect CoinTracker.',
            'cointracker_token_invalid',
            401,
        );
    }
}

// The PKCE verifier and CSRF state live in an encrypted, HttpOnly cookie
// between authorize and callback, so neither runtime needs a session store.
function sealPending(pending) {
    return encrypt(
        JSON.stringify({ ...pending, exp: Date.now() + PENDING_TTL_MS }),
    );
}

function unsealPending(value) {
    try {
        const pending = JSON.parse(decrypt(String(value || '')));
        if (!pending.state || !pending.verifier || pending.exp < Date.now())
            return null;
        return pending;
    } catch {
        return null;
    }
}

function statesMatch(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length)
        return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── MCP (Streamable HTTP, JSON-RPC) ─────────────────────────────────────────

// Streamable HTTP may answer a POST with plain JSON or an SSE stream; take
// the JSON-RPC message whose id matches the request.
function parseRpcResponse(text, contentType, id) {
    if (!/text\/event-stream/i.test(contentType || '')) {
        return text ? JSON.parse(text) : null;
    }
    for (const event of text.split(/\r?\n\r?\n/)) {
        const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
        if (!data) continue;
        try {
            const msg = JSON.parse(data);
            if (msg && msg.id === id) return msg;
        } catch {
            /* keep scanning */
        }
    }
    return null;
}

function createMcpSession(accessToken, fetchImpl = fetch) {
    let sessionId = null;
    let nextId = 1;

    async function post(message) {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': USER_AGENT,
            'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        };
        if (sessionId) headers['Mcp-Session-Id'] = sessionId;
        const res = await fetchImpl(MCP_URL, {
            signal: timeoutSignal(),
            method: 'POST',
            headers,
            body: JSON.stringify(message),
        });
        if (res.status === 401) {
            const err = connectorError(
                'CoinTracker rejected the access token.',
                'unauthorized',
                401,
            );
            err.diagnostic = describeToken(accessToken);
            throw err;
        }
        if (res.status === 403) {
            throw connectorError(
                'CoinTracker denied MCP access. CoinTracker MCP may require a paid plan or early access.',
                'cointracker_forbidden',
                403,
            );
        }
        if (!res.ok && res.status !== 202) {
            throw connectorError(
                `CoinTracker MCP request failed (HTTP ${res.status}).`,
                'mcp_failed',
                502,
            );
        }
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        return res;
    }

    async function request(method, params = {}) {
        const id = nextId++;
        const res = await post({ jsonrpc: '2.0', id, method, params });
        const msg = parseRpcResponse(
            await res.text(),
            res.headers.get('content-type'),
            id,
        );
        if (!msg) {
            throw connectorError(
                `CoinTracker MCP returned no response to ${method}.`,
                'mcp_failed',
                502,
            );
        }
        if (msg.error) {
            throw connectorError(
                `CoinTracker MCP ${method} failed: ${msg.error.message || 'error'}`,
                'mcp_failed',
                502,
            );
        }
        return msg.result;
    }

    return {
        async initialize() {
            const result = await request('initialize', {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: 'fire-tracker', version: '1.1.0' },
            });
            await post({
                jsonrpc: '2.0',
                method: 'notifications/initialized',
            });
            return result;
        },
        async listTools() {
            const tools = [];
            let cursor;
            // Bounded: a misbehaving server can't loop us forever.
            for (let page = 0; page < 10; page++) {
                const result = await request(
                    'tools/list',
                    cursor ? { cursor } : {},
                );
                tools.push(...(result?.tools || []));
                cursor = result?.nextCursor;
                if (!cursor) break;
            }
            return tools;
        },
        callTool(name, args = {}) {
            return request('tools/call', { name, arguments: args });
        },
    };
}

// ─── Tool selection + normalization ──────────────────────────────────────────

// CoinTracker doesn't publish its MCP tool catalog, so pick the tool by
// name/description: it should be about wallets or accounts *and* balances
// or holdings, take no required arguments, and not be about transactions,
// tax or gains. COINTRACKER_BALANCE_TOOL pins an exact tool name.
function scoreTool(tool) {
    const name = String(tool?.name || '').toLowerCase();
    const text = `${name} ${String(tool?.description || '').toLowerCase()}`;
    const required = tool?.inputSchema?.required || [];
    if (required.length) return -1;
    let score = 0;
    if (/wallet|account|connection|source|integration/.test(text)) score += 3;
    if (/balance|holding|portfolio|position/.test(text)) score += 3;
    if (/wallet|account/.test(name)) score += 2;
    if (/balance|holding/.test(name)) score += 2;
    if (/transaction|tax|gain|loss|lot|cost.?basis|history|report/.test(name))
        score -= 6;
    return score;
}

function chooseBalanceTool(tools) {
    const pinned = process.env.COINTRACKER_BALANCE_TOOL;
    if (pinned) return tools.find((t) => t.name === pinned) || null;
    let best = null;
    let bestScore = 3;
    for (const tool of tools) {
        const score = scoreTool(tool);
        if (score > bestScore) {
            best = tool;
            bestScore = score;
        }
    }
    return best;
}

function extractPayload(result) {
    if (result?.isError) {
        const text = (result.content || [])
            .map((c) => c.text)
            .filter(Boolean)
            .join(' ');
        throw connectorError(
            `CoinTracker tool error: ${text.slice(0, 200) || 'unknown'}`,
            'mcp_failed',
            502,
        );
    }
    if (result?.structuredContent) return result.structuredContent;
    for (const part of result?.content || []) {
        if (part.type !== 'text' || !part.text) continue;
        try {
            return JSON.parse(part.text);
        } catch {
            /* not JSON; try the next part */
        }
    }
    throw connectorError(
        'CoinTracker returned balances fire cannot read (no JSON content).',
        'unparseable',
        502,
    );
}

const VALUE_KEYS = [
    'usd_value',
    'value_usd',
    'usdValue',
    'valueUsd',
    'fiat_value',
    'fiatValue',
    'total_value',
    'totalValue',
    'market_value',
    'marketValue',
    'balance_usd',
    'current_value',
    'currentValue',
    'value',
];
const NAME_KEYS = [
    'name',
    'label',
    'display_name',
    'displayName',
    'wallet_name',
    'nickname',
    'exchange',
    'integration',
    'source',
];
const HOLDING_KEYS = ['holdings', 'balances', 'assets', 'positions', 'tokens'];
const ADDRESS_KEYS = [
    'address',
    'public_address',
    'publicAddress',
    'wallet_address',
    'walletAddress',
    'addresses',
    'ens',
    'ens_name',
    'ensName',
];
const CHAIN_KEYS = ['blockchain', 'chain', 'network', 'chains', 'networks'];

// "$1,234.56", 1234.56, {amount: "1234.56"} → 1234.56; anything else → null.
function toNumber(value) {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const n = Number(value.replace(/[$,\s]/g, ''));
        return value.trim() && Number.isFinite(n) ? n : null;
    }
    if (typeof value === 'object') {
        return toNumber(value.amount ?? value.value ?? value.usd);
    }
    return null;
}

function firstNumber(obj, keys) {
    for (const key of keys) {
        const n = toNumber(obj?.[key]);
        if (n !== null) return n;
    }
    return null;
}

function firstString(obj, keys) {
    for (const key of keys) {
        const v = obj?.[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (v && typeof v === 'object' && typeof v.name === 'string')
            return v.name.trim();
    }
    return null;
}

function collectStrings(obj, keys) {
    const out = new Set();
    for (const key of keys) {
        const v = obj?.[key];
        const list = Array.isArray(v) ? v : [v];
        for (const item of list) {
            if (typeof item === 'string' && item.trim()) out.add(item.trim());
            else if (item && typeof item === 'object') {
                const s = item.address || item.name || item.id;
                if (typeof s === 'string' && s.trim()) out.add(s.trim());
            }
        }
    }
    return [...out];
}

function normalizeHolding(h) {
    if (!h || typeof h !== 'object') return null;
    const symbol =
        firstString(h, ['symbol', 'ticker', 'currency', 'asset_symbol']) ||
        firstString(h.asset || h.currency || {}, ['symbol', 'ticker']) ||
        null;
    const quantity = firstNumber(h, ['amount', 'quantity', 'balance', 'units']);
    const usdValue = firstNumber(h, VALUE_KEYS);
    if (!symbol && usdValue === null) return null;
    return { symbol: symbol ? symbol.toUpperCase() : null, quantity, usdValue };
}

function looksLikeWallet(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 0;
    let score = 0;
    if (firstString(item, NAME_KEYS)) score++;
    if (collectStrings(item, ADDRESS_KEYS).length) score += 2;
    if (firstNumber(item, VALUE_KEYS) !== null) score++;
    if (HOLDING_KEYS.some((k) => Array.isArray(item[k]))) score += 2;
    if (collectStrings(item, CHAIN_KEYS).length) score++;
    return score;
}

// Find the array of wallet/account-like objects anywhere in the payload.
function findWalletArray(payload, depth = 0) {
    if (depth > 4 || payload == null) return null;
    if (Array.isArray(payload)) {
        const objs = payload.filter((x) => x && typeof x === 'object');
        if (objs.length && objs.every((x) => looksLikeWallet(x) >= 2))
            return objs;
        return null;
    }
    if (typeof payload !== 'object') return null;
    for (const key of [
        'wallets',
        'accounts',
        'connections',
        'sources',
        'data',
        'items',
        'results',
    ]) {
        const hit = findWalletArray(payload[key], depth + 1);
        if (hit) return hit;
    }
    for (const value of Object.values(payload)) {
        const hit = findWalletArray(value, depth + 1);
        if (hit) return hit;
    }
    return null;
}

function stableId(name, addresses) {
    return crypto
        .createHash('sha256')
        .update(
            `${name}|${addresses
                .map((a) => a.toLowerCase())
                .sort()
                .join(',')}`,
        )
        .digest('hex')
        .slice(0, 16);
}

// Provider-neutral wallet records: one per CoinTracker wallet/account, with
// its addresses, chains, current USD value and per-asset holdings.
function normalizeWallets(payload) {
    const items = findWalletArray(payload) || [];
    const wallets = [];
    const warnings = [];
    const skippedProviderIds = [];
    for (const item of items) {
        const name = firstString(item, NAME_KEYS) || 'CoinTracker wallet';
        const addresses = collectStrings(item, ADDRESS_KEYS);
        const holdingsRaw = HOLDING_KEYS.map((k) => item[k]).find(
            Array.isArray,
        );
        const holdings = (holdingsRaw || [])
            .map(normalizeHolding)
            .filter(Boolean);
        const holdingsTotal = holdings.some((h) => h.usdValue !== null)
            ? holdings.reduce((s, h) => s + (h.usdValue || 0), 0)
            : null;
        const usdValue = firstNumber(item, VALUE_KEYS) ?? holdingsTotal;
        const providerId = String(
            item.id ??
                item.wallet_id ??
                item.account_id ??
                item.uuid ??
                stableId(name, addresses),
        );
        if (usdValue === null) {
            // Still in CoinTracker, so its existing row is kept, not dropped.
            skippedProviderIds.push(providerId);
            warnings.push(
                `Skipped "${name}": no USD value in CoinTracker's response.`,
            );
            continue;
        }
        wallets.push({
            providerId,
            name,
            kind: firstString(item, [
                'type',
                'kind',
                'source_type',
                'category',
            ]),
            chains: collectStrings(item, CHAIN_KEYS),
            addresses,
            usdValue: Math.round(usdValue * 100) / 100,
            holdings,
        });
    }
    if (!items.length) {
        warnings.push(
            'CoinTracker returned no wallets or accounts fire could recognize.',
        );
    }
    // partial: nothing was recognized, so absence proves nothing.
    return { wallets, warnings, skippedProviderIds, partial: !items.length };
}

function summarizeTools(tools) {
    return tools.map((t) => ({
        name: t.name,
        description: String(t.description || '').slice(0, 300),
        arguments: Object.keys(t.inputSchema?.properties || {}),
        required: t.inputSchema?.required || [],
        score: scoreTool(t),
    }));
}

// ─── High-level operations ───────────────────────────────────────────────────

// Runs `fn(session)` with a fresh access token, refreshing first when the
// token is (nearly) expired and once more if CoinTracker answers 401.
async function withSession(tokens, fn, fetchImpl = fetch) {
    let current = tokens;
    let refreshed = false;
    if (
        current.expires_at &&
        current.expires_at - EXPIRY_SKEW_MS < Date.now()
    ) {
        current = await refreshTokens(current, fetchImpl);
        refreshed = true;
    }
    const run = async () => {
        const session = createMcpSession(current.access_token, fetchImpl);
        await session.initialize();
        return fn(session);
    };
    // Auth0 rotates refresh tokens: once refreshed, the old blob is dead,
    // so any later failure must still hand the new grant back (err.tokens).
    const withTokens = (err) => {
        if (refreshed) err.tokens = current;
        return err;
    };
    let result;
    try {
        result = await run();
    } catch (err) {
        if (err.code !== 'unauthorized' || refreshed) throw withTokens(err);
        current = await refreshTokens(current, fetchImpl);
        refreshed = true;
        try {
            result = await run();
        } catch (retryErr) {
            throw withTokens(retryErr);
        }
    }
    return { result, tokens: current, refreshed };
}

async function syncWallets(tokens, fetchImpl = fetch) {
    const {
        result,
        tokens: current,
        refreshed,
    } = await withSession(
        tokens,
        async (session) => {
            const tools = await session.listTools();
            const tool = chooseBalanceTool(tools);
            if (!tool) {
                throw connectorError(
                    'CoinTracker exposes no wallet-balance tool fire recognizes. Use "Inspect tools" and set COINTRACKER_BALANCE_TOOL.',
                    'no_balance_tool',
                    502,
                );
            }
            const payload = extractPayload(
                await session.callTool(tool.name, {}),
            );
            return { tool: tool.name, ...normalizeWallets(payload) };
        },
        fetchImpl,
    );
    return { ...result, tokens: current, refreshed };
}

async function inspectTools(tokens, fetchImpl = fetch) {
    const {
        result,
        tokens: current,
        refreshed,
    } = await withSession(
        tokens,
        async (session) => {
            const raw = await session.listTools();
            return {
                tools: summarizeTools(raw),
                selected: chooseBalanceTool(raw)?.name || null,
            };
        },
        fetchImpl,
    );
    return { ...result, tokens: current, refreshed };
}

module.exports = {
    MCP_URL,
    ENDPOINTS,
    SCOPE,
    AUDIENCE,
    USER_AGENT,
    CALLBACK_PATH,
    isConfigured,
    redirectUriFor,
    createPkce,
    registerClient,
    buildAuthorizationUrl,
    exchangeCode,
    refreshTokens,
    revokeTokens,
    sealTokens,
    unsealTokens,
    sealPending,
    unsealPending,
    statesMatch,
    describeToken,
    parseRpcResponse,
    createMcpSession,
    scoreTool,
    chooseBalanceTool,
    extractPayload,
    toNumber,
    normalizeWallets,
    summarizeTools,
    syncWallets,
    inspectTools,
};
