'use strict';

// Transport-agnostic CoinTracker handlers shared by the Express routes
// (app/routes/cointracker.js) and the Netlify Function
// (netlify/functions/cointracker.mjs). Each returns {status, body} or
// {redirect}, plus `cookies` (Set-Cookie values); the wrappers turn those
// into responses.
//
// Flow: authorize → CoinTracker login → callback seals the tokens with
// SYNC_MASTER_KEY into an HttpOnly cookie (app/lib/grant-cookie.js) and tells
// the SPA `cointracker-connected=cookie` → /sync, /inspect, /status and
// /disconnect read the grant from that cookie. No CoinTracker token or data
// is stored server-side in either runtime, and page scripts never see it.

const crypto = require('./node-crypto');
const ct = require('./cointracker-connector');
const { cleanNonce, nonceSuffix } = require('./oauth-nonce');
const grant = require('./grant-cookie');

const COOKIE_NAME = 'cointracker_oauth';
const COOKIE_PATH = '/api/sync/cointracker';
const GRANT_COOKIE = 'cointracker_grant';

// The sealed grant for a request: the cookie, or a blob a client from before
// the cookie move still sends in the body or Authorization header.
function pick({ cookieHeader, legacy }) {
    return grant.pickGrant(cookieHeader, GRANT_COOKIE, legacy);
}

// Moves any sealed `token` a handler produced into the cookie, adopts a
// readable legacy blob, and clears the cookie when the grant is dead (401).
// The SPA keeps only the marker.
function settle(result, picked, secure) {
    const body = result.body || {};
    let cookies = [];
    if (result.status === 401) {
        cookies = grant.clearGrantCookies(GRANT_COOKIE, COOKIE_PATH, {
            secure,
        });
        delete body.token;
    } else if (body.token) {
        cookies = grant.grantCookies(GRANT_COOKIE, COOKIE_PATH, body.token, {
            secure,
        });
        body.token = grant.GRANT_MARKER;
    } else if (picked.adopted && result.status === 200) {
        cookies = grant.grantCookies(GRANT_COOKIE, COOKIE_PATH, picked.sealed, {
            secure,
        });
        body.token = grant.GRANT_MARKER;
    } else if (picked.stale && result.status === 200) {
        // A cookie already holds the grant: never overwrite it with the
        // (possibly older) blob the client sent; just tell it to drop the blob.
        body.token = grant.GRANT_MARKER;
    }
    return { ...result, body, cookies };
}

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
async function authorize({ origin, nonce }, fetchImpl = fetch) {
    if (!ct.isConfigured()) {
        notConfigured();
        return {
            redirect: `/#cointracker-error=not_configured${nonceSuffix(nonce)}`,
        };
    }
    const redirectUri = ct.redirectUriFor(origin);
    let clientId;
    try {
        clientId = await ct.registerClient(redirectUri, fetchImpl);
    } catch (err) {
        console.error('[CoinTracker] Client registration failed:', err.message);
        return {
            redirect: `/#cointracker-error=registration_failed${nonceSuffix(nonce)}`,
        };
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
            ct.sealPending({
                state,
                verifier,
                clientId,
                redirectUri,
                nonce: cleanNonce(nonce),
            }),
            origin.startsWith('https:'),
        ),
    };
}

async function callback({ params, cookieValue, origin }, fetchImpl = fetch) {
    const secure = origin.startsWith('https:');
    const clear = pendingCookie('', secure, 0);
    let suffix = '';
    const back = (fragment, cookies = []) => ({
        redirect: `/#${fragment}${suffix}`,
        cookie: clear,
        cookies,
    });
    if (!ct.isConfigured()) return back('cointracker-error=not_configured');
    const pending = ct.unsealPending(cookieValue);
    suffix = nonceSuffix(pending?.nonce);
    if (!pending || !ct.statesMatch(params.get('state'), pending.state)) {
        return back('cointracker-error=invalid_state');
    }
    const code = params.get('code');
    if (!code) {
        // Pass CoinTracker's own reason (e.g. an unknown audience) through.
        const reason = [params.get('error'), params.get('error_description')]
            .filter(Boolean)
            .join(': ')
            .slice(0, 200);
        return back(
            `cointracker-error=${encodeURIComponent(reason || 'access_denied')}`,
        );
    }
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
            `cointracker-connected=${grant.GRANT_MARKER}`,
            grant.grantCookies(
                GRANT_COOKIE,
                COOKIE_PATH,
                ct.sealTokens(tokens),
                { secure },
            ),
        );
    } catch (err) {
        console.error('[CoinTracker] Token exchange failed:', err.message);
        return back('cointracker-error=exchange_failed');
    }
}

