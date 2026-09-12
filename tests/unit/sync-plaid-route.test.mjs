import {
    vi,
    describe,
    it,
    expect,
    beforeAll,
    afterEach,
    afterAll,
} from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

// Route-level coverage for the Plaid transaction-sync endpoint (TASKS.md
// "PROD Phase 2 / Fidelity-Plaid") added alongside the "Plaid Transaction
// Sync" Settings card. Mirrors tests/unit/sync-ebay-route.test.mjs's
// isolation approach (own DB file, FIRE_AUTH_DISABLED opt-out with
// save/restore since Vitest can reuse worker processes across test files),
// plus its own isolated FIRE_DATA_DIR so tokens-plaid.json never touches
// the real app/data directory.
//
// The happy-path / dedup / partial-failure tests below exercise
// /plaid/transactions against a stubbed global `fetch` standing in for
// Plaid's /transactions/sync API (the same mocking approach
// tests/unit/vehicles-route.test.mjs uses for the VIN-decode endpoint) —
// this validates our own categorization + dedup logic thoroughly without
// needing a real Plaid sandbox account. What this environment genuinely
// can't verify is whether Plaid's actual API responses (auth errors,
// pagination edge cases, real personal_finance_category values) match the
// shape assumed here; see TASKS.md for that caveat.
const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-sync-plaid-test-'),
);
const TEST_DB = path.join(TEST_DATA_DIR, 'db.json');
process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB;
// Test-only 64-hex-char key (not a real secret) — required because
// sync.js's Plaid token store (app/lib/crypto-utils.js) throws without
// SYNC_MASTER_KEY, and setting it also makes db.js encrypt db.json at
// rest; assertions below go through readState() (which transparently
// decrypts) rather than parsing the file directly for that reason.
process.env.SYNC_MASTER_KEY = '11'.repeat(32);
const PREV_FIRE_AUTH_DISABLED = process.env.FIRE_AUTH_DISABLED;
process.env.FIRE_AUTH_DISABLED = 'true';

function writeDb(overrides = {}) {
    fs.writeFileSync(
        TEST_DB,
        JSON.stringify({
            importedPositions: [],
            customAccounts: [],
            cds: [],
            wallets: [],
            expenses: {},
            taxRate: 0,
            sideGigLedger: [],
            spendingTransactions: [],
            projectionSettings: {},
            importedFiles: [],
            ...overrides,
        }),
    );
}

writeDb();

let app;
let encrypt;
let readState;

beforeAll(async () => {
    ({ encrypt } = await import('../../app/lib/crypto-utils.js'));
    ({ readState } = await import('../../app/lib/db.js'));
    app = (await import('../../app/server.js')).default;
});

function writePlaidTokens(items, extra = {}) {
    const tokenData = {
        lastUpdated: new Date().toISOString(),
        data: encrypt(JSON.stringify({ items, ...extra })),
    };
    fs.writeFileSync(
        path.join(TEST_DATA_DIR, 'tokens-plaid.json'),
        JSON.stringify(tokenData),
    );
}

afterEach(() => {
    writeDb();
    try {
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'tokens-plaid.json'));
    } catch {
        /* ignore */
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

afterAll(() => {
    try {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
    if (PREV_FIRE_AUTH_DISABLED === undefined) {
        delete process.env.FIRE_AUTH_DISABLED;
    } else {
        process.env.FIRE_AUTH_DISABLED = PREV_FIRE_AUTH_DISABLED;
    }
    delete process.env.FIRE_DATA_DIR;
    delete process.env.SYNC_MASTER_KEY;
});

describe('GET /api/sync/plaid/status', () => {
    it('reports not connected with sync enabled by default', async () => {
        const res = await request(app).get('/api/sync/plaid/status');
        expect(res.status).toBe(200);
        expect(res.body.connected).toBe(false);
        expect(res.body.syncEnabled).toBe(true);
    });

    it('reflects a previously toggled-off sync setting', async () => {
        await request(app)
            .post('/api/sync/plaid/toggle')
            .send({ enabled: false });
        const res = await request(app).get('/api/sync/plaid/status');
        expect(res.body.syncEnabled).toBe(false);
    });

    it('reports itemCount once linked', async () => {
        writePlaidTokens([{ itemId: 'item-1', accessToken: 'access-1' }]);
        const res = await request(app).get('/api/sync/plaid/status');
        expect(res.status).toBe(200);
        expect(res.body.connected).toBe(true);
        expect(res.body.itemCount).toBe(1);
        // Note: res.body.lastUpdated is NOT asserted here — it's a
        // pre-existing bug (not introduced by this change) where the
        // route reads `tokens.lastUpdated`, a field loadTokens() never
        // actually sets (it sets `_tokenLastUpdated` instead), so this
        // has always been undefined. Out of scope for the Plaid
        // transaction-sync work; flagged separately.
    });
});

describe('POST /api/sync/plaid/toggle', () => {
    it('rejects a missing enabled field', async () => {
        const res = await request(app).post('/api/sync/plaid/toggle').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/enabled/i);
    });

    it('rejects a non-boolean enabled value', async () => {
        const res = await request(app)
            .post('/api/sync/plaid/toggle')
            .send({ enabled: 'yes' });
        expect(res.status).toBe(400);
    });

    it('persists enabled: true and enabled: false', async () => {
        let res = await request(app)
            .post('/api/sync/plaid/toggle')
            .send({ enabled: true });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ enabled: true });

        res = await request(app)
            .post('/api/sync/plaid/toggle')
            .send({ enabled: false });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ enabled: false });

        const status = await request(app).get('/api/sync/plaid/status');
        expect(status.body.syncEnabled).toBe(false);
    });
});

