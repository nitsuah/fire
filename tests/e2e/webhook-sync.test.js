'use strict';

/**
 * End-to-end webhook sync coverage: template CRUD -> ingest -> db.json
 * verification. This closes a gap a prior docs audit found — TASKS.md
 * claimed "Webhook sync end-to-end testing" was done while ROADMAP.md
 * (correctly) still listed it as open, and no test file anywhere in the
 * repo actually exercised app/routes/sync.js's webhook template or
 * receiver endpoints.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const WEBHOOK_DB = path.join(
    os.tmpdir(),
    `fire-webhook-e2e-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = WEBHOOK_DB;

const request = require('supertest');
const app = require('../../app/server');

const BLANK_STATE = {
    importedPositions: [],
    customAccounts: [],
    cds: [],
    realEstate: [],
    vehicles: [],
    expenses: {
        housing: 0,
        utilities: 0,
        food: 0,
        transport: 0,
        healthcare: 0,
        discretionary: 0,
    },
    taxRate: 0,
    sideGigLedger: [],
    webhookTemplates: [],
    projectionSettings: {
        annualSavings: 0,
        expectedReturn: 8.0,
        inflationRate: 2.5,
        swr: 4.0,
        spanYears: 30,
        currentAge: 35,
        retireAge: 60,
    },
    importedFiles: [],
    insurances: {
        car: { amt: 0, freq: 'monthly' },
        home: { amt: 0, freq: 'monthly' },
    },
};

function resetState(overrides) {
    const state = { ...BLANK_STATE, ...overrides };
    fs.writeFileSync(WEBHOOK_DB, JSON.stringify(state, null, 2));
    return state;
}

function signBody(secret, rawBody) {
    const digest = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
    return `sha256=${digest}`;
}

afterAll(() => {
    try {
        fs.unlinkSync(WEBHOOK_DB);
    } catch {
        /* ignore */
    }
});

describe('Webhook sync — template CRUD -> ingest -> db.json verification', () => {
    beforeEach(() => {
        resetState();
    });

    it('creates, lists, updates, and deletes a webhook template', async () => {
        const create = await request(app).post('/api/sync/templates').send({
            name: 'Side Gig Importer',
            source: 'custom',
            type: 'sideGigLedger',
            mapping:
                '{"platform": platform, "gross": gross, "net": net, "date": date}',
        });
        expect(create.status).toBe(201);
        expect(create.body.id).toBeDefined();
        // Secret is never echoed back, even when absent/null.
        expect(create.body.secret).toBeUndefined();
        const templateId = create.body.id;

        const list = await request(app).get('/api/sync/templates');
        expect(list.status).toBe(200);
        expect(list.body.some((t) => t.id === templateId)).toBe(true);

        const update = await request(app)
            .put(`/api/sync/templates/${templateId}`)
            .send({ name: 'Renamed Importer' });
        expect(update.status).toBe(200);
        expect(update.body.name).toBe('Renamed Importer');

        const del = await request(app).delete(
            `/api/sync/templates/${templateId}`,
        );
        expect(del.status).toBe(200);

        const listAfter = await request(app).get('/api/sync/templates');
        expect(listAfter.body.some((t) => t.id === templateId)).toBe(false);
    });

    it('rejects template creation with an unsupported type', async () => {
        const res = await request(app).post('/api/sync/templates').send({
            name: 'Bad Template',
            type: 'notARealType',
        });
        expect(res.status).toBe(400);
    });

    it('rejects an invalid JSONata mapping expression', async () => {
        const res = await request(app).post('/api/sync/templates').send({
            name: 'Bad Mapping',
            type: 'expenses',
            mapping: '{{{not valid jsonata',
        });
        expect(res.status).toBe(400);
    });

    it('ingests a webhook payload through JSONata mapping into sideGigLedger', async () => {
        const create = await request(app).post('/api/sync/templates').send({
            name: 'Side Gig Importer',
            source: 'custom',
            type: 'sideGigLedger',
            mapping:
                '{"platform": vendor, "gross": grossAmount, "net": grossAmount - fee, "date": soldAt}',
        });
        const templateId = create.body.id;

        const ingest = await request(app)
            .post(`/api/sync/webhook/${templateId}`)
            .send({
                vendor: 'Etsy',
                grossAmount: 120,
                fee: 12,
                soldAt: '2026-01-15',
            });
        expect(ingest.status).toBe(200);
        expect(ingest.body.status).toBe('success');

        const state = await request(app).get('/api/state');
        expect(state.body.sideGigLedger).toHaveLength(1);
        expect(state.body.sideGigLedger[0]).toMatchObject({
            platform: 'Etsy',
            gross: 120,
            net: 108,
            date: '2026-01-15',
        });
    });

    it('deduplicates repeated ingests of the same logical entry', async () => {
        const create = await request(app).post('/api/sync/templates').send({
            name: 'Side Gig Importer',
            type: 'sideGigLedger',
            mapping:
                '{"platform": vendor, "gross": grossAmount, "net": grossAmount, "date": soldAt}',
        });
        const templateId = create.body.id;
        const payload = {
            vendor: 'Etsy',
            grossAmount: 50,
            soldAt: '2026-02-01',
        };

        await request(app)
            .post(`/api/sync/webhook/${templateId}`)
            .send(payload);
        await request(app)
            .post(`/api/sync/webhook/${templateId}`)
            .send(payload);

        const state = await request(app).get('/api/state');
        expect(state.body.sideGigLedger).toHaveLength(1);
    });

    it('returns 404 for an unknown template id', async () => {
        const res = await request(app)
            .post('/api/sync/webhook/does-not-exist')
            .send({ foo: 'bar' });
        expect(res.status).toBe(404);
    });

    it('enforces HMAC signature verification when the template has a secret', async () => {
        const secret = 'test-webhook-secret';
        const create = await request(app).post('/api/sync/templates').send({
            name: 'Signed Importer',
            type: 'expenses',
            secret,
        });
        const templateId = create.body.id;
        const payload = { housing: 1600 };
        const rawBody = JSON.stringify(payload);

        const noSig = await request(app)
            .post(`/api/sync/webhook/${templateId}`)
            .set('Content-Type', 'application/json')
            .send(rawBody);
        expect(noSig.status).toBe(401);

        const wrongSig = await request(app)
            .post(`/api/sync/webhook/${templateId}`)
            .set('Content-Type', 'application/json')
            .set('X-Webhook-Signature', 'sha256=deadbeef')
            .send(rawBody);
        expect(wrongSig.status).toBe(403);

        const validSig = signBody(secret, rawBody);
        const ok = await request(app)
            .post(`/api/sync/webhook/${templateId}`)
            .set('Content-Type', 'application/json')
            .set('X-Webhook-Signature', validSig)
            .send(rawBody);
        expect(ok.status).toBe(200);

        const state = await request(app).get('/api/state');
        expect(state.body.expenses.housing).toBe(1600);
    });

    it('rejects an oversized webhook payload', async () => {
        const create = await request(app).post('/api/sync/templates').send({
            name: 'Big Payload Importer',
            type: 'expenses',
        });
        const templateId = create.body.id;
        const bigPayload = { housing: 1, note: 'x'.repeat(20 * 1024) };

        const res = await request(app)
            .post(`/api/sync/webhook/${templateId}`)
            .send(bigPayload);
        expect(res.status).toBe(413);
    });
});
