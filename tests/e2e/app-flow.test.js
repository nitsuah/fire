'use strict';

/**
 * End-to-end / full-cycle chain tests.
 * These tests drive the app through the API in realistic user flows,
 * verifying that data created in one step is correctly reflected in subsequent steps.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Isolated DB — must be set before server module loads
const E2E_DB = path.join(os.tmpdir(), `fire-e2e-test-${process.pid}.json`);
process.env.FIRE_DB_FILE = E2E_DB;

const request = require('supertest');
const app = require('../../app/server');
const {
    getAggregateNetWorth,
    getAggregateCDs,
    getAnnualExpensesTotal
} = require('../../app/lib/finance-core');

const BLANK_STATE = {
    importedPositions: [],
    customAccounts: [],
    cds: [],
    realEstate: [],
    vehicles: [],
    expenses: { housing: 0, utilities: 0, food: 0, transport: 0, healthcare: 0, discretionary: 0 },
    taxRate: 0,
    sideGigLedger: [],
    projectionSettings: { annualSavings: 0, expectedReturn: 8.0, inflationRate: 2.5, swr: 4.0, spanYears: 30, currentAge: 35, retireAge: 60 },
    importedFiles: [],
    insurances: { car: { amt: 0, freq: 'monthly' }, home: { amt: 0, freq: 'monthly' } }
};

async function resetState(overrides) {
    const state = { ...BLANK_STATE, ...overrides };
    fs.writeFileSync(E2E_DB, JSON.stringify(state, null, 2));
    return state;
}

afterAll(() => {
    try { fs.unlinkSync(E2E_DB); } catch (_) { /* ignore */ }
});

// ─── Chain 1: Account lifecycle ────────────────────────────────────────────────

describe('Full Account Lifecycle', () => {
    beforeEach(() => resetState());

    it('create → read → update → delete', async () => {
        // Create
        const createRes = await request(app).post('/api/accounts').send({
            name: 'HYSA', type: 'Savings', value: 25000, apy: 4.8
        });
        expect(createRes.status).toBe(201);
        const id = createRes.body.id;

        // Verify appears in state
        const stateAfterCreate = await request(app).get('/api/state');
        expect(stateAfterCreate.body.customAccounts).toHaveLength(1);
        expect(stateAfterCreate.body.customAccounts[0].value).toBe(25000);

        // Update value
        const updateRes = await request(app).put(`/api/accounts/${id}`).send({ value: 30000 });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.value).toBe(30000);

        // Verify updated in state
        const stateAfterUpdate = await request(app).get('/api/state');
        expect(stateAfterUpdate.body.customAccounts[0].value).toBe(30000);

        // Delete
        const deleteRes = await request(app).delete(`/api/accounts/${id}`);
        expect(deleteRes.status).toBe(200);

        // Verify gone
        const stateAfterDelete = await request(app).get('/api/state');
        expect(stateAfterDelete.body.customAccounts).toHaveLength(0);
    });

    it('multiple accounts accumulate net worth correctly', async () => {
        await request(app).post('/api/accounts').send({ name: 'Checking', type: 'Cash', value: 5000 });
        await request(app).post('/api/accounts').send({ name: 'Savings', type: 'Savings', value: 20000 });
        await request(app).post('/api/accounts').send({ name: 'Brokerage', type: 'Brokerage', value: 50000 });

        const stateRes = await request(app).get('/api/state');
        const nw = getAggregateNetWorth(stateRes.body);
        // Cash = 5000 + 20000 = 25000, Equities = 50000
        expect(nw).toBe(75000);
    });
});

// ─── Chain 2: CD lifecycle and interest calculation ────────────────────────────

describe('CD Lifecycle and Interest', () => {
    beforeEach(() => resetState());

    it('create → verify principal → delete → gone', async () => {
        const createRes = await request(app).post('/api/cds').send({
            bank: 'Marcus', principal: 15000, rate: 5.0, maturity: '2026-01-01'
        });
        const cdId = createRes.body.id;

        const state1 = (await request(app).get('/api/state')).body;
        expect(getAggregateCDs(state1.cds)).toBe(15000);

        await request(app).delete(`/api/cds/${cdId}`);

        const state2 = (await request(app).get('/api/state')).body;
        expect(getAggregateCDs(state2.cds)).toBe(0);
    });

    it('laddered CDs accumulate principal correctly', async () => {
        await request(app).post('/api/cds').send({ bank: 'Ally', principal: 10000, rate: 4.5, maturity: '2025-06-01' });
        await request(app).post('/api/cds').send({ bank: 'Marcus', principal: 20000, rate: 5.0, maturity: '2025-12-01' });
        await request(app).post('/api/cds').send({ bank: 'Discover', principal: 15000, rate: 4.8, maturity: '2026-06-01' });

        const state = (await request(app).get('/api/state')).body;
        expect(getAggregateCDs(state.cds)).toBe(45000);
    });

    it('updating CD principal is reflected in aggregate', async () => {
        const r = await request(app).post('/api/cds').send({ bank: 'Test', principal: 5000, rate: 4.0, maturity: '2026-01-01' });
        await request(app).put(`/api/cds/${r.body.id}`).send({ principal: 12000 });

        const state = (await request(app).get('/api/state')).body;
        expect(getAggregateCDs(state.cds)).toBe(12000);
    });
});

