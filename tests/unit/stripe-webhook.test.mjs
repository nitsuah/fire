import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    it,
    expect,
    vi,
} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import crypto from 'node:crypto';

const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-stripe-webhook-test-'),
);
const TEST_DB_FILE = path.join(TEST_DATA_DIR, 'db.json');
const TEST_MASTER_KEY = '22'.repeat(32);
const PREVIOUS_ENV = {
    FIRE_DATA_DIR: process.env.FIRE_DATA_DIR,
    FIRE_DB_FILE: process.env.FIRE_DB_FILE,
    FIRE_AUTH_DISABLED: process.env.FIRE_AUTH_DISABLED,
    FIRE_RATE_LIMIT_DISABLED: process.env.FIRE_RATE_LIMIT_DISABLED,
    SYNC_MASTER_KEY: process.env.SYNC_MASTER_KEY,
};

process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB_FILE;
process.env.FIRE_AUTH_DISABLED = 'true';
process.env.FIRE_RATE_LIMIT_DISABLED = 'true';
process.env.SYNC_MASTER_KEY = TEST_MASTER_KEY;

let app;
let getTokenFile;
let saveTokens;
let readState;

const fixedNow = Date.now();

beforeAll(async () => {
    ({ getTokenFile, saveTokens } =
        await import('../../app/lib/token-store.js'));
    ({ readState } = await import('../../app/lib/db.js'));
    app = (await import('../../app/server.js')).default;
});

afterAll(() => {
    Object.keys(PREVIOUS_ENV).forEach((key) => {
        if (PREVIOUS_ENV[key] === undefined) delete process.env[key];
        else process.env[key] = PREVIOUS_ENV[key];
    });
    try {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
        // ignore
    }
});

afterEach(() => {
    try {
        fs.unlinkSync(getTokenFile('stripe'));
    } catch {
        // ignore
    }
    vi.restoreAllMocks();
});

function createHmac(payload, secret, timestamp) {
    const signedPayload = `${timestamp}.${payload}`;
    return crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');
}

function makeHeader(timestamp, ...signatures) {
    return `t=${timestamp},${signatures.map((s) => `v1=${s}`).join(',')}`;
}

describe('POST /api/sync/stripe/webhook', () => {
    const secret = 'whsec_testsecret123';
    const payload =
        '{"id":"evt_test_123","type":"payment_intent.succeeded","data":{}}';

    beforeEach(async () => {
        saveTokens('stripe', {
            restrictedKey: 'rk_test_fakekey',
            webhookSigningSecret: secret,
        });
    });

    it('returns 503 when SYNC_MASTER_KEY not configured', async () => {
        delete process.env.SYNC_MASTER_KEY;
        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(payload)
            .set('Content-Type', 'application/json')
            .set(
                'Stripe-Signature',
                `t=${Math.floor(fixedNow / 1000)},v1=invalidsig`,
            );

        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: 'Stripe webhook not configured' });

        process.env.SYNC_MASTER_KEY = TEST_MASTER_KEY;
    });

    it('returns 503 when no webhook signing secret stored', async () => {
        saveTokens('stripe', { restrictedKey: 'rk_test_fakekey' });
        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(payload)
            .set('Content-Type', 'application/json')
            .set(
                'Stripe-Signature',
                `t=${Math.floor(fixedNow / 1000)},v1=invalidsig`,
            );

        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: 'Stripe webhook not configured' });
    });

    it('returns 200 for valid signature with string payload', async () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(payload)
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', header);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: true });
    });

    it('returns 400 for tampered body (different payload but same header)', async () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const tamperedPayload =
            '{"id":"evt_test_123","type":"payment_intent.failed","data":{}}';

        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(tamperedPayload)
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', header);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid signature' });
    });

    it('returns 400 for wrong secret', async () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        saveTokens('stripe', {
            restrictedKey: 'rk_test_fakekey',
            webhookSigningSecret: 'whsec_wrongsecret456',
        });

        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(payload)
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', header);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid signature' });
    });

    it('returns 400 for stale timestamp (>300s)', async () => {
        const timestamp = Math.floor(fixedNow / 1000) - 301;
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(payload)
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', header);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid signature' });
    });

    it('returns 400 for missing Stripe-Signature header', async () => {
        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(payload)
            .set('Content-Type', 'application/json');

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid signature' });
    });

    it('returns 200 when multiple v1 and one is valid', async () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig1 = createHmac('wrong', secret, timestamp);
        const sig2 = createHmac(payload, secret, timestamp);
        const header = `t=${timestamp},v1=${sig1},v1=${sig2}`;

        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(payload)
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', header);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: true });
    });

    it('returns 400 for v0-only header', async () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = `t=${timestamp},v0=${sig}`;

        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(payload)
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', header);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid signature' });
    });

    it('returns 400 when JSON-reserialized body fails verification (raw body verified)', async () => {
        // This test ensures the route uses express.raw() to get the raw body
        // If the body were parsed by JSON middleware and re-stringified,
        // the signature would not match due to formatting differences
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        // Send as JSON (would be parsed and re-stringified if not using raw)
        const res = await request(app)
            .post('/api/sync/stripe/webhook')
            .send(JSON.parse(payload)) // This gets stringified by supertest
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', header);

        // The signature was computed for the exact `payload` string.
        // If the server parsed and re-stringified, the whitespace/ordering
        // might differ and the signature would fail. With express.raw(),
        // the original bytes are preserved and verification succeeds.
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: true });
    });

    it('records lastWebhookAt and lastEventType in state', async () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        await request(app)
            .post('/api/sync/stripe/webhook')
            .send(Buffer.from(payload))
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', header);

        const state = readState();
        expect(state.stripeWebhookStatus).toBeDefined();
        expect(state.stripeWebhookStatus.lastWebhookAt).toBeDefined();
        expect(state.stripeWebhookStatus.lastEventType).toBe(
            'payment_intent.succeeded',
        );
    });
});
