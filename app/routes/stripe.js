'use strict';

const express = require('express');
const fs = require('fs');
const { getTokenFile, loadTokens, saveTokens } = require('../lib/token-store');

const router = express.Router();
const MAX_SECRET_BYTES = 1024;
const RESTRICTED_KEY_RE = /^rk_(?:test|live)_[A-Za-z0-9]+$/;
const WEBHOOK_SECRET_RE = /^whsec_[A-Za-z0-9]+$/;
const ALLOWED_CREDENTIAL_FIELDS = new Set([
    'restrictedKey',
    'webhookSigningSecret',
]);

function masterKeyConfigured() {
    return (
        typeof process.env.SYNC_MASTER_KEY === 'string' &&
        /^[0-9a-fA-F]{64}$/.test(process.env.SYNC_MASTER_KEY)
    );
}

function noStore(res) {
    res.set('Cache-Control', 'no-store');
}

function stripeStatus() {
    const configured = masterKeyConfigured();
    if (!configured) {
        return {
            configured: false,
            connected: false,
            webhookConfigured: false,
            lastUpdated: null,
        };
    }

    const tokens = loadTokens('stripe');
    const connected =
        typeof tokens?.restrictedKey === 'string' &&
        RESTRICTED_KEY_RE.test(tokens.restrictedKey);
    const webhookConfigured =
        typeof tokens?.webhookSigningSecret === 'string' &&
        WEBHOOK_SECRET_RE.test(tokens.webhookSigningSecret);

    return {
        configured,
        connected,
        webhookConfigured,
        lastUpdated: tokens?._tokenLastUpdated || null,
    };
}

function invalidSecret(value, pattern) {
    return (
        typeof value !== 'string' ||
        !value.trim() ||
        Buffer.byteLength(value.trim(), 'utf8') > MAX_SECRET_BYTES ||
        !pattern.test(value.trim())
    );
}

router.get('/stripe/status', (req, res) => {
    noStore(res);
    return res.json(stripeStatus());
});

router.post('/stripe/credentials', (req, res) => {
    noStore(res);

    if (!masterKeyConfigured()) {
        return res.status(503).json({
            error: 'SYNC_MASTER_KEY must be configured to store Stripe credentials.',
        });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res
            .status(400)
            .json({ error: 'Invalid Stripe credentials payload.' });
    }
    if (Object.keys(body).some((key) => !ALLOWED_CREDENTIAL_FIELDS.has(key))) {
        return res
            .status(400)
            .json({ error: 'Unexpected Stripe credentials field.' });
    }
    if (invalidSecret(body.restrictedKey, RESTRICTED_KEY_RE)) {
        return res.status(400).json({
            error: 'restrictedKey must be a valid restricted Stripe key.',
        });
    }

    const hasWebhookSecret = Object.prototype.hasOwnProperty.call(
        body,
        'webhookSigningSecret',
    );
    let webhookSigningSecret;
    if (hasWebhookSecret) {
        if (invalidSecret(body.webhookSigningSecret, WEBHOOK_SECRET_RE)) {
            return res.status(400).json({
                error: 'webhookSigningSecret must be a valid Stripe webhook secret.',
            });
        }
        webhookSigningSecret = body.webhookSigningSecret.trim();
    }

    const tokenFile = getTokenFile('stripe');
    const fileExists = fs.existsSync(tokenFile);
    const existing = loadTokens('stripe');
    if (fileExists && !existing) {
        return res.status(500).json({
            error: 'Stored Stripe credentials could not be read; refusing to overwrite them.',
        });
    }
    if (existing) {
        const existingKeyValid =
            typeof existing.restrictedKey === 'string' &&
            RESTRICTED_KEY_RE.test(existing.restrictedKey);
        const existingWebhookValid =
            existing.webhookSigningSecret == null ||
            (typeof existing.webhookSigningSecret === 'string' &&
                WEBHOOK_SECRET_RE.test(existing.webhookSigningSecret));
        if (!existingKeyValid || !existingWebhookValid) {
            return res.status(500).json({
                error: 'Stored Stripe credentials are invalid; refusing to overwrite them.',
            });
        }
    }

    const tokens = {
        restrictedKey: body.restrictedKey.trim(),
        ...(hasWebhookSecret
            ? { webhookSigningSecret }
            : existing?.webhookSigningSecret
              ? { webhookSigningSecret: existing.webhookSigningSecret }
              : {}),
        configuredAt: new Date().toISOString(),
    };

    try {
        saveTokens('stripe', tokens);
    } catch {
        return res.status(500).json({
            error: 'Failed to store Stripe credentials securely.',
        });
    }

    return res.json(stripeStatus());
});

router.delete('/stripe/disconnect', (req, res) => {
    noStore(res);

    try {
        fs.unlinkSync(getTokenFile('stripe'));
    } catch (err) {
        if (err.code !== 'ENOENT') {
            return res.status(500).json({
                error: 'Failed to delete local Stripe credentials.',
            });
        }
    }

    return res.json(stripeStatus());
});

module.exports = router;
