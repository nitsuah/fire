'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Use an isolated temp DB for all server tests — must be set before server is required
const TEST_DB = path.join(os.tmpdir(), `fire-server-test-${process.pid}.json`);
process.env.FIRE_DB_FILE = TEST_DB;

const request = require('supertest');
const app = require('./server');

const DEFAULT_STATE = {
    importedPositions: [],
    customAccounts: [],
    cds: [],
    realEstate: [],
    vehicles: [],
    expenses: {
        housing: 1500,
        utilities: 250,
        food: 400,
        transport: 300,
        healthcare: 150,
        discretionary: 500,
    },
    taxRate: 20,
    sideGigLedger: [],
    projectionSettings: {
        annualSavings: 25000,
        expectedReturn: 8.0,
        inflationRate: 2.5,
        swr: 4.0,
        spanYears: 30,
    },
    importedFiles: [],
};

function resetDB(overrides) {
    const state = { ...DEFAULT_STATE, ...overrides };
    fs.writeFileSync(TEST_DB, JSON.stringify(state, null, 2));
    return state;
}

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        /* ignore */
    }
});

// ─── Static file serving ───────────────────────────────────────────────────────

describe('Static files', () => {
    it('serves the frontend index.html at /', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<html/i);
    });

    it('serves CSS at /styles.css', async () => {
        const res = await request(app).get('/styles.css');
        expect(res.status).toBe(200);
    });
});

// ─── GET /api/state ────────────────────────────────────────────────────────────

describe('GET /api/state', () => {
    beforeEach(() => resetDB());

    it('returns 200 with state JSON', async () => {
        const res = await request(app).get('/api/state');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('importedPositions');
        expect(res.body).toHaveProperty('customAccounts');
        expect(res.body).toHaveProperty('cds');
        expect(res.body).toHaveProperty('expenses');
    });

    it('returns persisted values', async () => {
        resetDB({ taxRate: 35 });
        const res = await request(app).get('/api/state');
        expect(res.body.taxRate).toBe(35);
    });
});

// ─── POST /api/state ───────────────────────────────────────────────────────────

describe('POST /api/state', () => {
    beforeEach(() => resetDB());

    it('overwrites full state and returns it', async () => {
        const newState = { ...DEFAULT_STATE, taxRate: 30 };
        const res = await request(app).post('/api/state').send(newState);
        expect(res.status).toBe(200);
        expect(res.body.state.taxRate).toBe(30);
    });

    it('persists state across GET calls', async () => {
        const payload = { ...DEFAULT_STATE, taxRate: 42 };
        await request(app).post('/api/state').send(payload);
        const getRes = await request(app).get('/api/state');
        expect(getRes.body.taxRate).toBe(42);
    });

    it('returns a success message', async () => {
        const res = await request(app).post('/api/state').send(DEFAULT_STATE);
        expect(res.body.message).toMatch(/successfully/i);
    });
});

// ─── POST /api/accounts ────────────────────────────────────────────────────────

describe('POST /api/accounts', () => {
    beforeEach(() => resetDB());

    it('creates a new account and returns 201', async () => {
        const res = await request(app).post('/api/accounts').send({
            name: 'Chase Savings',
            type: 'Savings',
            value: 10000,
            apy: 4.5,
        });
        expect(res.status).toBe(201);
        expect(res.body.name).toBe('Chase Savings');
        expect(res.body.type).toBe('Savings');
        expect(res.body.value).toBe(10000);
        expect(res.body.apy).toBe(4.5);
        expect(res.body.id).toBeDefined();
    });

    it('defaults type to Cash when not provided', async () => {
        const res = await request(app)
            .post('/api/accounts')
            .send({ name: 'Wallet', value: 500 });
        expect(res.status).toBe(201);
        expect(res.body.type).toBe('Cash');
    });

    it('defaults value to 0 for non-numeric input', async () => {
        const res = await request(app)
            .post('/api/accounts')
            .send({ name: 'Test', type: 'Cash', value: 'invalid' });
        expect(res.status).toBe(201);
        expect(res.body.value).toBe(0);
    });

    it('persists the account so GET /api/state reflects it', async () => {
        await request(app)
            .post('/api/accounts')
            .send({ name: 'MyBank', type: 'Cash', value: 5000 });
        const stateRes = await request(app).get('/api/state');
        expect(stateRes.body.customAccounts).toHaveLength(1);
        expect(stateRes.body.customAccounts[0].name).toBe('MyBank');
    });

    it('generates a unique id for each account', async () => {
        const r1 = await request(app)
            .post('/api/accounts')
            .send({ name: 'A', value: 100 });
        const r2 = await request(app)
            .post('/api/accounts')
            .send({ name: 'B', value: 200 });
        expect(r1.body.id).not.toBe(r2.body.id);
    });
});

