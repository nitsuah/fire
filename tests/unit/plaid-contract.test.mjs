import {
    vi,
    describe,
    it,
    expect,
    beforeAll,
    beforeEach,
    afterEach,
    afterAll,
} from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import request from 'supertest';

// Provider contract for Plaid: the self-hosted Express routes
// (app/routes/plaid.js) and the hosted Netlify Function
// (netlify/functions/plaid.mjs) are two adapters over one service
// (app/lib/plaid-service.js). Each scenario below runs the same
// Link → exchange → accounts → positions → transactions flow against both,
// with Plaid mocked, and checks the guarantees they must share: access
// tokens and provider messages never reach the browser, inputs are
// validated before any Plaid call, and a deploy without credentials says
// "not configured" instead of failing open.

const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-plaid-contract-'),
);
const TEST_DB = path.join(TEST_DATA_DIR, 'db.json');
process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB;
// Test-only key, not a real secret.
const MASTER_KEY = '33'.repeat(32);
process.env.SYNC_MASTER_KEY = MASTER_KEY;
const PREV_FIRE_AUTH_DISABLED = process.env.FIRE_AUTH_DISABLED;
process.env.FIRE_AUTH_DISABLED = 'true';

const TOKEN_FILE = path.join(TEST_DATA_DIR, 'tokens-plaid.json');
const ACCESS_TOKEN = 'access-sandbox-contract-secret';
const PROVIDER_MESSAGE = 'internal provider detail that must stay private';

function writeDb() {
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
        }),
    );
}
writeDb();

// Stubs Plaid by API path. A route returns a JSON body, or [status, body].
function plaidMock(routes) {
    const fn = vi.fn(async (url, init) => {
        const route = routes[new URL(url).pathname];
        if (!route) throw new Error(`unexpected Plaid call ${url}`);
        const result = await route(JSON.parse(init.body));
        const [status, body] = Array.isArray(result) ? result : [200, result];
        return new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
        });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
}

const HAPPY_PLAID = {
    '/link/token/create': () => ({ link_token: 'link-sandbox-123' }),
    '/item/public_token/exchange': () => ({
        access_token: ACCESS_TOKEN,
        item_id: 'item-1',
    }),
    '/accounts/balance/get': () => ({
        accounts: [
            {
                account_id: 'acc1',
                name: 'Brokerage',
                type: 'investment',
                balances: { current: 1234 },
            },
        ],
    }),
    '/investments/holdings/get': () => ({
        holdings: [
            {
                security_id: 'sec1',
                quantity: 3,
                institution_value: 300,
                cost_basis: 250,
            },
        ],
        securities: [
            { security_id: 'sec1', ticker_symbol: 'VTI', name: 'VTI' },
        ],
    }),
    '/transactions/sync': () => ({
        added: [
            {
                transaction_id: 'txn1',
                amount: 42.5,
                date: '2026-11-01',
                name: 'Grocery Store',
                merchant_name: 'Grocery Store',
                pending: false,
                personal_finance_category: {
                    primary: 'FOOD_AND_DRINK',
                    detailed: 'FOOD_AND_DRINK_GROCERIES',
                },
            },
        ],
        modified: [],
        removed: [],
        has_more: false,
        next_cursor: 'cursor-1',
    }),
};

// ─── Adapters ────────────────────────────────────────────────────────────────
// Each exposes call(method, endpoint, body) → { status, body, raw }, where
// `raw` is everything the browser receives (body + headers) as text.

let app;
let readState;

function expressAdapter() {
    return {
        name: 'express',
        reset() {
            writeDb();
            fs.rmSync(TOKEN_FILE, { force: true });
        },
        async call(method, endpoint, body) {
            const url = `/api/sync/plaid/${endpoint}`;
            const req =
                method === 'GET'
                    ? request(app).get(url)
                    : request(app)
                          .post(url)
                          .send(body || {});
            const res = await req;
            return {
                status: res.status,
                body: res.body,
                raw: JSON.stringify(res.headers) + res.text,
            };
        },
        // Where the synced rows end up: server state.
        accounts: () => readState().customAccounts,
        positions: () => readState().importedPositions,
        transactions: () => readState().spendingTransactions,
    };
}

