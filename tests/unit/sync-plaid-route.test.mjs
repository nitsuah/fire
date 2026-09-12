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

    // Regression tests for CodeRabbit findings on PR #108: /transactions/sync
    // returns added/modified/removed (all three must be applied before the
    // cursor advances), an item completing pagination with zero new
    // transactions is a real success (not "everything failed"), and
    // exhausting the page-cap mid-pagination must not silently advance the
    // cursor past unfetched data.

    it('applies a modified transaction as an update to the existing record', async () => {
        writePlaidTokens([{ itemId: 'item-1', accessToken: 'access-1' }]);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    added: [
                        {
                            transaction_id: 'txn-1',
                            amount: 20,
                            date: '2026-01-05',
                            name: 'Coffee Shop',
                            pending: false,
                            personal_finance_category: {
                                primary: 'FOOD_AND_DRINK',
                                detailed: 'FOOD_AND_DRINK_COFFEE',
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

        // A later sync reports the same transaction as modified (e.g. its
        // pending amount was finalized on posting) with a different amount.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    added: [],
                    modified: [
                        {
                            transaction_id: 'txn-1',
                            amount: 24.5,
                            date: '2026-01-05',
                            name: 'Coffee Shop',
                            pending: false,
                            personal_finance_category: {
                                primary: 'FOOD_AND_DRINK',
                                detailed: 'FOOD_AND_DRINK_COFFEE',
                            },
                        },
                    ],
                    removed: [],
                    has_more: false,
                    next_cursor: 'cursor-2',
                }),
            }),
        );
        const second = await request(app).post('/api/sync/plaid/transactions');
        expect(second.status).toBe(200);
        expect(second.body.modified).toBe(1);

        const db = readState();
        expect(db.spendingTransactions).toHaveLength(1);
        expect(db.spendingTransactions[0]).toMatchObject({
            id: 'plaid-txn-1',
            amount: 24.5,
        });
    });

    it('applies a removed transaction as a deletion of the existing record', async () => {
        writePlaidTokens([{ itemId: 'item-1', accessToken: 'access-1' }]);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    added: [
                        {
                            transaction_id: 'txn-1',
                            amount: 20,
                            date: '2026-01-05',
                            name: 'Coffee Shop',
                            pending: false,
                            personal_finance_category: {
                                primary: 'FOOD_AND_DRINK',
                                detailed: 'FOOD_AND_DRINK_COFFEE',
                            },
                        },
                    ],
                    has_more: false,
                    next_cursor: 'cursor-1',
                }),
            }),
        );
        await request(app).post('/api/sync/plaid/transactions');

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    added: [],
                    modified: [],
                    removed: [{ transaction_id: 'txn-1' }],
                    has_more: false,
                    next_cursor: 'cursor-2',
                }),
            }),
        );
        const res = await request(app).post('/api/sync/plaid/transactions');
        expect(res.status).toBe(200);
        expect(res.body.removed).toBe(1);

        const db = readState();
        expect(db.spendingTransactions).toHaveLength(0);
    });

    it('treats a successful item with zero new transactions as success, not total failure, when a sibling item fails', async () => {
        writePlaidTokens([
            { itemId: 'item-empty-ok', accessToken: 'access-ok' },
            { itemId: 'item-bad', accessToken: 'access-bad' },
        ]);
        let call = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() => {
                call++;
                if (call === 1) {
                    // Completes successfully with nothing new -- a real,
                    // common no-op sync, not a failure.
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            added: [],
                            has_more: false,
                            next_cursor: 'cursor-empty-ok',
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
        expect(res.body.added).toBe(0);
        expect(res.body.warning).toMatch(/1 item/i);

        // The successful item's advanced cursor must actually be
        // persisted -- previously, the (now-removed) allRawTxns.length===0
        // check would return 502 here and never reach saveTokens at all.
        const tokenData = JSON.parse(
            fs.readFileSync(
                path.join(TEST_DATA_DIR, 'tokens-plaid.json'),
                'utf8',
            ),
        );
        const decrypted = JSON.parse(
            (await import('../../app/lib/crypto-utils.js')).decrypt(
                tokenData.data,
            ),
        );
        const okItem = decrypted.items.find(
            (i) => i.itemId === 'item-empty-ok',
        );
        expect(okItem.transactionsCursor).toBe('cursor-empty-ok');
    });

    it('discards the batch and keeps the original cursor when pagination never finishes within the page cap', async () => {
        writePlaidTokens([
            {
                itemId: 'item-1',
                accessToken: 'access-1',
                transactionsCursor: 'original-cursor',
            },
        ]);
        // Every page reports has_more: true and a fresh page of "added"
        // transactions -- pagination genuinely never completes within the
        // 20-page defensive cap.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => ({
                        added: [
                            {
                                transaction_id: `txn-endless-${Math.random()}`,
                                amount: 5,
                                date: '2026-01-05',
                                name: 'Endless Co',
                                pending: false,
                                personal_finance_category: {
                                    primary: 'FOOD_AND_DRINK',
                                    detailed: 'FOOD_AND_DRINK_COFFEE',
                                },
                            },
                        ],
                        has_more: true,
                        next_cursor: 'still-going',
                    }),
                }),
            ),
        );

        const res = await request(app).post('/api/sync/plaid/transactions');
        // The only item present never completed pagination, so this is a
        // total failure -- not a partial one.
        expect(res.status).toBe(502);

        // Nothing from the interrupted batch should have been saved, and
        // the cursor must remain exactly what it was before this attempt
        // (not advanced to wherever the 20-page cap happened to land) so
        // the next sync restarts this item from the true beginning.
        const db = readState();
        expect(db.spendingTransactions).toHaveLength(0);

        const tokenData = JSON.parse(
            fs.readFileSync(
                path.join(TEST_DATA_DIR, 'tokens-plaid.json'),
                'utf8',
            ),
        );
        const decrypted = JSON.parse(
            (await import('../../app/lib/crypto-utils.js')).decrypt(
                tokenData.data,
            ),
        );
        expect(decrypted.items[0].transactionsCursor).toBe('original-cursor');
    });

    it('reports a specific failure, without claiming success, when saving the sync cursor fails', async () => {
        writePlaidTokens([{ itemId: 'item-1', accessToken: 'access-1' }]);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    added: [
                        {
                            transaction_id: 'txn-1',
                            amount: 20,
                            date: '2026-01-05',
                            name: 'Coffee Shop',
                            pending: false,
                            personal_finance_category: {
                                primary: 'FOOD_AND_DRINK',
                                detailed: 'FOOD_AND_DRINK_COFFEE',
                            },
                        },
                    ],
                    has_more: false,
                    next_cursor: 'cursor-1',
                }),
            }),
        );
        const originalWriteFileSync = fs.writeFileSync;
        const writeSpy = vi
            .spyOn(fs, 'writeFileSync')
            .mockImplementation((filePath, ...args) => {
                if (String(filePath).includes('tokens-plaid.json')) {
                    throw new Error('disk full');
                }
                return originalWriteFileSync(filePath, ...args);
            });

        const res = await request(app).post('/api/sync/plaid/transactions');
        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/cursor/i);

        // The transaction itself is still saved (mutateState succeeded
        // before the token-file write failed) -- only the cursor didn't
        // move, which the next sync will safely re-fetch and re-apply.
        writeSpy.mockRestore();
        const db = readState();
        expect(db.spendingTransactions).toHaveLength(1);
    });
});
