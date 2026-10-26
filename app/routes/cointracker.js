'use strict';

// CoinTracker routes for the self-hosted server, mounted under /api/sync.
// Thin wrappers over app/lib/cointracker-handlers.js, the same logic the
// Netlify Function serves on the browser-only deploy. Nothing is persisted
// here: the browser holds the sealed token and merges the wallets itself.

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

function send(res, result) {
    if (result.cookie) res.append('Set-Cookie', result.cookie);
    res.set('Cache-Control', 'no-store');
    if (result.redirect) return res.redirect(result.redirect);
    res.status(result.status).json(result.body);
}

router.get('/cointracker/authorize', async (req, res) => {
    send(res, await handlers.authorize({ origin: origin(req) }));
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
    send(res, handlers.status({ token }));
});

router.post('/cointracker/sync', async (req, res) => {
    send(res, await handlers.sync({ body: req.body }));
});

router.post('/cointracker/inspect', async (req, res) => {
    send(res, await handlers.inspect({ body: req.body }));
});

router.post('/cointracker/disconnect', async (req, res) => {
    send(res, await handlers.disconnect({ body: req.body }));
});

module.exports = router;
