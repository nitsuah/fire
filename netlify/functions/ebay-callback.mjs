// eBay OAuth callback for the browser-only deploy
// (GET /api/sync/ebay/callback, the "auth accepted" URL on the RuName).
// Exchanges the code, encrypts the tokens with SYNC_MASTER_KEY and hands
// the ciphertext back to the SPA in the URL fragment (never sent to any
// server or in Referer). The browser stores that blob but cannot read it;
// only ebay-sync can decrypt it. Nothing is stored server-side.

import crypto from 'crypto';
import ebayConnector from '../../app/lib/ebay-connector.js';
import cryptoUtils from '../../app/lib/crypto-utils.js';
import {
    redirect,
    methodNotAllowed,
    missingEnv,
    cookie,
    OAUTH_ENV,
} from '../lib/http.mjs';

const CLEAR_STATE_COOKIE =
    'ebay_oauth_state=; Path=/api/sync/ebay; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

function back(fragment) {
    return redirect(`/#${fragment}`, { 'Set-Cookie': CLEAR_STATE_COOKIE });
}

function statesMatch(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export default async function handler(req) {
    if (req.method !== 'GET') return methodNotAllowed('GET');
    const missing = missingEnv(OAUTH_ENV);
    if (missing.length) {
        console.error(
            `[eBay] OAuth not configured: ${missing.join(', ')} not set.`,
        );
        return back('ebay-error=not_configured');
    }
    const params = new URL(req.url).searchParams;
    const code = params.get('code');
    if (!statesMatch(params.get('state'), cookie(req, 'ebay_oauth_state'))) {
        return back('ebay-error=invalid_state');
    }
    if (!code) return back('ebay-error=access_denied');
    try {
        const tokens = await ebayConnector.exchangeCodeForTokens(
            code,
            process.env.EBAY_REDIRECT_URI,
        );
        const blob = cryptoUtils.encrypt(JSON.stringify(tokens));
        return back(`ebay-connected=${encodeURIComponent(blob)}`);
    } catch (err) {
        console.error('[eBay] Token exchange failed:', err.message);
        return back('ebay-error=exchange_failed');
    }
}
