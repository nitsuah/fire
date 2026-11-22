'use strict';

// CoinTracker routes for the self-hosted server, mounted under /api/sync.
// Thin wrappers over app/lib/cointracker-handlers.js, the same logic the
// Netlify Function serves on the browser-only deploy. Nothing is persisted
// here: the sealed grant lives in an HttpOnly cookie, and the browser merges
// the wallets itself.

const express = require('express');
const handlers = require('../lib/cointracker-handlers');

const router = express.Router();

// Same rule as defaultEbayRedirectUri in ./ebay.js: behind Caddy with
// `trust proxy`, req.protocol reports the public scheme.
function origin(req) {
    return `${req.protocol}://${req.get('host')}`;
}

function cookieValue(req, name) {
    for (const part of (req.headers.cookie || '').split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return v.join('=');
    }
    return undefined;
}

// The grant cookie is Secure whenever the public scheme is https; a LAN
// install on plain http still gets an HttpOnly cookie.
function grantContext(req) {
    return { cookieHeader: req.headers.cookie || '', secure: req.secure };
}

function send(res, result) {
    for (const c of [result.cookie, ...(result.cookies || [])])
        if (c) res.append('Set-Cookie', c);
    res.set('Cache-Control', 'no-store');
    if (result.redirect) return res.redirect(result.redirect);
    res.status(result.status).json(result.body);
}

router.get('/cointracker/authorize', async (req, res) => {
    send(
        res,
        await handlers.authorize({
            origin: origin(req),
            nonce: req.query.n,
        }),
    );
});

router.get('/cointracker/callback', async (req, res) => {
    const params = new URL(req.originalUrl, 'http://local').searchParams;
    send(
        res,
        await handlers.callback({
            params,
            cookieValue: cookieValue(req, handlers.COOKIE_NAME),
            origin: origin(req),
        }),
    );
});

// The token is browser-held, so it travels in the Authorization header and
// never the URL: query strings end up in access logs (#294).
router.get('/cointracker/status', (req, res) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    send(res, handlers.status({ token, ...grantContext(req) }));
});

router.post('/cointracker/sync', async (req, res) => {
    send(res, await handlers.sync({ body: req.body, ...grantContext(req) }));
});

router.post('/cointracker/inspect', async (req, res) => {
    send(res, await handlers.inspect({ body: req.body, ...grantContext(req) }));
});

router.post('/cointracker/disconnect', async (req, res) => {
    send(
        res,
        await handlers.disconnect({ body: req.body, ...grantContext(req) }),
    );
});

module.exports = router;