// ─── PUT /api/accounts/:id ─────────────────────────────────────────────────────

describe('PUT /api/accounts/:id', () => {
    let accountId;

    beforeEach(async () => {
        resetDB();
        const res = await request(app)
            .post('/api/accounts')
            .send({ name: 'Original', type: 'Cash', value: 1000, apy: 2.0 });
        accountId = res.body.id;
    });

    it('updates name and value', async () => {
        const res = await request(app)
            .put(`/api/accounts/${accountId}`)
            .send({ name: 'Updated', value: 2000 });
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Updated');
        expect(res.body.value).toBe(2000);
    });

    it('returns 404 for non-existent id', async () => {
        const res = await request(app)
            .put('/api/accounts/nonexistent')
            .send({ name: 'X' });
        expect(res.status).toBe(404);
        expect(res.body.error).toBeDefined();
    });

    it('partial update keeps unchanged fields', async () => {
        const res = await request(app)
            .put(`/api/accounts/${accountId}`)
            .send({ value: 9999 });
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Original');
        expect(res.body.value).toBe(9999);
    });

    it('updates apy', async () => {
        const res = await request(app)
            .put(`/api/accounts/${accountId}`)
            .send({ apy: 5.0 });
        expect(res.status).toBe(200);
        expect(res.body.apy).toBe(5.0);
    });
});

// ─── DELETE /api/accounts/:id ──────────────────────────────────────────────────

describe('DELETE /api/accounts/:id', () => {
    let accountId;

    beforeEach(async () => {
        resetDB();
        const res = await request(app)
            .post('/api/accounts')
            .send({ name: 'ToDelete', type: 'Cash', value: 500 });
        accountId = res.body.id;
    });

    it('deletes an existing account and returns success message', async () => {
        const res = await request(app).delete(`/api/accounts/${accountId}`);
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/deleted/i);
    });

    it('account no longer appears in state after deletion', async () => {
        await request(app).delete(`/api/accounts/${accountId}`);
        const stateRes = await request(app).get('/api/state');
        const found = stateRes.body.customAccounts.find(
            (a) => a.id === accountId,
        );
        expect(found).toBeUndefined();
    });

    it('returns 444 for non-existent account', async () => {
        const res = await request(app).delete('/api/accounts/ghost-id');
        expect(res.status).toBe(444);
        expect(res.body.error).toBeDefined();
    });
});

// ─── POST /api/cds ─────────────────────────────────────────────────────────────

