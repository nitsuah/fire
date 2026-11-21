// Starts eBay OAuth for the browser-only deploy
// (GET /api/sync/ebay/authorize). The CSRF `state` rides in a short-lived
// HttpOnly cookie instead of a server session, since Functions are
// stateless; ebay-callback compares the two.

import crypto from '../../app/lib/node-crypto.js';
import ebayConnector from '../../app/lib/ebay-connector.js';
import oauthNonce from '../../app/lib/oauth-nonce.js';
import {
    json,
    redirect,
    methodNotAllowed,
    missingEnv,
    OAUTH_ENV,
} from '../lib/http.mjs';

export default async function handler(req) {
    if (req.method !== 'GET') return methodNotAllowed('GET');
    const missing = missingEnv(OAUTH_ENV);
    if (missing.length) {
        console.error(
            `[eBay] OAuth not configured: ${missing.join(', ')} not set.`,
        );
        return json(503, { error: 'eBay connection is not configured.' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = oauthNonce.cleanNonce(new URL(req.url).searchParams.get('n'));
    const cookieValue = nonce ? `${state}.${nonce}` : state;
    return redirect(
        ebayConnector.buildAuthorizationUrl(
            process.env.EBAY_REDIRECT_URI,
            state,
        ),
        {
            'Set-Cookie': `ebay_oauth_state=${cookieValue}; Path=/api/sync/ebay; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        },
    );
}
