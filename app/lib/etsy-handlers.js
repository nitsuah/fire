'use strict';

// Transport-agnostic Etsy handlers shared by the Express routes
// (app/routes/etsy.js, self-hosted) and the Netlify Function
// (netlify/functions/etsy.mjs, browser-only deploy). Each returns
// {status, body} or {redirect, cookie}; the wrappers turn those into
// responses. Where the tokens end up is the runtime's call: the Express
// route stores them in the encrypted token store, the Function seals them
// for the browser.

const crypto = require('crypto');
const etsy = require('./etsy-connector');

const COOKIE_NAME = 'etsy_oauth';
const COOKIE_PATH = '/api/sync/etsy';

function pendingCookie(value, secure, maxAge = 600) {
    return `${COOKIE_NAME}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function notConfigured() {
    console.error(
        '[Etsy] Not configured: ETSY_CLIENT_ID and a 64-hex SYNC_MASTER_KEY are required.',
    );
    return {
        status: 503,
        body: { error: 'Etsy connection is not configured on this server.' },
    };
}

// authorize is a top-level navigation, so failures go back to the SPA as a
// fragment rather than leaving the user on a bare JSON page.
function authorize({ origin }) {
    if (!etsy.isConfigured()) {
        notConfigured();
        return { redirect: '/#etsy-error=not_configured' };
    }
    const redirectUri = etsy.redirectUriFor(origin);
    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = etsy.createPkce();
    return {
        redirect: etsy.buildAuthorizationUrl({ redirectUri, state, challenge }),
        cookie: pendingCookie(
            etsy.sealPending({ state, verifier, redirectUri }),
            origin.startsWith('https:'),
        ),
    };
}

// `store(tokens)` persists the new grant and resolves to the value for the
// `#etsy-connected=` fragment (a sealed blob on the browser-only deploy,
// a plain marker when the server keeps the tokens).
async function callback(
    { params, cookieValue, origin, store },
    fetchImpl = fetch,
) {
    const clear = pendingCookie('', origin.startsWith('https:'), 0);
    const back = (fragment) => ({ redirect: `/#${fragment}`, cookie: clear });
    if (!etsy.isConfigured()) return back('etsy-error=not_configured');
    const pending = etsy.unsealPending(cookieValue);
    if (!pending || !etsy.statesMatch(params.get('state'), pending.state)) {
        return back('etsy-error=invalid_state');
    }
    const code = params.get('code');
    if (!code) {
        const reason = String(params.get('error') || 'access_denied').slice(
            0,
            100,
        );
        return back(`etsy-error=${encodeURIComponent(reason)}`);
    }
    try {
        const tokens = await etsy.exchangeCode(
            {
                code,
                verifier: pending.verifier,
                redirectUri: pending.redirectUri,
            },
            fetchImpl,
        );
        const value = await store(tokens);
        return back(`etsy-connected=${encodeURIComponent(value)}`);
    } catch (err) {
        console.error('[Etsy] Token exchange failed:', err.message);
        return back('etsy-error=exchange_failed');
    }
}

// Maps a sync failure to {status, body}. Dead/unreadable grants are 401
// with a `code` that tells the client to drop the connection.
function syncErrorResult(err) {
    if (
        err.code === 'etsy_revoked' ||
        err.code === 'etsy_token_invalid' ||
        (err.status === 401 && err.code === 'unauthorized')
    ) {
        return {
            status: 401,
            body: {
                error:
                    err.code === 'etsy_token_invalid'
                        ? err.message
                        : 'Etsy authorization was revoked or has expired. Reconnect Etsy to sync again.',
                code:
                    err.code === 'etsy_token_invalid'
                        ? 'etsy_token_invalid'
                        : 'etsy_revoked',
            },
        };
    }
    if (err.code === 'etsy_no_shop') {
        return { status: 404, body: { error: err.message, code: err.code } };
    }
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.error(
        '[Etsy] Sync failed:',
        timedOut ? 'timeout' : err.code,
        err.message,
    );
    return {
        status: timedOut ? 504 : 502,
        body: {
            error: timedOut
                ? 'Etsy did not respond in time. Try again shortly.'
                : 'Etsy sync failed. Try again later.',
            code: timedOut ? 'timeout' : err.code || 'etsy_api_failed',
        },
    };
}

module.exports = {
    COOKIE_NAME,
    authorize,
    callback,
    notConfigured,
    syncErrorResult,
};