function netlifyAdapter() {
    let handler;
    let jar = '';
    return {
        name: 'netlify',
        async reset() {
            ({ default: handler } =
                await import('../../netlify/functions/plaid.mjs'));
            jar = '';
            this.rows = { accounts: [], positions: [], transactions: [] };
        },
        async call(method, endpoint, body) {
            const res = await handler(
                new Request(
                    `https://lifefire.netlify.app/api/sync/plaid/${endpoint}`,
                    {
                        method,
                        headers: {
                            'content-type': 'application/json',
                            ...(jar ? { cookie: jar } : {}),
                        },
                        ...(method === 'GET'
                            ? {}
                            : { body: JSON.stringify(body || {}) }),
                    },
                ),
            );
            const setCookies = res.headers.getSetCookie();
            if (setCookies.length) {
                jar = setCookies
                    .filter((c) => !/Max-Age=0/.test(c))
                    .map((c) => c.split(';')[0])
                    .join('; ');
            }
            const text = await res.text();
            const parsed = JSON.parse(text);
            // The hosted browser owns its state: keep what came back.
            if (parsed.accounts) this.rows.accounts = parsed.accounts;
            if (parsed.positions) this.rows.positions = parsed.positions;
            if (parsed.transactions)
                this.rows.transactions = parsed.transactions.added;
            return {
                status: res.status,
                body: parsed,
                setCookies,
                // The cookie value is sealed, never readable by the page;
                // the page sees the body plus the readable headers.
                raw: text,
            };
        },
        accounts() {
            return this.rows.accounts;
        },
        positions() {
            return this.rows.positions;
        },
        transactions() {
            return this.rows.transactions;
        },
    };
}

beforeAll(async () => {
    ({ readState } = await import('../../app/lib/db.js'));
    app = (await import('../../app/server.js')).default;
});

afterAll(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    if (PREV_FIRE_AUTH_DISABLED === undefined)
        delete process.env.FIRE_AUTH_DISABLED;
    else process.env.FIRE_AUTH_DISABLED = PREV_FIRE_AUTH_DISABLED;
    delete process.env.FIRE_DATA_DIR;
    delete process.env.SYNC_MASTER_KEY;
});