describe('POST /api/sync/plaid/transactions', () => {
    it('is blocked with 403 while sync is disabled, before token lookup', async () => {
        await request(app)
            .post('/api/sync/plaid/toggle')
            .send({ enabled: false });

        const res = await request(app).post('/api/sync/plaid/transactions');
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/disabled/i);
    });

    it('falls through to the no-token 401 once re-enabled', async () => {
        await request(app)
            .post('/api/sync/plaid/toggle')
            .send({ enabled: true });

        const res = await request(app).post('/api/sync/plaid/transactions');
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/No Plaid tokens/i);
    });

    it('fetches, categorizes via the shared expense pipeline, and stores new transactions', async () => {
        writePlaidTokens([{ itemId: 'item-1', accessToken: 'access-1' }]);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    added: [
                        {
                            transaction_id: 'txn-1',
                            amount: 84.32,
                            date: '2026-01-05',
                            name: 'Whole Foods',
                            merchant_name: 'Whole Foods',
                            pending: false,
                            personal_finance_category: {
                                primary: 'FOOD_AND_DRINK',
                                detailed: 'FOOD_AND_DRINK_GROCERIES',
                            },
                        },
                        // Incoming money (paycheck) — not an expense, must
                        // be excluded regardless of category.
                        {
                            transaction_id: 'txn-2',
                            amount: -2500,
                            date: '2026-01-06',
                            name: 'Paycheck Deposit',
                            pending: false,
                            personal_finance_category: {
                                primary: 'INCOME',
                                detailed: 'INCOME_WAGES',
                            },
                        },
                        // Still pending — excluded until it posts.
                        {
                            transaction_id: 'txn-3',
                            amount: 42.1,
                            date: '2026-01-07',
                            name: 'Shell Gas Station',
                            pending: true,
                            personal_finance_category: {
                                primary: 'TRANSPORTATION',
                                detailed: 'TRANSPORTATION_GAS',
                            },
                        },
                    ],
                    has_more: false,
                    next_cursor: 'cursor-1',
                }),
            }),
        );

        const res = await request(app).post('/api/sync/plaid/transactions');
        expect(res.status).toBe(200);
        expect(res.body.fetched).toBe(1);
        expect(res.body.added).toBe(1);
        expect(res.body.syncedAt).toBeTruthy();

        const db = readState();
        expect(db.spendingTransactions).toHaveLength(1);
        expect(db.spendingTransactions[0]).toMatchObject({
            id: 'plaid-txn-1',
            merchant: 'Whole Foods',
            amount: 84.32,
            category: 'food',
        });
    });

    it('does not duplicate a transaction already synced', async () => {
        writePlaidTokens([{ itemId: 'item-1', accessToken: 'access-1' }]);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    added: [
                        {
                            transaction_id: 'txn-1',
                            amount: 18.5,
                            date: '2026-01-05',
                            name: 'CVS Pharmacy',
                            pending: false,
                            personal_finance_category: {
                                primary: 'MEDICAL',
                                detailed: 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS',
                            },
                        },
                    ],
                    has_more: false,
                    next_cursor: 'cursor-1',
                }),
            }),
        );

        const first = await request(app).post('/api/sync/plaid/transactions');
        expect(first.body.added).toBe(1);

        const second = await request(app).post('/api/sync/plaid/transactions');
        expect(second.status).toBe(200);
        expect(second.body.fetched).toBe(1);
        expect(second.body.added).toBe(0);

        const db = readState();
        expect(db.spendingTransactions).toHaveLength(1);
    });

    it('falls back to merchant-keyword categorization when Plaid category is unrecognized', async () => {
        writePlaidTokens([{ itemId: 'item-1', accessToken: 'access-1' }]);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    added: [
                        {
                            transaction_id: 'txn-1',
                            amount: 12.99,
                            date: '2026-01-05',
                            name: 'STARBUCKS #445',
                            pending: false,
                            // No personal_finance_category and no legacy
                            // category array at all — forces the
                            // merchant-keyword fallback.
                        },
                    ],
                    has_more: false,
                    next_cursor: 'cursor-1',
                }),
            }),
        );

        const res = await request(app).post('/api/sync/plaid/transactions');
        expect(res.status).toBe(200);
        const db = readState();
        expect(db.spendingTransactions[0].category).toBe('food');
    });

    it('returns 502 when every linked item fetch fails', async () => {
        writePlaidTokens([{ itemId: 'item-1', accessToken: 'access-1' }]);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            }),
        );

        const res = await request(app).post('/api/sync/plaid/transactions');
        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/failed/i);
    });

    it('reports a partial-failure warning when only some items fail', async () => {
        writePlaidTokens([
            { itemId: 'item-ok', accessToken: 'access-ok' },
            { itemId: 'item-bad', accessToken: 'access-bad' },
        ]);
        let call = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() => {
                call++;
                if (call === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            added: [
                                {
                                    transaction_id: 'txn-1',
                                    amount: 10,
                                    date: '2026-01-05',
                                    name: 'Trader Joes',
                                    pending: false,
                                    personal_finance_category: {
                                        primary: 'FOOD_AND_DRINK',
                                        detailed: 'FOOD_AND_DRINK_GROCERIES',
                                    },
                                },
                            ],
                            has_more: false,
                            next_cursor: 'cursor-1',
                        }),
                    });
                }
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    text: async () => 'Internal Server Error',
                });
            }),
        );

        const res = await request(app).post('/api/sync/plaid/transactions');
        expect(res.status).toBe(200);
        expect(res.body.added).toBe(1);
        expect(res.body.warning).toMatch(/1 item/i);
    });
});
