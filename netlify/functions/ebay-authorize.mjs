// Starts eBay OAuth for the browser-only deploy
// (GET /api/sync/ebay/authorize). The CSRF `state` rides in a short-lived
// HttpOnly cookie instead of a server session, since Functions are
// stateless; ebay-callback compares the two.

import crypto from 'crypto';
import ebayConnector from '../../app/lib/ebay-connector.js';
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
    return redirect(
        ebayConnector.buildAuthorizationUrl(
            process.env.EBAY_REDIRECT_URI,
            state,
        ),
        {
            'Set-Cookie': `ebay_oauth_state=${state}; Path=/api/sync/ebay; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        },
    );
}