describe.each([expressAdapter(), netlifyAdapter()])(
    'Plaid provider contract: $name',
    (adapter) => {
        beforeEach(async () => {
            process.env.PLAID_CLIENT_ID = 'client-id';
            process.env.PLAID_SECRET = 'secret';
            process.env.PLAID_ENV = 'sandbox';
            process.env.SYNC_MASTER_KEY = MASTER_KEY;
            delete process.env.PLAID_HOSTED_ACCESS_KEY;
            await adapter.reset();
        });

        afterEach(() => {
            delete process.env.PLAID_CLIENT_ID;
            delete process.env.PLAID_SECRET;
            delete process.env.PLAID_ENV;
            vi.unstubAllGlobals();
            vi.restoreAllMocks();
        });

        async function link() {
            plaidMock(HAPPY_PLAID);
            const res = await adapter.call('POST', 'exchange', {
                public_token: 'public-sandbox-abc',
            });
            expect(res.status).toBe(200);
            return res;
        }

        it('reports configured but not connected before linking', async () => {
            const res = await adapter.call('GET', 'status');
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                connected: false,
                configured: true,
                itemCount: 0,
                reauthRequired: false,
            });
        });

        it('runs Link → exchange → accounts → positions → transactions', async () => {
            const fetchMock = plaidMock(HAPPY_PLAID);
            const linkRes = await adapter.call('POST', 'create-link-token');
            expect(linkRes.status).toBe(200);
            expect(linkRes.body.linkToken).toBe('link-sandbox-123');

            const exchangeRes = await link();
            expect(exchangeRes.body).toMatchObject({
                status: 'success',
                itemId: 'item-1',
            });

            const status = await adapter.call('GET', 'status');
            expect(status.body).toMatchObject({
                connected: true,
                itemCount: 1,
            });

            const accounts = await adapter.call('POST', 'accounts');
            expect(accounts.status).toBe(200);
            expect(accounts.body).toMatchObject({
                status: 'success',
                accountCount: 1,
                syncedItemIds: ['item-1'],
            });
            expect(adapter.accounts()).toEqual([
                expect.objectContaining({
                    id: 'plaid-acc1',
                    type: 'Brokerage',
                    value: 1234,
                    plaidItemId: 'item-1',
                    source: 'plaid',
                }),
            ]);

            const positions = await adapter.call('POST', 'positions');
            expect(positions.status).toBe(200);
            expect(positions.body.positionCount).toBe(1);
            expect(adapter.positions()).toEqual([
                expect.objectContaining({
                    symbol: 'VTI',
                    quantity: 3,
                    value: 300,
                    costBasis: 250,
                }),
            ]);

            const txns = await adapter.call('POST', 'transactions');
            expect(txns.status).toBe(200);
            expect(txns.body).toMatchObject({ status: 'success', added: 1 });
            expect(adapter.transactions()).toEqual([
                expect.objectContaining({ id: 'plaid-txn1' }),
            ]);

            // The stored cursor carries into the next sync.
            const cursors = [];
            plaidMock({
                '/transactions/sync': (body) => {
                    cursors.push(body.cursor);
                    return {
                        added: [],
                        modified: [],
                        removed: [],
                        has_more: false,
                        next_cursor: 'cursor-2',
                    };
                },
            });
            const again = await adapter.call('POST', 'transactions');
            expect(again.status).toBe(200);
            expect(cursors).toEqual(['cursor-1']);
            expect(fetchMock).toHaveBeenCalled();
        });

        it('never hands the browser an access token', async () => {
            const responses = [await link()];
            plaidMock(HAPPY_PLAID);
            for (const [method, endpoint] of [
                ['GET', 'status'],
                ['POST', 'accounts'],
                ['POST', 'positions'],
                ['POST', 'transactions'],
            ]) {
                responses.push(await adapter.call(method, endpoint));
            }
            for (const res of responses) {
                expect(res.raw).not.toContain(ACCESS_TOKEN);
                expect(res.raw).not.toContain('access-sandbox');
            }
        });

        it('keeps provider messages out of error bodies', async () => {
            plaidMock({
                '/link/token/create': () => [
                    400,
                    {
                        error_code: 'INVALID_FIELD',
                        error_message: PROVIDER_MESSAGE,
                        display_message: PROVIDER_MESSAGE,
                    },
                ],
            });
            const res = await adapter.call('POST', 'create-link-token');
            expect(res.status).toBe(502);
            expect(res.body.error).toBeTruthy();
            expect(res.raw).not.toContain(PROVIDER_MESSAGE);
        });

        it('keeps provider messages out of a failed sync', async () => {
            await link();
            plaidMock({
                '/accounts/balance/get': () => [
                    400,
                    {
                        error_code: 'ITEM_LOGIN_REQUIRED',
                        error_message: PROVIDER_MESSAGE,
                    },
                ],
            });
            const res = await adapter.call('POST', 'accounts');
            expect(res.status).toBe(502);
            expect(res.body.error).toMatch(/Existing data preserved/);
            expect(res.raw).not.toContain(PROVIDER_MESSAGE);
        });

        it('flags re-link after a dead grant and clears it after a good sync', async () => {
            await link();
            plaidMock({
                '/transactions/sync': () => [
                    400,
                    { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'x' },
                ],
            });
            expect((await adapter.call('POST', 'transactions')).status).toBe(
                502,
            );
            let status = await adapter.call('GET', 'status');
            expect(status.body.reauthRequired).toBe(true);
            expect(status.body.lastSync).toMatchObject({
                ok: false,
                errorCode: 'ITEM_LOGIN_REQUIRED',
            });

            // Re-linking the same Item replaces its grant.
            await link();
            plaidMock(HAPPY_PLAID);
            expect((await adapter.call('POST', 'transactions')).status).toBe(
                200,
            );
            status = await adapter.call('GET', 'status');
            expect(status.body.reauthRequired).toBe(false);
            expect(status.body.lastSync).toMatchObject({ ok: true });
            expect(status.body.itemCount).toBe(1);
        });

        it.each([
            [{}, /public_token is required/],
            [{ public_token: 42 }, /valid public_token/],
            [{ public_token: 'access-sandbox-xyz' }, /valid public_token/],
            [{ public_token: 'public-<script>' }, /valid public_token/],
            [
                { public_token: `public-${'a'.repeat(300)}` },
                /valid public_token/,
            ],
        ])(
            'rejects exchange body %j before calling Plaid',
            async (body, message) => {
                const fetchMock = plaidMock(HAPPY_PLAID);
                const res = await adapter.call('POST', 'exchange', body);
                expect(res.status).toBe(400);
                expect(res.body.error).toMatch(message);
                expect(fetchMock).not.toHaveBeenCalled();
            },
        );

        it('rejects a non-boolean toggle', async () => {
            const res = await adapter.call('POST', 'toggle', {
                enabled: 'yes',
            });
            expect(res.status).toBe(400);
        });

        it('answers sync before linking with 401, without calling Plaid', async () => {
            const fetchMock = plaidMock(HAPPY_PLAID);
            for (const endpoint of ['accounts', 'positions', 'transactions']) {
                const res = await adapter.call('POST', endpoint);
                expect(res.status).toBe(401);
            }
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('fails closed with a "not configured" state when credentials are missing', async () => {
            delete process.env.PLAID_CLIENT_ID;
            delete process.env.PLAID_SECRET;
            const fetchMock = plaidMock(HAPPY_PLAID);
            const status = await adapter.call('GET', 'status');
            expect(status.status).toBe(200);
            expect(status.body).toMatchObject({
                configured: false,
                connected: false,
            });
            const linkRes = await adapter.call('POST', 'create-link-token');
            expect(linkRes.status).toBe(503);
            expect(linkRes.body.error).toMatch(/not configured/i);
            const exchange = await adapter.call('POST', 'exchange', {
                public_token: 'public-sandbox-abc',
            });
            expect(exchange.status).toBe(503);
            expect(fetchMock).not.toHaveBeenCalled();
        });
    },
);

