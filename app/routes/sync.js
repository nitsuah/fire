'use strict';

const express = require('express');
const jsonata = require('jsonata');
const crypto = require('crypto');
const { readState, mutateState } = require('../lib/db');
const { integrateWebhookData } = require('../lib/webhook-integration');
const router = express.Router();
const ebayRouter = require('./ebay');
const plaidRouter = require('./plaid');
const coinTrackerRouter = require('./cointracker');
const etsyRouter = require('./etsy');
const SUPPORTED_WEBHOOK_TYPES = [
    'accounts',
    'cds',
    'positions',
    'expenses',
    'sideGigLedger',
    'importedFiles',
    'taxRate',
    'projectionSettings',
];

const WEBHOOK_FIELD_SCHEMAS = {
    accounts: { required: ['name', 'type', 'value'], optional: ['apy', 'id'] },
    cds: {
        required: ['bank', 'principal', 'rate', 'maturity'],
        optional: ['id'],
    },
    positions: {
        required: ['symbol', 'value'],
        optional: ['quantity', 'costBasis', 'description', 'id'],
    },
    expenses: {
        required: [],
        optional: [
            'housing',
            'utilities',
            'food',
            'transport',
            'healthcare',
            'discretionary',
        ],
    },
    sideGigLedger: {
        required: ['platform', 'gross', 'net'],
        optional: ['date', 'description', 'fees', 'id'],
    },
    importedFiles: { required: ['name'], optional: ['date', 'id'] },
    taxRate: { required: [], optional: [] },
    projectionSettings: {
        required: [],
        optional: [
            'annualSavings',
            'expectedReturn',
            'inflationRate',
            'swr',
            'spanYears',
            'currentAge',
            'retireAge',
        ],
    },
};

function omitSecret(template) {
    const cleaned = { ...template };
    delete cleaned.secret;
    return cleaned;
}

function validateWebhookPayload(type, data) {
    const schema = WEBHOOK_FIELD_SCHEMAS[type];
    if (!schema) return null;
    if (schema.required.length === 0) return null;
    const items = Array.isArray(data) ? data : [data];
    for (const payload of items) {
        if (!payload || typeof payload !== 'object') continue;
        for (const field of schema.required) {
            if (!(field in payload)) {
                return `Missing required field: ${field}`;
            }
        }
    }
    return null;
}

router.post('/templates', async (req, res) => {
    if (!SUPPORTED_WEBHOOK_TYPES.includes(req.body.type)) {
        return res.status(400).json({
            error: `Unsupported type. Must be one of: ${SUPPORTED_WEBHOOK_TYPES.join(', ')}.`,
        });
    }
    if (req.body.mapping !== undefined && req.body.mapping !== null) {
        if (typeof req.body.mapping !== 'string') {
            return res
                .status(400)
                .json({ error: 'Invalid mapping: must be a string.' });
        }
        try {
            jsonata(req.body.mapping);
        } catch {
            return res
                .status(400)
                .json({ error: 'Invalid JSONata mapping expression.' });
        }
    }
    const newTemplate = {
        id: crypto.randomBytes(8).toString('hex'),
        name: req.body.name,
        source: req.body.source,
        type: req.body.type,
        mapping: req.body.mapping,
        secret: req.body.secret || null,
        createdAt: new Date().toISOString(),
    };
    const ok = await mutateState((state) => {
        if (!state.webhookTemplates) state.webhookTemplates = [];
        state.webhookTemplates.push(newTemplate);
    });
    if (ok) {
        res.status(201).json(omitSecret(newTemplate));
    } else {
        res.status(500).json({ error: 'Failed to save webhook template.' });
    }
});

router.get('/templates', (req, res) => {
    const db = readState();
    res.json((db.webhookTemplates || []).map(omitSecret));
});