// Shared error mapping: dead/unreadable grants are 401 with a `code` that
// tells the SPA to drop its blob; everything else keeps the connection.
//
// A token refreshed before the failure rides along as `token`: Auth0 has
// already rotated the refresh token, so the browser's old blob is dead.
function errorResult(err) {
    const token = err.tokens ? { token: ct.sealTokens(err.tokens) } : {};
    // A valid MCP-audience token whose RBAC permissions are empty: the
    // CoinTracker account itself has no MCP access (early access, paid).
    const d = err.diagnostic;
    if (
        err.code === 'unauthorized' &&
        d?.format === 'jwt' &&
        Array.isArray(d.permissions) &&
        !d.permissions.length
    ) {
        return {
            status: 401,
            body: {
                error: "Your CoinTracker account doesn't have MCP access yet. CoinTracker MCP is in early access for paid plans: ask CoinTracker support to enable it, then connect again.",
                code: 'cointracker_no_access',
            },
        };
    }
    if (err.status === 401 || err.code === 'cointracker_forbidden') {
        return {
            status: err.status === 401 ? 401 : 403,
            body: {
                error: err.message,
                code:
                    err.code === 'unauthorized'
                        ? 'cointracker_revoked'
                        : err.code,
                ...(err.diagnostic ? { diagnostic: err.diagnostic } : {}),
                ...token,
            },
        };
    }
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.error(
        '[CoinTracker] Request failed:',
        timedOut ? 'timeout' : err.code,
        err.message,
    );
    return {
        status: timedOut ? 504 : 502,
        body: {
            error: timedOut
                ? 'CoinTracker did not respond in time. Try again shortly.'
                : err.message || 'CoinTracker request failed.',
            code: timedOut ? 'timeout' : err.code || 'mcp_failed',
            ...token,
        },
    };
}

async function sync({ body, cookieHeader, secure = true }, fetchImpl = fetch) {
    if (!ct.isConfigured()) return notConfigured();
    const picked = pick({ cookieHeader, legacy: body?.token });
    return settle(await syncWith(picked, fetchImpl), picked, secure);
}

async function syncWith(picked, fetchImpl) {
    try {
        const result = await ct.syncWallets(
            ct.unsealTokens(picked.sealed),
            fetchImpl,
        );
        return {
            status: 200,
            body: {
                status: 'success',
                tool: result.tool,
                wallets: result.wallets,
                warnings: result.warnings,
                skippedProviderIds: result.skippedProviderIds,
                partial: result.partial,
                ...(result.payloadShape
                    ? { payloadShape: result.payloadShape }
                    : {}),
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
async function inspect(
    { body, cookieHeader, secure = true },
    fetchImpl = fetch,
) {
    if (!ct.isConfigured()) return notConfigured();
    const picked = pick({ cookieHeader, legacy: body?.token });
    return settle(await inspectWith(picked, fetchImpl), picked, secure);
}

async function inspectWith(picked, fetchImpl) {
    try {
        const result = await ct.inspectTools(
            ct.unsealTokens(picked.sealed),
            fetchImpl,
        );
        return {
            status: 200,
            body: {
                tools: result.tools,
                selected: result.selected,
                ...(result.refreshed
                    ? { token: ct.sealTokens(result.tokens) }
                    : {}),
            },
        };
    } catch (err) {
        return errorResult(err);
    }
}

// Authoritative "am I connected?" answer, from the grant cookie (or a legacy
// blob in the Authorization header, never the URL, which lands in logs).
// A grant that cannot be unsealed is not connected: it can never work again.
function status({ token, cookieHeader, secure = true }) {
    const configured = ct.isConfigured();
    const picked = pick({ cookieHeader, legacy: token });
    let connected = false;
    if (configured && picked.sealed) {
        try {
            connected = Boolean(ct.unsealTokens(picked.sealed));
        } catch {
            connected = false;
        }
    }
    const result = { status: 200, body: { configured, connected } };
    // Move a readable legacy blob into the cookie on first contact.
    return connected && picked.stale
        ? settle(result, picked, secure)
        : { ...result, cookies: [] };
}

async function disconnect(
    { body, cookieHeader, secure = true },
    fetchImpl = fetch,
) {
    // Clear the grant even when the server cannot revoke it right now: a
    // disconnect must not leave a grant that comes back with the key.
    if (!ct.isConfigured())
        return {
            ...notConfigured(),
            cookies: grant.clearGrantCookies(GRANT_COOKIE, COOKIE_PATH, {
                secure,
            }),
        };
    const picked = pick({ cookieHeader, legacy: body?.token });
    let tokens = null;
    try {
        tokens = picked.sealed ? ct.unsealTokens(picked.sealed) : null;
    } catch {
        /* unreadable grant: nothing to revoke, it is dropped anyway */
    }
    const revoked = tokens ? await ct.revokeTokens(tokens, fetchImpl) : false;
    return {
        status: 200,
        body: { status: 'disconnected', revoked },
        cookies: grant.clearGrantCookies(GRANT_COOKIE, COOKIE_PATH, { secure }),
    };
}

module.exports = {
    COOKIE_NAME,
    GRANT_COOKIE,
    authorize,
    callback,
    sync,
    inspect,
    status,
    disconnect,
};