describe('netlify adapter grant cookie', () => {
    beforeEach(() => {
        process.env.PLAID_CLIENT_ID = 'client-id';
        process.env.PLAID_SECRET = 'secret';
        process.env.PLAID_ENV = 'sandbox';
        process.env.SYNC_MASTER_KEY = MASTER_KEY;
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('stores the sealed grant HttpOnly, Secure and SameSite=Strict', async () => {
        const adapter = netlifyAdapter();
        await adapter.reset();
        plaidMock(HAPPY_PLAID);
        const res = await adapter.call('POST', 'exchange', {
            public_token: 'public-sandbox-abc',
        });
        expect(res.body.plaidToken).toBe('cookie');
        const grantCookies = res.setCookies.filter((c) =>
            c.startsWith('plaid_grant'),
        );
        expect(grantCookies.length).toBeGreaterThan(0);
        for (const cookie of grantCookies) {
            expect(cookie).toMatch(/HttpOnly/i);
            expect(cookie).toMatch(/Secure/i);
            expect(cookie).toMatch(/SameSite=Strict/i);
            expect(cookie).not.toContain(ACCESS_TOKEN);
        }
    });
});

describe('plaid-service helpers', () => {
    let plaid;
    beforeAll(async () => {
        plaid = (await import('../../app/lib/plaid-service.js')).default;
    });

    it('upserts a re-linked Item, keeping its cursor and dropping its error', () => {
        const items = [
            {
                itemId: 'item-1',
                accessToken: 'old',
                transactionsCursor: 'c1',
                lastErrorCode: 'ITEM_LOGIN_REQUIRED',
            },
        ];
        const next = plaid.upsertItem(items, {
            itemId: 'item-1',
            accessToken: 'new',
        });
        expect(next).toEqual([
            { itemId: 'item-1', accessToken: 'new', transactionsCursor: 'c1' },
        ]);
        expect(items[0].accessToken).toBe('old');
        expect(
            plaid.upsertItem(next, { itemId: 'item-2', accessToken: 'b' }),
        ).toHaveLength(2);
    });

    it('applies removals, deduplicated additions and upserted modifications', () => {
        const list = [
            { id: 'plaid-a', amount: 1 },
            { id: 'plaid-b', amount: 2 },
        ];
        const counts = plaid.applyTransactions(list, {
            removedIds: ['plaid-a'],
            added: [
                { id: 'plaid-b', amount: 99 },
                { id: 'plaid-c', amount: 3 },
            ],
            modified: [{ id: 'plaid-b', amount: 20 }],
        });
        expect(counts).toEqual({ added: 1, modified: 1, removed: 1 });
        expect(list).toEqual([
            { id: 'plaid-b', amount: 20 },
            { id: 'plaid-c', amount: 3 },
        ]);
    });

    it('keeps a failed Item’s rows and other sources when merging', () => {
        const existing = [
            { id: 'manual', source: 'manual' },
            { id: 'plaid-x', source: 'plaid', plaidItemId: 'item-bad' },
            { id: 'plaid-y', source: 'plaid', plaidItemId: 'item-ok' },
            { id: 'plaid-legacy', source: 'plaid' },
        ];
        const merged = plaid.mergePlaidRows(
            existing,
            [{ id: 'plaid-z', source: 'plaid', plaidItemId: 'item-ok' }],
            ['item-ok'],
            1,
            true,
        );
        expect(merged.map((r) => r.id)).toEqual([
            'manual',
            'plaid-x',
            'plaid-legacy',
            'plaid-z',
        ]);
    });

    it('maps a network failure to a generic 502 and a timeout to 504', async () => {
        process.env.PLAID_CLIENT_ID = 'client-id';
        process.env.PLAID_SECRET = 'secret';
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('ECONNRESET secret detail')),
        );
        await expect(plaid.createLinkToken()).rejects.toMatchObject({
            status: 502,
            message: 'Could not reach Plaid.',
        });
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockRejectedValue(
                    Object.assign(new Error('t'), { name: 'TimeoutError' }),
                ),
        );
        await expect(plaid.createLinkToken()).rejects.toMatchObject({
            status: 504,
        });
        vi.unstubAllGlobals();
    });
});
