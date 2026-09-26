// Order sync for the browser-only deploy (POST /api/sync/ebay/sync).
// Body: {tokens: <blob from ebay-callback>}. Decrypts, pulls completed
// orders (refreshing the access token when needed) and returns ledger
// entries for the SPA to merge into its localStorage state, plus a
// re-encrypted blob when the tokens were refreshed. A revoked grant or an
// unreadable blob returns 401 with a `code` telling the client to drop it.

import cryptoUtils from '../../app/lib/crypto-utils.js';
import ebayHandlers from '../../app/lib/ebay-handlers.js';
import { json, methodNotAllowed, missingEnv, OAUTH_ENV } from '../lib/http.mjs';

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
    let tokens;
    try {
        const { tokens: blob } = JSON.parse((await req.text()) || '{}');
        tokens = JSON.parse(cryptoUtils.decrypt(String(blob)));
    } catch {
        return json(401, {
            error: 'Stored eBay connection is unreadable. Reconnect eBay.',
            code: 'ebay_token_invalid',
        });
    }
    try {
        const result = await ebayHandlers.syncOrders(tokens);
        return json(200, {
            status: 'success',
            entries: result.entries,
            fetched: result.entries.length,
            syncedAt: new Date().toISOString(),
            ...(result.refreshed
                ? { tokens: cryptoUtils.encrypt(JSON.stringify(result.tokens)) }
                : {}),
        });
    } catch (err) {
        if (err.code === 'ebay_revoked') {
            return json(401, { error: err.message, code: err.code });
        }
        console.error('[eBay] Sync failed:', err.message);
        return json(502, { error: 'eBay sync failed. Try again later.' });
    }
}
