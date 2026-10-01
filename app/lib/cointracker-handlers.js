'use strict';

// Transport-agnostic CoinTracker handlers shared by the Express routes
// (app/routes/cointracker.js) and the Netlify Function
// (netlify/functions/cointracker.mjs). Each returns {status, body} or
// {redirect, cookie}; the wrappers turn those into responses.
//
// Flow: authorize → CoinTracker login → callback seals the tokens with
// SYNC_MASTER_KEY and hands the blob to the SPA in the URL fragment →
// the SPA posts the blob back to /sync, /inspect and /disconnect. No
// CoinTracker token or data is stored server-side in either runtime.

const crypto = require('crypto');
const ct = require('./cointracker-connector');

const COOKIE_NAME = 'cointracker_oauth';
const COOKIE_PATH = '/api/sync/cointracker';

function pendingCookie(value, secure, maxAge = 600) {
    return `${COOKIE_NAME}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function notConfigured() {
    console.error('[CoinTracker] SYNC_MASTER_KEY is missing or malformed.');
    return {
        status: 503,
        body: {
            error: 'CoinTracker connection is not configured on this server.',
        },
    };
}

// authorize is a top-level navigation, so failures go back to the SPA as
// a fragment rather than leaving the user on a bare JSON page.
async function authorize({ origin }, fetchImpl = fetch) {
    if (!ct.isConfigured()) {
        notConfigured();
        return { redirect: '/#cointracker-error=not_configured' };
    }
    const redirectUri = ct.redirectUriFor(origin);
    let clientId;
    try {
        clientId = await ct.registerClient(redirectUri, fetchImpl);
    } catch (err) {
        console.error('[CoinTracker] Client registration failed:', err.message);
        return { redirect: '/#cointracker-error=registration_failed' };
    }
    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = ct.createPkce();
    return {
        redirect: ct.buildAuthorizationUrl({
            clientId,
            redirectUri,
            state,
            challenge,
        }),
        cookie: pendingCookie(
            ct.sealPending({ state, verifier, clientId, redirectUri }),
            origin.startsWith('https:'),
        ),
    };
}

async function callback({ params, cookieValue, origin }, fetchImpl = fetch) {
    const clear = pendingCookie('', origin.startsWith('https:'), 0);
    const back = (fragment) => ({ redirect: `/#${fragment}`, cookie: clear });
    if (!ct.isConfigured()) return back('cointracker-error=not_configured');
    const pending = ct.unsealPending(cookieValue);
    if (!pending || !ct.statesMatch(params.get('state'), pending.state)) {
        return back('cointracker-error=invalid_state');
    }
    const code = params.get('code');
    if (!code) return back('cointracker-error=access_denied');
    try {
        const tokens = await ct.exchangeCode(
            {
                code,
                verifier: pending.verifier,
                clientId: pending.clientId,
                redirectUri: pending.redirectUri,
            },
            fetchImpl,
        );
        return back(
            `cointracker-connected=${encodeURIComponent(ct.sealTokens(tokens))}`,
        );
    } catch (err) {
        console.error('[CoinTracker] Token exchange failed:', err.message);
        return back('cointracker-error=exchange_failed');
    }
}

// Shared error mapping: dead/unreadable grants are 401 with a `code` that
// tells the SPA to drop its blob; everything else keeps the connection.
function errorResult(err) {
    if (err.status === 401 || err.code === 'cointracker_forbidden') {
        return {
            status: err.status === 401 ? 401 : 403,
            body: {
                error: err.message,
                code:
                    err.code === 'unauthorized'
                        ? 'cointracker_revoked'
                        : err.code,
            },
        };
    }
    console.error('[CoinTracker] Request failed:', err.code, err.message);
    return {
        status: 502,
        body: {
            error: err.message || 'CoinTracker request failed.',
            code: err.code || 'mcp_failed',
        },
    };
}

function readTokens(body) {
    return ct.unsealTokens(body?.token);
}

async function sync({ body }, fetchImpl = fetch) {
    if (!ct.isConfigured()) return notConfigured();
    try {
        const result = await ct.syncWallets(readTokens(body), fetchImpl);
        return {
            status: 200,
            body: {
                status: 'success',
                tool: result.tool,
                wallets: result.wallets,
                warnings: result.warnings,
                syncedAt: new Date().toISOString(),
                ...(result.refreshed
                    ? { token: ct.sealTokens(result.tokens) }
                    : {}),
            },
        };
    } catch (err) {
        return errorResult(err);
    }
}

// Diagnostics: the tool catalog (names, descriptions, argument names) with
// no portfolio data, so the balance-tool choice can be checked or pinned.
async function inspect({ body }, fetchImpl = fetch) {
    if (!ct.isConfigured()) return notConfigured();
    try {
        const result = await ct.inspectTools(readTokens(body), fetchImpl);
        return {
            status: 200,
            body: {
                tools: result.tools,
                selected: ct.chooseBalanceTool(result.tools)?.name || null,
                ...(result.refreshed
                    ? { token: ct.sealTokens(result.tokens) }
                    : {}),
            },
        };
    } catch (err) {
        return errorResult(err);
    }
}

async function disconnect({ body }, fetchImpl = fetch) {
    if (!ct.isConfigured()) return notConfigured();
    let tokens = null;
    try {
        tokens = readTokens(body);
    } catch {
        /* unreadable blob: nothing to revoke, the SPA drops it anyway */
    }
    const revoked = tokens ? await ct.revokeTokens(tokens, fetchImpl) : false;
    return { status: 200, body: { status: 'disconnected', revoked } };
}

module.exports = {
    COOKIE_NAME,
    authorize,
    callback,
    sync,
    inspect,
    disconnect,
};
