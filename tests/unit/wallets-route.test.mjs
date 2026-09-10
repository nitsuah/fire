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
import express from 'express';
import request from 'supertest';

// Route-level coverage for app/routes/wallets.js — the add/remove/refresh
// CRUD endpoints backing the new "Crypto Wallets" manager card. The ENS
// lookup endpoint on this same router already has its own deterministic
// tests in wallets-ens-route.test.mjs; this file covers everything that
// reads/writes the wallet list in db.json.
const TEST_DB = path.join(
    os.tmpdir(),
    `fire-wallets-route-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;

function writeDb(overrides) {
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
            projectionSettings: {},
            importedFiles: [],
            ...overrides,
        }),
    );
}

writeDb();

let app;
const EVM_ADDR = '0x' + '1'.repeat(40);
const EVM_ADDR_2 = '0x' + '2'.repeat(40);
// Valid per the router's bech32 check (bc1 + 39-59 [a-z0-9] chars) — the
// suffix is distinct so the "last 8 chars" masking assertion is meaningful.
const BTC_ADDR = 'bc1' + 'q'.repeat(33) + 'abcdefgh';

beforeAll(async () => {
    const walletsRouter = (await import('../../app/routes/wallets.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/wallets', walletsRouter);
});

afterEach(() => {
    writeDb();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        /* ignore */
    }
});

describe('GET /api/wallets', () => {
    it('returns an empty list on a fresh db', async () => {
        const res = await request(app).get('/api/wallets');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ wallets: [], count: 0 });
    });

    it('never returns a full address — only the last 8 characters', async () => {
        const address = '0x' + 'abcdef1234567890'.repeat(3).slice(0, 40);
        writeDb({
            wallets: [
                {
                    id: 'abc123',
                    address,
                    chain: 'ethereum',
                    label: 'Main',
                    lastBalance: null,
                    lastUsdValue: null,
                    lastFetched: null,
                },
            ],
        });
        const res = await request(app).get('/api/wallets');
        const masked = res.body.wallets[0].address;
        expect(masked).toBe(`...${address.slice(-8)}`);
        expect(masked.length).toBeLessThan(address.length);
        expect(masked).not.toBe(address);
        expect(masked.startsWith('0x')).toBe(false);
    });
});

describe('POST /api/wallets', () => {
    it('rejects a request missing required fields', async () => {
        const res = await request(app)
            .post('/api/wallets')
            .send({ address: EVM_ADDR });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/required/i);
    });

    it('rejects an address that does not match the chain format', async () => {
        const res = await request(app).post('/api/wallets').send({
            address: 'not-a-valid-evm-address',
            chain: 'ethereum',
            label: 'Bad',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid address format/i);
    });

    it('rejects an unknown chain id', async () => {
        const res = await request(app).post('/api/wallets').send({
            address: EVM_ADDR,
            chain: 'not-a-real-chain',
            label: 'Bad chain',
        });
        expect(res.status).toBe(400);
    });

    it('adds a wallet and masks the address in the response', async () => {
        const res = await request(app).post('/api/wallets').send({
            address: EVM_ADDR,
            chain: 'ethereum',
            label: 'Cold Wallet',
        });
        expect(res.status).toBe(201);
        expect(res.body.label).toBe('Cold Wallet');
        expect(res.body.chain).toBe('ethereum');
        expect(res.body.address).toBe(`...${EVM_ADDR.slice(-8)}`);
        expect(res.body.id).toBeTruthy();

        const list = await request(app).get('/api/wallets');
        expect(list.body.count).toBe(1);
    });

    it('rejects a duplicate address+chain pair with 409', async () => {
        await request(app).post('/api/wallets').send({
            address: EVM_ADDR,
            chain: 'ethereum',
            label: 'First',
        });
        const res = await request(app).post('/api/wallets').send({
            address: EVM_ADDR,
            chain: 'ethereum',
            label: 'Duplicate',
        });
        expect(res.status).toBe(409);
    });

    it('allows the same address tracked on a different chain', async () => {
        await request(app).post('/api/wallets').send({
            address: EVM_ADDR,
            chain: 'ethereum',
            label: 'On Ethereum',
        });
        const res = await request(app).post('/api/wallets').send({
            address: EVM_ADDR,
            chain: 'polygon',
            label: 'On Polygon',
        });
        expect(res.status).toBe(201);
    });
});

describe('DELETE /api/wallets/:id', () => {
    it('returns 404 for an unknown id', async () => {
        const res = await request(app).delete('/api/wallets/does-not-exist');
        expect(res.status).toBe(404);
    });

    it('removes a tracked wallet', async () => {
        const created = await request(app).post('/api/wallets').send({
            address: EVM_ADDR_2,
            chain: 'ethereum',
            label: 'To Delete',
        });
        const id = created.body.id;
        const del = await request(app).delete(`/api/wallets/${id}`);
        expect(del.status).toBe(200);

        const list = await request(app).get('/api/wallets');
        expect(list.body.count).toBe(0);
    });
});

describe('POST /api/wallets/:id/refresh', () => {
    it('returns 404 for an unknown id', async () => {
        const res = await request(app).post(
            '/api/wallets/does-not-exist/refresh',
        );
        expect(res.status).toBe(404);
    });

    it('refreshes a bitcoin wallet balance using the live provider chain', async () => {
        const created = await request(app).post('/api/wallets').send({
            address: BTC_ADDR,
            chain: 'bitcoin',
            label: 'BTC Wallet',
        });
        const id = created.body.id;

        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                if (String(url).includes('blockstream.info')) {
                    return {
                        ok: true,
                        json: async () => ({
                            chain_stats: {
                                funded_txo_sum: 100000000,
                                spent_txo_sum: 0,
                            },
                        }),
                    };
                }
                if (String(url).includes('coingecko.com')) {
                    return {
                        ok: true,
                        json: async () => ({ bitcoin: { usd: 50000 } }),
                    };
                }
                throw new Error(`Unexpected fetch: ${url}`);
            }),
        );

        const res = await request(app).post(`/api/wallets/${id}/refresh`);
        expect(res.status).toBe(200);
        expect(res.body.lastBalance).toBe(1);
        expect(res.body.lastUsdValue).toBe(50000);
        expect(res.body.address).toBe(`...${BTC_ADDR.slice(-8)}`);
    });
});

describe('POST /api/wallets/refresh-all', () => {
    it('returns updated: 0 when there are no wallets', async () => {
        const res = await request(app).post('/api/wallets/refresh-all');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ updated: 0, wallets: [] });
    });

    it('refreshes every tracked wallet and reports per-wallet warnings', async () => {
        await request(app).post('/api/wallets').send({
            address: BTC_ADDR,
            chain: 'bitcoin',
            label: 'BTC Wallet',
        });

        vi.stubGlobal(
            'fetch',
            vi.fn(async (url) => {
                if (String(url).includes('blockstream.info')) {
                    return { ok: false, status: 503 };
                }
                throw new Error(`Unexpected fetch: ${url}`);
            }),
        );

        const res = await request(app).post('/api/wallets/refresh-all');
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(1);
        expect(res.body.wallets[0].warning).toMatch(/Blockstream returned 503/);
    });
});
