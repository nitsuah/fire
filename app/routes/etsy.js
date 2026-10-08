'use strict';

// Etsy routes for the self-hosted server, mounted under /api/sync. OAuth
// (PKCE) goes through app/lib/etsy-handlers.js, the same logic the Netlify
// Function serves on the browser-only deploy; here the tokens are kept in
// the encrypted token store (tokens-etsy.json, like eBay) and receipts are
// merged into the server's Side Gig Ledger.

const express = require('express');
const fs = require('fs');
const { readState, mutateState } = require('../lib/db');
const etsy = require('../lib/etsy-connector');
const handlers = require('../lib/etsy-handlers');
const { getTokenFile, loadTokens, saveTokens } = require('../lib/token-store');

const router = express.Router();

// Later syncs re-read a week before the last one, so receipts paid late
// (or edited) right around a sync aren't missed; dedupe drops repeats.
const RESYNC_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

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

function deleteTokens() {
    try {
        fs.unlinkSync(getTokenFile('etsy'));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
}

router.get('/etsy/authorize', (req, res) => {
    send(res, handlers.authorize({ origin: origin(req) }));
});

router.get('/etsy/callback', async (req, res) => {
    const params = new URL(req.originalUrl, 'http://local').searchParams;
    send(
        res,
        await handlers.callback({
            params,
            cookieValue: cookieValue(req, handlers.COOKIE_NAME),
            origin: origin(req),
            store: async (tokens) => {
                saveTokens('etsy', tokens);
                return 'stored';
            },
        }),
    );
});

router.get('/etsy/status', (req, res) => {
    const tokens = loadTokens('etsy');
    const syncEnabled = readState().etsySyncEnabled !== false;
    res.set('Cache-Control', 'no-store');
    if (!tokens) {
        return res.json({
            connected: false,
            configured: etsy.isConfigured(),
            syncEnabled,
        });
    }
    res.json({
        connected: true,
        configured: etsy.isConfigured(),
        lastSync: tokens.lastSyncedAt || null,
        shopId: tokens.shop_id || null,
        syncEnabled,
    });
});

router.post('/etsy/toggle', async (req, res) => {
    if (!req.body || typeof req.body.enabled !== 'boolean') {
        return res
            .status(400)
            .json({ error: 'enabled (boolean) is required.' });
    }
    const enabled = req.body.enabled;
    let ok = false;
    try {
        ok = await mutateState((state) => {
            state.etsySyncEnabled = enabled;
        });
    } catch (err) {
        console.error('[Etsy] toggle error:', err);
    }
    if (!ok)
        return res.status(500).json({ error: 'Failed to update setting.' });
    res.json({ enabled });
});

// Forget the grant. Synced sales stay in the ledger: they're the user's
// own records (tax tags and costs included).
router.post('/etsy/disconnect', (req, res) => {
    try {
        deleteTokens();
    } catch (err) {
        console.error('[Etsy] Unable to delete tokens:', err.message);
        return res.status(500).json({ error: 'Failed to disconnect Etsy.' });
    }
    res.json({ status: 'disconnected' });
});

router.post('/etsy/sync', async (req, res) => {
    if (!etsy.isConfigured()) return send(res, handlers.notConfigured());
    if (readState().etsySyncEnabled === false) {
        return res.status(403).json({
            error: 'Etsy sync is disabled. Enable it before syncing.',
        });
    }
    const tokens = loadTokens('etsy');
    if (!tokens)
        return res.status(401).json({
            error: 'Etsy is not connected. Connect Etsy first.',
        });
    const since =
        tokens.resumeFrom ||
        (tokens.lastSyncedAt
            ? new Date(
                  Date.parse(tokens.lastSyncedAt) - RESYNC_LOOKBACK_MS,
              ).toISOString()
            : undefined);

    let result;
    try {
        result = await etsy.syncReceipts(tokens, { since });
    } catch (err) {
        const mapped = handlers.syncErrorResult(err);
        if (mapped.body.code === 'etsy_revoked') {
            // Dead grant: drop the tokens and the rows the receipts sync
            // created, so no Etsy data outlives the authorization.
            // Manually logged Etsy sales are the user's own and stay.
            try {
                deleteTokens();
            } catch (unlinkErr) {
                console.error(
                    '[Etsy] Unable to delete revoked tokens:',
                    unlinkErr.message,
                );
            }
            await mutateState((state) => {
                state.sideGigLedger = (state.sideGigLedger || []).filter(
                    (e) => !etsy.isApiSyncedEtsyEntry(e),
                );
            });
        } else if (err.tokens) {
            saveTokens('etsy', { ...tokens, ...err.tokens });
        }
        return send(res, mapped);
    }

    let added = 0;
    const ok = await mutateState((state) => {
        if (!state.sideGigLedger) state.sideGigLedger = [];
        const ids = new Set(state.sideGigLedger.map((e) => e.id));
        for (const entry of result.entries) {
            if (ids.has(entry.id)) continue;
            state.sideGigLedger.push(entry);
            ids.add(entry.id);
            added++;
        }
    });
    if (!ok) return res.status(500).json({ error: 'Failed to save receipts.' });
    const syncedAt = new Date().toISOString();
    saveTokens('etsy', {
        ...result.tokens,
        lastSyncedAt: syncedAt,
        resumeFrom: result.truncated ? result.resumeFrom : undefined,
    });
    res.json({
        status: 'success',
        fetched: result.entries.length,
        added,
        syncedAt,
        truncated: result.truncated,
    });
});

module.exports = router;
