// CoinTracker routes for the browser-only deploy (/api/sync/cointracker/*,
// rewritten here by netlify.toml). Wraps the same handlers as the Express
// routes (app/lib/cointracker-handlers.js). Stateless: the PKCE verifier
// rides in an encrypted HttpOnly cookie and the tokens live in the
// browser, sealed with SYNC_MASTER_KEY.

import handlers from '../../app/lib/cointracker-handlers.js';
import { json, redirect, methodNotAllowed, cookie } from '../lib/http.mjs';

function action(pathname) {
    // Either /api/sync/cointracker/<action> or /.netlify/functions/cointracker/<action>.
    const match = pathname.match(/\/cointracker\/([^/]+)\/?$/);
    return match ? match[1] : '';
}

function toResponse(result) {
    const headers = result.cookie ? { 'Set-Cookie': result.cookie } : {};
    if (result.redirect) return redirect(result.redirect, headers);
    return json(result.status, result.body, headers);
}

async function readBody(req) {
    try {
        return JSON.parse((await req.text()) || '{}');
    } catch {
        return {};
    }
}

export default async function handler(req) {
    const url = new URL(req.url);
    // COINTRACKER_REDIRECT_URI overrides the derived callback URL.
    const origin = url.origin;
    const name = action(url.pathname);
    const get = ['authorize', 'callback'].includes(name);
    const post = ['sync', 'inspect', 'disconnect'].includes(name);
    if (!get && !post)
        return json(404, { error: 'Unknown CoinTracker endpoint.' });
    if (get && req.method !== 'GET') return methodNotAllowed('GET');
    if (post && req.method !== 'POST') return methodNotAllowed('POST');

    if (name === 'authorize')
        return toResponse(await handlers.authorize({ origin }));
    if (name === 'callback') {
        return toResponse(
            await handlers.callback({
                params: url.searchParams,
                cookieValue: cookie(req, handlers.COOKIE_NAME),
                origin,
            }),
        );
    }
    const body = await readBody(req);
    return toResponse(await handlers[name]({ body }));
}
