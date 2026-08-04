'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jsonata = require('jsonata');
const { DATA_DIR, readState, writeState } = require('../lib/db');
const { encrypt, decrypt } = require('../lib/crypto-utils');
const { integrateWebhookData } = require('../lib/webhook-integration');

const router = express.Router();

const PREFERRED_PORT = parseInt(process.env.PORT) || 3001;

function omitSecret(template) {
    const cleaned = { ...template };
    delete cleaned.secret;
    return cleaned;
}

router.get('/init', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session = { oauthState: state };

    const providerUrl = 'https://oauth.provider.com/authorize';
    const params = new URLSearchParams({
        client_id: process.env.SYNC_CLIENT_ID || 'dummy_client_id',
        redirect_uri: `http://localhost:${PREFERRED_PORT}/api/sync/callback`,
        response_type: 'code',
        scope: 'read_only_accounts',
        state: state,
    });

    res.redirect(`${providerUrl}?${params.toString()}`);
});

router.post('/callback', async (req, res) => {
    const { code, state } = req.body;

    if (!state || state !== req.session?.oauthState) {
        return res.status(403).json({ error: 'Invalid or missing state' });
    }

    if (!code) {
        return res.status(400).json({ error: 'Missing code' });
    }

    console.log('Exchanging code for tokens:', code);
    const tokens = {
        access_token: 'actual_access_token_from_provider',
        refresh_token: 'actual_refresh_token',
        expires_in: 3600,
    };

    const encryptedToken = encrypt(JSON.stringify(tokens));

    try {
        const tokenData = {
            lastUpdated: new Date().toISOString(),
            data: encryptedToken,
        };
        fs.writeFileSync(
            path.join(DATA_DIR, 'tokens.json'),
            JSON.stringify(tokenData),
        );
        res.json({ status: 'success', message: 'Tokens securely stored.' });
    } catch (err) {
        console.error('Failed to store tokens:', err);
        res.status(500).json({ error: 'Failed to store tokens.' });
    }
});

router.get('/data', async (req, res) => {
    const tokenFile = path.join(DATA_DIR, 'tokens.json');
    if (!fs.existsSync(tokenFile)) {
        return res
            .status(401)
            .json({ error: 'No tokens found. Please authorize.' });
    }

    const { data: encryptedToken } = JSON.parse(
        fs.readFileSync(tokenFile, 'utf8'),
    );

    const tokens = JSON.parse(decrypt(encryptedToken));

    res.json({
        status: 'success',
        data: 'Aggregated data (mock)',
        accessToken: tokens.access_token.substring(0, 5) + '...',
    });
});

router.post('/templates', (req, res) => {
    const db = readState();
    const newTemplate = {
        id: crypto.randomBytes(8).toString('hex'),
        name: req.body.name,
        source: req.body.source,
        type: req.body.type,
        mapping: req.body.mapping,
        secret: req.body.secret || null,
        createdAt: new Date().toISOString(),
    };
    db.webhookTemplates.push(newTemplate);
    if (writeState(db)) {
        res.status(201).json(newTemplate);
    } else {
        res.status(500).json({ error: 'Failed to save webhook template.' });
    }
});

router.get('/templates', (req, res) => {
    const db = readState();
    res.json(db.webhookTemplates.map(omitSecret));
});

router.put('/templates/:id', (req, res) => {
    const db = readState();
    const templateIndex = db.webhookTemplates.findIndex(
        (t) => t.id === req.params.id,
    );

    if (templateIndex === -1) {
        return res.status(404).json({ error: 'Webhook template not found.' });
    }

    db.webhookTemplates[templateIndex] = {
        ...db.webhookTemplates[templateIndex],
        name: req.body.name || db.webhookTemplates[templateIndex].name,
        source: req.body.source || db.webhookTemplates[templateIndex].source,
        type: req.body.type || db.webhookTemplates[templateIndex].type,
        mapping:
            req.body.mapping || db.webhookTemplates[templateIndex].mapping,
        secret:
            req.body.secret || db.webhookTemplates[templateIndex].secret,
    };

    if (writeState(db)) {
        res.json(omitSecret(db.webhookTemplates[templateIndex]));
    } else {
        res.status(500).json({ error: 'Failed to update webhook template.' });
    }
});

router.delete('/templates/:id', (req, res) => {
    const db = readState();
    const initialLength = db.webhookTemplates.length;
    db.webhookTemplates = db.webhookTemplates.filter(
        (t) => t.id !== req.params.id,
    );

    if (db.webhookTemplates.length === initialLength) {
        return res.status(404).json({ error: 'Webhook template not found.' });
    }

    if (writeState(db)) {
        res.json({ message: 'Webhook template successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete webhook template.' });
    }
});

router.post('/webhook/:templateId', async (req, res) => {
    const db = readState();
    const template = db.webhookTemplates.find(
        (t) => t.id === req.params.templateId,
    );

    if (!template) {
        return res.status(404).json({ error: 'Webhook template not found.' });
    }

    if (template.secret) {
        const signature = req.headers['x-webhook-signature'];
        if (!signature) {
            return res
                .status(401)
                .json({ error: 'Missing webhook signature.' });
        }

        const hmac = crypto.createHmac('sha256', template.secret);
        const digest = hmac.update(JSON.stringify(req.body)).digest('hex');

        if (signature !== `sha256=${digest}`) {
            return res
                .status(403)
                .json({ error: 'Invalid webhook signature.' });
        }
    }

    let transformedData = {};
    try {
        if (template.mapping && typeof template.mapping === 'string') {
            const expression = jsonata(template.mapping);
            transformedData = await expression.evaluate(req.body);
        } else {
            transformedData = req.body;
        }
    } catch (e) {
        console.error('Error applying webhook mapping:', e);
        return res.status(400).json({
            error: 'Error processing webhook data.',
            details: e.message,
        });
    }

    console.log('[Webhook] Transformed Data:', transformedData);

    const dbUpdated = readState();
    const integrationSuccess = integrateWebhookData(
        dbUpdated,
        template.type,
        transformedData,
    );

    if (integrationSuccess && writeState(dbUpdated)) {
        console.log(
            `Received webhook for template ${template.name}, integrated data of type ${template.type}.`,
        );
        res.json({
            status: 'success',
            message: `Webhook data for ${template.type} integrated successfully.`,
        });
    } else {
        res.status(500).json({ error: 'Failed to integrate webhook data.' });
    }
});

module.exports = router;
