// Etsy routes for the browser-only deploy (/api/sync/etsy/*, rewritten
// here by netlify.toml). Wraps the same OAuth handlers as the Express
// routes (app/lib/etsy-handlers.js). Stateless: the PKCE verifier rides in
// a sealed HttpOnly cookie, and the tokens go back to the browser sealed
// with SYNC_MASTER_KEY (it stores the blob but can't read it). Status,
// the sync toggle and disconnect are handled in the browser in this mode
// (app/lib/etsy-sync.js); only authorize, callback and sync live here.

import etsy from '../../app/lib/etsy-connector.js';
import handlers from '../../app/lib/etsy-handlers.js';
import { json, redirect, methodNotAllowed, cookie } from '../lib/http.mjs';

function action(pathname) {
    // Either /api/sync/etsy/<action> or /.netlify/functions/etsy/<action>.
    const match = pathname.match(/\/etsy\/([^/]+)\/?$/);
    return match ? match[1] : '';
}

function toResponse(result) {
    const headers = result.cookie ? { 'Set-Cookie': result.cookie } : {};
    if (result.redirect) return redirect(result.redirect, headers);
    return json(result.status, result.body, headers);
}

async function sync(req) {
    if (!etsy.isConfigured()) return toResponse(handlers.notConfigured());
    let body;
    try {
        body = JSON.parse((await req.text()) || '{}');
    } catch {
        body = {};
    }
    let tokens;
    try {
        tokens = etsy.unsealTokens(body.tokens);
    } catch (err) {
        return toResponse(handlers.syncErrorResult(err));
    }
    const since =
        typeof body.since === 'string' && !Number.isNaN(Date.parse(body.since))
            ? body.since
            : undefined;
    try {
        const result = await etsy.syncReceipts(tokens, { since });
        return json(200, {
            status: 'success',
            entries: result.entries,
            fetched: result.entries.length,
            syncedAt: new Date().toISOString(),
            truncated: result.truncated,
            resumeFrom: result.resumeFrom,
            ...(result.changed
                ? { tokens: etsy.sealTokens(result.tokens) }
                : {}),
        });
    } catch (err) {
        const mapped = handlers.syncErrorResult(err);
        // Etsy rotates refresh tokens: hand back a refreshed grant even
        // when the sync itself failed, so the browser's blob stays alive.
        if (err.tokens && mapped.body.code !== 'etsy_revoked')
            mapped.body.tokens = etsy.sealTokens(err.tokens);
        return toResponse(mapped);
    }
}

export default async function handler(req) {
    const url = new URL(req.url);
    const name = action(url.pathname);
    if (name === 'authorize' || name === 'callback') {
        if (req.method !== 'GET') return methodNotAllowed('GET');
        if (name === 'authorize')
            return toResponse(handlers.authorize({ origin: url.origin }));
        return toResponse(
            await handlers.callback({
                params: url.searchParams,
                cookieValue: cookie(req, handlers.COOKIE_NAME),
                origin: url.origin,
                store: async (tokens) => etsy.sealTokens(tokens),
            }),
        );
    }
    if (name === 'sync') {
        if (req.method !== 'POST') return methodNotAllowed('POST');
        return sync(req);
    }
    return json(404, {
        error: 'Unknown Etsy endpoint. Status, toggle and disconnect are handled in the browser on this deploy.',
    });
}