// ─── Chain 3: Full net worth calculation chain ─────────────────────────────────

describe('Net Worth Calculation Chain', () => {
    it('net worth sums accounts + CDs correctly', async () => {
        await resetState();

        await request(app).post('/api/accounts').send({ name: 'Savings', type: 'Savings', value: 30000 });
        await request(app).post('/api/cds').send({ bank: 'CD1', principal: 10000, rate: 5.0, maturity: '2026-01-01' });

        const state = (await request(app).get('/api/state')).body;
        const nw = getAggregateNetWorth(state);
        expect(nw).toBe(40000);
    });

    it('full FIRE number calculation chain', async () => {
        await resetState({
            expenses: { housing: 2000, utilities: 300, food: 600, transport: 400, healthcare: 200, discretionary: 500 },
            taxRate: 25,
            projectionSettings: { ...BLANK_STATE.projectionSettings, swr: 4.0 }
        });

        const state = (await request(app).get('/api/state')).body;
        const annualExp = getAnnualExpensesTotal(state.expenses, state.insurances || {}, state.taxRate);
        const fireNumber = annualExp / 0.04;

        // monthly base = 4000, annual = 48000, tax drag 25% = 12000, total = 60000
        // FIRE number = 60000 / 0.04 = 1,500,000
        expect(annualExp).toBe(60000);
        expect(fireNumber).toBe(1500000);
    });
});

// ─── Chain 4: State backup and restore ────────────────────────────────────────

describe('State Backup and Restore', () => {
    it('POST /api/state completely replaces existing data', async () => {
        await resetState();

        // First, add some accounts
        await request(app).post('/api/accounts').send({ name: 'Account A', type: 'Cash', value: 1000 });
        await request(app).post('/api/accounts').send({ name: 'Account B', type: 'Cash', value: 2000 });

        const beforeRestore = (await request(app).get('/api/state')).body;
        expect(beforeRestore.customAccounts).toHaveLength(2);

        // Restore to a completely fresh state
        const freshState = { ...BLANK_STATE };
        const restoreRes = await request(app).post('/api/state').send(freshState);
        expect(restoreRes.status).toBe(200);

        const afterRestore = (await request(app).get('/api/state')).body;
        expect(afterRestore.customAccounts).toHaveLength(0);
    });

    it('backup/restore preserves complex state', async () => {
        await resetState();

        const complexState = {
            ...BLANK_STATE,
            taxRate: 28,
            expenses: { housing: 3000, utilities: 400, food: 800, transport: 600, healthcare: 300, discretionary: 700 },
            customAccounts: [{ id: 'test-1', name: 'HYSA', type: 'Savings', value: 50000, apy: 4.5 }],
            cds: [{ id: 'cd-1', bank: 'Marcus', principal: 25000, rate: 5.1, startDate: '2024-01-01', maturity: '2025-01-01' }]
        };

        await request(app).post('/api/state').send(complexState);

        const restored = (await request(app).get('/api/state')).body;
        expect(restored.taxRate).toBe(28);
        expect(restored.customAccounts).toHaveLength(1);
        expect(restored.customAccounts[0].apy).toBe(4.5);
        expect(restored.cds[0].principal).toBe(25000);
    });
});

// ─── Chain 5: Multi-entity portfolio workflow ──────────────────────────────────

describe('Multi-Entity Portfolio Workflow', () => {
    it('builds a complete portfolio and calculates net worth', async () => {
        await resetState();

        // Add savings account
        await request(app).post('/api/accounts').send({ name: 'Emergency Fund', type: 'Cash', value: 15000 });

        // Add brokerage
        await request(app).post('/api/accounts').send({ name: 'Fidelity', type: 'Brokerage', value: 80000 });

        // Add two CDs
        await request(app).post('/api/cds').send({ bank: 'Ally', principal: 10000, rate: 4.5, maturity: '2025-06-01' });
        await request(app).post('/api/cds').send({ bank: 'Discover', principal: 15000, rate: 5.0, maturity: '2025-12-01' });

        const state = (await request(app).get('/api/state')).body;
        const nw = getAggregateNetWorth(state);

        // Cash=15000, Equities=80000, CDs=25000 → total=120000
        expect(nw).toBe(120000);
        expect(state.customAccounts).toHaveLength(2);
        expect(state.cds).toHaveLength(2);
    });

    it('removing an account correctly reduces net worth', async () => {
        await resetState();
        const r1 = await request(app).post('/api/accounts').send({ name: 'Big Account', type: 'Cash', value: 100000 });
        await request(app).post('/api/accounts').send({ name: 'Small Account', type: 'Cash', value: 5000 });

        await request(app).delete(`/api/accounts/${r1.body.id}`);

        const state = (await request(app).get('/api/state')).body;
        const nw = getAggregateNetWorth(state);
        expect(nw).toBe(5000);
    });
});
