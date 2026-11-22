// Etsy routes for the browser-only deploy (/api/sync/etsy/*, rewritten
// here by netlify.toml). Wraps the same OAuth handlers as the Express
// routes (app/lib/etsy-handlers.js). Stateless: the PKCE verifier rides in
// a sealed HttpOnly cookie, and the grant, sealed with SYNC_MASTER_KEY,
// lives in HttpOnly cookies scoped to /api/sync/etsy (app/lib/grant-cookie.js)
// that page scripts cannot read; the SPA keeps only a `cookie` marker.
// Status and the sync toggle are handled in the browser in this mode
// (app/lib/etsy-sync.js); authorize, callback, sync and disconnect live here.

import etsy from '../../app/lib/etsy-connector.js';
import handlers from '../../app/lib/etsy-handlers.js';
import grant from '../../app/lib/grant-cookie.js';
import {
    json,
    redirect,
    methodNotAllowed,
    cookie,
    withCookies,
} from '../lib/http.mjs';

const GRANT = 'etsy_grant';
const GRANT_PATH = '/api/sync/etsy';
const setGrant = (sealed) => grant.grantCookies(GRANT, GRANT_PATH, sealed);
const clearGrant = () => grant.clearGrantCookies(GRANT, GRANT_PATH);
const DEAD_GRANT_CODES = new Set(['etsy_revoked', 'etsy_token_invalid']);

function action(pathname) {
    // Either /api/sync/etsy/<action> or /.netlify/functions/etsy/<action>.
    const match = pathname.match(/\/etsy\/([^/]+)\/?$/);
    return match ? match[1] : '';
}

function toResponse(result, cookies = []) {
    const res = result.redirect
        ? redirect(result.redirect)
        : json(result.status, result.body);
    return withCookies(res, [result.cookie, ...cookies]);
}

async function sync(req) {
    if (!etsy.isConfigured()) return toResponse(handlers.notConfigured());
    let body;
    try {
        body = JSON.parse((await req.text()) || '{}');
    } catch {
        body = {};
    }
    // The cookie, or a blob a client from before the cookie move still posts.
    const picked = grant.pickGrant(
        req.headers.get('cookie'),
        GRANT,
        body.tokens,
    );
    let tokens;
    try {
        tokens = etsy.unsealTokens(picked.sealed);
    } catch (err) {
        return toResponse(handlers.syncErrorResult(err), clearGrant());
    }
    const since =
        typeof body.since === 'string' && !Number.isNaN(Date.parse(body.since))
            ? body.since
            : undefined;
    try {
        const result = await etsy.syncReceipts(tokens, { since });
        const sealed = result.changed
            ? etsy.sealTokens(result.tokens)
            : picked.adopted
              ? picked.sealed
              : null;
        return withCookies(
            json(200, {
                status: 'success',
                entries: result.entries,
                fetched: result.entries.length,
                syncedAt: new Date().toISOString(),
                truncated: result.truncated,
                resumeFrom: result.resumeFrom,
                ...(sealed || picked.stale
                    ? { tokens: grant.GRANT_MARKER }
                    : {}),
            }),
            sealed ? setGrant(sealed) : [],
        );
    } catch (err) {
        const mapped = handlers.syncErrorResult(err);
        // Only a dead grant clears the cookie: `etsy_unauthorized` (Etsy
        // rejected a call after a successful refresh) keeps the connection.
        if (DEAD_GRANT_CODES.has(mapped.body?.code))
            return toResponse(mapped, clearGrant());
        // Etsy rotates refresh tokens: keep a refreshed grant even when the
        // sync itself failed, so the connection stays alive.
        const sealed = err.tokens
            ? etsy.sealTokens(err.tokens)
            : picked.adopted
              ? picked.sealed
              : null;
        if (sealed || picked.stale) mapped.body.tokens = grant.GRANT_MARKER;
        return toResponse(mapped, sealed ? setGrant(sealed) : []);
    }
}

export default async function handler(req) {
    const url = new URL(req.url);
    const name = action(url.pathname);
    if (name === 'authorize' || name === 'callback') {
        if (req.method !== 'GET') return methodNotAllowed('GET');
        if (name === 'authorize')
            return toResponse(
                handlers.authorize({
                    origin: url.origin,
                    nonce: url.searchParams.get('n'),
                }),
            );
        let sealed = null;
        const result = await handlers.callback({
            params: url.searchParams,
            cookieValue: cookie(req, handlers.COOKIE_NAME),
            origin: url.origin,
            store: async (tokens) => {
                sealed = etsy.sealTokens(tokens);
                return grant.GRANT_MARKER;
            },
        });
        return toResponse(result, sealed ? setGrant(sealed) : []);
    }
    if (name === 'disconnect') {
        if (req.method !== 'POST') return methodNotAllowed('POST');
        return withCookies(json(200, { status: 'disconnected' }), clearGrant());
    }
    if (name === 'sync') {
        if (req.method !== 'POST') return methodNotAllowed('POST');
        return sync(req);
    }
    // Credential presence only — the token lives in the browser, so there is
    // nothing else this deploy can report. Without it a missing client id
    // shows up as "connected, sync failed" instead of "not configured".
    if (name === 'status') {
        if (req.method !== 'GET') return methodNotAllowed('GET');
        return json(200, { configured: etsy.isConfigured() });
    }
    return json(404, {
        error: 'Unknown Etsy endpoint. Status and the sync toggle are handled in the browser on this deploy.',
    });
}
