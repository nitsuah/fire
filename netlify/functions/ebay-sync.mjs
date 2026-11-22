// Order sync for the browser-only deploy (POST /api/sync/ebay/sync).
// The sealed grant comes from the HttpOnly cookie ebay-callback set (see
// app/lib/grant-cookie.js). Decrypts it, pulls completed orders (refreshing
// the access token when needed) and returns ledger entries for the SPA to
// merge into its localStorage state; a refreshed grant goes back into the
// cookie. A revoked or unreadable grant returns 401 with a `code` telling the
// client to drop its marker, and clears the cookie.
//
// A client from before the cookie move still posts {tokens: <blob>}: a
// readable blob is moved into the cookie and the response carries
// `tokens: 'cookie'`, which the SPA stores in place of the blob.

import cryptoUtils from '../../app/lib/crypto-utils.js';
import ebayHandlers from '../../app/lib/ebay-handlers.js';
import grant from '../../app/lib/grant-cookie.js';
import {
    json,
    methodNotAllowed,
    missingEnv,
    withCookies,
    OAUTH_ENV,
    EBAY_GRANT,
} from '../lib/http.mjs';

const dropGrant = (res) =>
    withCookies(res, grant.clearGrantCookies(EBAY_GRANT.name, EBAY_GRANT.path));

export default async function handler(req) {
    if (req.method !== 'POST') return methodNotAllowed('POST');
    const missing = missingEnv(OAUTH_ENV);
    if (missing.length) {
        console.error(
            `[eBay] Sync not configured: ${missing.join(', ')} not set.`,
        );
        return json(503, {
            error: 'eBay sync is not configured on this server.',
        });
    }
    let body;
    try {
        body = JSON.parse((await req.text()) || '{}') || {};
    } catch {
        body = {};
    }
    const picked = grant.pickGrant(
        req.headers.get('cookie'),
        EBAY_GRANT.name,
        body.tokens,
    );
    let tokens;
    try {
        tokens = JSON.parse(cryptoUtils.decrypt(String(picked.sealed)));
    } catch {
        return dropGrant(
            json(401, {
                error: 'Stored eBay connection is unreadable. Reconnect eBay.',
                code: 'ebay_token_invalid',
            }),
        );
    }
    try {
        const result = await ebayHandlers.syncOrders(tokens);
        const sealed = result.refreshed
            ? cryptoUtils.encrypt(JSON.stringify(result.tokens))
            : picked.adopted
              ? picked.sealed
              : null;
        return withCookies(
            json(200, {
                status: 'success',
                entries: result.entries,
                fetched: result.entries.length,
                syncedAt: new Date().toISOString(),
                ...(sealed || picked.stale
                    ? { tokens: grant.GRANT_MARKER }
                    : {}),
            }),
            sealed
                ? grant.grantCookies(EBAY_GRANT.name, EBAY_GRANT.path, sealed)
                : [],
        );
    } catch (err) {
        if (err.code === 'ebay_revoked') {
            return dropGrant(json(401, { error: err.message, code: err.code }));
        }
        console.error('[eBay] Sync failed:', err.message);
        return json(502, { error: 'eBay sync failed. Try again later.' });
    }
}