router.put('/templates/:id', async (req, res) => {
    if (req.body.mapping !== undefined && req.body.mapping !== null) {
        if (typeof req.body.mapping !== 'string') {
            return res
                .status(400)
                .json({ error: 'Invalid mapping: must be a string.' });
        }
        try {
            jsonata(req.body.mapping);
        } catch {
            return res
                .status(400)
                .json({ error: 'Invalid JSONata mapping expression.' });
        }
    }
    let notFound = false;
    let updated = null;
    const ok = await mutateState((state) => {
        const idx = (state.webhookTemplates || []).findIndex(
            (t) => t.id === req.params.id,
        );
        if (idx === -1) {
            notFound = true;
            return;
        }
        const cur = state.webhookTemplates[idx];
        state.webhookTemplates[idx] = {
            ...cur,
            name: req.body.name || cur.name,
            source: req.body.source || cur.source,
            type: req.body.type || cur.type,
            mapping: req.body.mapping || cur.mapping,
            secret: req.body.secret || cur.secret,
        };
        updated = state.webhookTemplates[idx];
    });
    if (notFound)
        return res.status(404).json({ error: 'Webhook template not found.' });
    if (ok) {
        res.json(omitSecret(updated));
    } else {
        res.status(500).json({ error: 'Failed to update webhook template.' });
    }
});

router.delete('/templates/:id', async (req, res) => {
    let notFound = false;
    const ok = await mutateState((state) => {
        const before = (state.webhookTemplates || []).length;
        state.webhookTemplates = (state.webhookTemplates || []).filter(
            (t) => t.id !== req.params.id,
        );
        if (state.webhookTemplates.length === before) notFound = true;
    });
    if (notFound)
        return res.status(404).json({ error: 'Webhook template not found.' });
    if (ok) {
        res.json({ message: 'Webhook template successfully deleted.' });
    } else {
        res.status(500).json({ error: 'Failed to delete webhook template.' });
    }
});

// ─── Webhook receiver ─────────────────────────────────────────────────────────

const WEBHOOK_MAX_BYTES = 16 * 1024; // 16KB

router.post('/webhook/:templateId', async (req, res) => {
    if (req.rawBody && req.rawBody.length > WEBHOOK_MAX_BYTES) {
        return res
            .status(413)
            .json({ error: 'Webhook payload too large (max 16KB).' });
    }
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
        if (!req.rawBody) {
            return res.status(400).json({
                error: 'Missing raw request body for signature verification.',
            });
        }
        const hmac = crypto.createHmac('sha256', template.secret);
        const digest = hmac.update(req.rawBody).digest('hex');
        const expected = Buffer.from(`sha256=${digest}`);
        const actual = Buffer.from(signature);
        if (
            actual.length !== expected.length ||
            !crypto.timingSafeEqual(actual, expected)
        ) {
            return res
                .status(403)
                .json({ error: 'Invalid webhook signature.' });
        }
    }

    let transformedData = {};
    try {
        if (template.mapping && typeof template.mapping === 'string') {
            const expression = jsonata(template.mapping);
            let timeoutHandle;
            transformedData = await Promise.race([
                expression.evaluate(req.body),
                new Promise((_, reject) => {
                    timeoutHandle = setTimeout(
                        () => reject(new Error('JSONata evaluation timed out')),
                        5000,
                    );
                }),
            ]).finally(() => clearTimeout(timeoutHandle));
        } else {
            transformedData = req.body;
        }
    } catch (e) {
        console.error('[Webhook] Mapping error:', e);
        return res.status(400).json({
            error: 'Error processing webhook data.',
            details: e.message,
        });
    }

    const validationError = validateWebhookPayload(
        template.type,
        transformedData,
    );
    if (validationError) {
        return res.status(400).json({
            error: `Webhook payload validation failed: ${validationError}`,
        });
    }

    let integrationSuccess = false;
    const saved = await mutateState((state) => {
        integrationSuccess = integrateWebhookData(
            state,
            template.type,
            transformedData,
        );
    });
    if (integrationSuccess && saved) {
        console.log(
            `[Webhook] Integrated type=${template.type} template=${template.name}`,
        );
        res.json({
            status: 'success',
            message: `Webhook data for ${template.type} integrated successfully.`,
        });
    } else {
        res.status(500).json({ error: 'Failed to integrate webhook data.' });
    }
});

router.use(ebayRouter);
router.use(plaidRouter);
router.use(coinTrackerRouter);
router.use(etsyRouter);

module.exports = router;