describe('POST /api/cds', () => {
    beforeEach(() => resetDB());

    it('creates a CD and returns 201', async () => {
        const res = await request(app).post('/api/cds').send({
            bank: 'Marcus',
            principal: 10000,
            rate: 5.1,
            startDate: '2024-01-01',
            maturity: '2025-01-01',
        });
        expect(res.status).toBe(201);
        expect(res.body.bank).toBe('Marcus');
        expect(res.body.principal).toBe(10000);
        expect(res.body.rate).toBe(5.1);
        expect(res.body.id).toBeDefined();
    });

    it('defaults startDate to today when not provided', async () => {
        const res = await request(app).post('/api/cds').send({
            bank: 'Test',
            principal: 5000,
            rate: 4.0,
            maturity: '2026-01-01',
        });
        expect(res.status).toBe(201);
        expect(res.body.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('persists in state', async () => {
        await request(app).post('/api/cds').send({
            bank: 'Ally',
            principal: 8000,
            rate: 4.8,
            maturity: '2025-06-01',
        });
        const stateRes = await request(app).get('/api/state');
        expect(stateRes.body.cds).toHaveLength(1);
        expect(stateRes.body.cds[0].bank).toBe('Ally');
    });

    it('can create multiple CDs', async () => {
        await request(app).post('/api/cds').send({
            bank: 'Bank1',
            principal: 5000,
            rate: 4.0,
            maturity: '2025-01-01',
        });
        await request(app).post('/api/cds').send({
            bank: 'Bank2',
            principal: 10000,
            rate: 5.0,
            maturity: '2026-01-01',
        });
        const stateRes = await request(app).get('/api/state');
        expect(stateRes.body.cds).toHaveLength(2);
    });
});

// ─── PUT /api/cds/:id ──────────────────────────────────────────────────────────

describe('PUT /api/cds/:id', () => {
    let cdId;

    beforeEach(async () => {
        resetDB();
        const res = await request(app).post('/api/cds').send({
            bank: 'Bank A',
            principal: 5000,
            rate: 4.0,
            maturity: '2025-12-01',
        });
        cdId = res.body.id;
    });

    it('updates CD principal and rate', async () => {
        const res = await request(app)
            .put(`/api/cds/${cdId}`)
            .send({ principal: 7500, rate: 5.0 });
        expect(res.status).toBe(200);
        expect(res.body.principal).toBe(7500);
        expect(res.body.rate).toBe(5.0);
    });

    it('returns 404 for unknown id', async () => {
        const res = await request(app)
            .put('/api/cds/nonexistent')
            .send({ principal: 100 });
        expect(res.status).toBe(404);
    });

    it('partial update keeps unchanged fields', async () => {
        const res = await request(app)
            .put(`/api/cds/${cdId}`)
            .send({ bank: 'Bank B' });
        expect(res.status).toBe(200);
        expect(res.body.bank).toBe('Bank B');
        expect(res.body.principal).toBe(5000);
    });

    it('updates maturity date', async () => {
        const res = await request(app)
            .put(`/api/cds/${cdId}`)
            .send({ maturity: '2027-06-01' });
        expect(res.status).toBe(200);
        expect(res.body.maturity).toBe('2027-06-01');
    });
});

// ─── DELETE /api/cds/:id ───────────────────────────────────────────────────────

describe('DELETE /api/cds/:id', () => {
    let cdId;

    beforeEach(async () => {
        resetDB();
        const res = await request(app).post('/api/cds').send({
            bank: 'Delete Me',
            principal: 1000,
            rate: 3.5,
            maturity: '2024-12-01',
        });
        cdId = res.body.id;
    });

    it('deletes the CD and returns success', async () => {
        const res = await request(app).delete(`/api/cds/${cdId}`);
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/deleted/i);
    });

    it('CD is gone from state after deletion', async () => {
        await request(app).delete(`/api/cds/${cdId}`);
        const stateRes = await request(app).get('/api/state');
        expect(stateRes.body.cds).toHaveLength(0);
    });

    it('returns 404 for non-existent CD', async () => {
        const res = await request(app).delete('/api/cds/ghost');
        expect(res.status).toBe(404);
    });
});

// ─── GET /api/prices ───────────────────────────────────────────────────────────

describe('GET /api/prices', () => {
    it('returns empty object when no symbols query param', async () => {
        const res = await request(app).get('/api/prices');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
    });

    it('returns empty object when all symbols are filtered (SPAXX, FDRXX etc.)', async () => {
        const res = await request(app).get(
            '/api/prices?symbols=SPAXX,FDRXX,FCASH,FDIC',
        );
        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
    });

    it('returns empty object for numeric-only CUSIPs', async () => {
        const res = await request(app).get('/api/prices?symbols=123456789');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
    });

    it('returns empty object for whitespace/empty symbols', async () => {
        const res = await request(app).get('/api/prices?symbols=,,,');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
    });

    it('does not crash for valid equity symbols (network may be unavailable)', async () => {
        const res = await request(app).get('/api/prices?symbols=AAPL');
        expect(res.status).toBe(200);
        expect(typeof res.body).toBe('object');
    });
});
