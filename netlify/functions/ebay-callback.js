'use strict';

// eBay OAuth callback for the browser-only deploy
// (GET /api/sync/ebay/callback, the "auth accepted" URL on the RuName).
// Exchanges the code, encrypts the tokens with SYNC_MASTER_KEY and hands
// the ciphertext back to the SPA in the URL fragment (never sent to any
// server or in Referer). The browser stores that blob but cannot read it;
// only ebay-sync can decrypt it. Nothing is stored server-side.

const crypto = require('crypto');
const { exchangeCodeForTokens } = require('../../app/lib/ebay-connector');
const { encrypt } = require('../../app/lib/crypto-utils');
const {
    redirect,
    methodNotAllowed,
    missingEnv,
    cookie,
} = require('../lib/http');
const { OAUTH_ENV } = require('./ebay-authorize');

const CLEAR_STATE_COOKIE =
    'ebay_oauth_state=; Path=/api/sync/ebay; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

function back(fragment) {
    return redirect(`/#${fragment}`, { 'Set-Cookie': CLEAR_STATE_COOKIE });
}

function statesMatch(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') return methodNotAllowed('GET');
    const missing = missingEnv(OAUTH_ENV);
    if (missing.length) {
        console.error(
            `[eBay] OAuth not configured: ${missing.join(', ')} not set.`,
        );
        return back('ebay-error=not_configured');
    }
    const { code, state } = event.queryStringParameters || {};
    if (!statesMatch(state, cookie(event, 'ebay_oauth_state'))) {
        return back('ebay-error=invalid_state');
    }
    if (!code) return back('ebay-error=access_denied');
    try {
        const tokens = await exchangeCodeForTokens(
            code,
            process.env.EBAY_REDIRECT_URI,
        );
        const blob = encrypt(JSON.stringify(tokens));
        return back(`ebay-connected=${encodeURIComponent(blob)}`);
    } catch (err) {
        console.error('[eBay] Token exchange failed:', err.message);
        return back('ebay-error=exchange_failed');
    }
};
