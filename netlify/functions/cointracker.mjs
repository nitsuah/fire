// CoinTracker routes for the browser-only deploy (/api/sync/cointracker/*,
// rewritten here by netlify.toml). Wraps the same handlers as the Express
// routes (app/lib/cointracker-handlers.js). Stateless: the PKCE verifier
// rides in an encrypted HttpOnly cookie, and the grant, sealed with
// SYNC_MASTER_KEY, lives in HttpOnly cookies the page cannot read.

import handlers from '../../app/lib/cointracker-handlers.js';
import {
    json,
    redirect,
    methodNotAllowed,
    cookie,
    withCookies,
} from '../lib/http.mjs';

function action(pathname) {
    // Either /api/sync/cointracker/<action> or /.netlify/functions/cointracker/<action>.
    const match = pathname.match(/\/cointracker\/([^/]+)\/?$/);
    return match ? match[1] : '';
}

function toResponse(result) {
    const res = result.redirect
        ? redirect(result.redirect)
        : json(result.status, result.body);
    return withCookies(res, [result.cookie, ...(result.cookies || [])]);
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
    const get = ['authorize', 'callback', 'status'].includes(name);
    const post = ['sync', 'inspect', 'disconnect'].includes(name);
    if (!get && !post)
        return json(404, { error: 'Unknown CoinTracker endpoint.' });
    if (get && req.method !== 'GET') return methodNotAllowed('GET');
    if (post && req.method !== 'POST') return methodNotAllowed('POST');

    if (name === 'authorize')
        return toResponse(
            await handlers.authorize({
                origin,
                nonce: url.searchParams.get('n'),
            }),
        );
    if (name === 'callback') {
        return toResponse(
            await handlers.callback({
                params: url.searchParams,
                cookieValue: cookie(req, handlers.COOKIE_NAME),
                origin,
            }),
        );
    }
    const cookieHeader = req.headers.get('cookie') || '';
    const secure = url.protocol === 'https:';
    if (name === 'status') {
        const header = req.headers.get('authorization') || '';
        return toResponse(
            handlers.status({
                token: header.startsWith('Bearer ') ? header.slice(7) : '',
                cookieHeader,
                secure,
            }),
        );
    }
    const body = await readBody(req);
    return toResponse(await handlers[name]({ body, cookieHeader, secure }));
}
