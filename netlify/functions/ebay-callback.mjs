// eBay OAuth callback for the browser-only deploy
// (GET /api/sync/ebay/callback, the "auth accepted" URL on the RuName).
// Exchanges the code, encrypts the tokens with SYNC_MASTER_KEY and stores
// the ciphertext in HttpOnly cookies scoped to /api/sync/ebay (see
// app/lib/grant-cookie.js), so page scripts never hold it. The SPA only
// learns `ebay-connected=cookie`. Nothing is stored server-side.

import crypto from '../../app/lib/node-crypto.js';
import ebayConnector from '../../app/lib/ebay-connector.js';
import cryptoUtils from '../../app/lib/crypto-utils.js';
import oauthNonce from '../../app/lib/oauth-nonce.js';
import grant from '../../app/lib/grant-cookie.js';
import {
    redirect,
    methodNotAllowed,
    missingEnv,
    cookie,
    withCookies,
    OAUTH_ENV,
    EBAY_GRANT,
} from '../lib/http.mjs';

const CLEAR_STATE_COOKIE =
    'ebay_oauth_state=; Path=/api/sync/ebay; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

// The state cookie is `<state>` or `<state>.<nonce>`; the nonce is echoed in
// the result fragment so the SPA can match it to the attempt it started.
function splitStateCookie(value) {
    const [state, nonce] = String(value || '').split('.');
    return { state, nonce: oauthNonce.cleanNonce(nonce) };
}

function backWith(nonce) {
    return (fragment, cookies = []) =>
        withCookies(redirect(`/#${fragment}${oauthNonce.nonceSuffix(nonce)}`), [
            CLEAR_STATE_COOKIE,
            ...cookies,
        ]);
}

function statesMatch(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export default async function handler(req) {
    if (req.method !== 'GET') return methodNotAllowed('GET');
    const stored = splitStateCookie(cookie(req, 'ebay_oauth_state'));
    const back = backWith(stored.nonce);
    const missing = missingEnv(OAUTH_ENV);
    if (missing.length) {
        console.error(
            `[eBay] OAuth not configured: ${missing.join(', ')} not set.`,
        );
        return back('ebay-error=not_configured');
    }
    const params = new URL(req.url).searchParams;
    const code = params.get('code');
    if (!statesMatch(params.get('state'), stored.state)) {
        return back('ebay-error=invalid_state');
    }
    if (!code) return back('ebay-error=access_denied');
    try {
        const tokens = await ebayConnector.exchangeCodeForTokens(
            code,
            process.env.EBAY_REDIRECT_URI,
        );
        const blob = cryptoUtils.encrypt(JSON.stringify(tokens));
        return back(
            `ebay-connected=${grant.GRANT_MARKER}`,
            grant.grantCookies(EBAY_GRANT.name, EBAY_GRANT.path, blob),
        );
    } catch (err) {
        console.error('[eBay] Token exchange failed:', err.message);
        return back('ebay-error=exchange_failed');
    }
}
