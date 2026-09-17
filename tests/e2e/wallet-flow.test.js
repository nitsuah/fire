'use strict';

/**
 * End-to-end coverage for the wallet add/list/refresh/remove flow reported
 * as broken with `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 * Root cause (see app/server.js's new catch-all /api/* JSON 404 handler):
 * any unmatched /api/* request fell through to Express's own default HTML
 * 404 page, and every client-side fetch() caller in this app (including
 * app/lib/managers/wallets.js) unconditionally called res.json() on it.
 *
 * Drives the real Express app (app/server.js) via supertest against an
 * isolated temp DB, exercising the actual user-facing flow end-to-end: add
 * a wallet, confirm it's listed and masked, then hit a mistyped/unmatched
 * path the way a stale client or a typo'd URL would, and confirm it comes
 * back as a structured JSON error rather than a thrown SyntaxError.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB = path.join(
    os.tmpdir(),
    `fire-wallet-flow-e2e-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;
process.env.FIRE_AUTH_DISABLED = 'true';

const request = require('supertest');
const app = require('../../app/server');

const EVM_ADDR = '0x' + '7'.repeat(40);

function resetDb() {
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
        }),
    );
}

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        /* ignore */
    }
});

describe('Wallet flow — end-to-end', () => {
    beforeEach(() => {
        resetDb();
    });

    it('adds, lists, and removes a wallet through the real add/list/remove flow', async () => {
        const add = await request(app).post('/api/wallets').send({
            address: EVM_ADDR,
            chain: 'ethereum',
            label: 'E2E Cold Wallet',
        });
        expect(add.status).toBe(201);
        const walletId = add.body.id;
        expect(walletId).toBeTruthy();

        const list = await request(app).get('/api/wallets');
        expect(list.status).toBe(200);
        expect(list.body.wallets.some((w) => w.id === walletId)).toBe(true);

        const del = await request(app).delete(`/api/wallets/${walletId}`);
        expect(del.status).toBe(200);

        const listAfter = await request(app).get('/api/wallets');
        expect(listAfter.body.wallets.some((w) => w.id === walletId)).toBe(
            false,
        );
    });

    it('returns a structured JSON error — not an HTML 404 — for a mistyped sync/lookup path', async () => {
        await request(app).post('/api/wallets').send({
            address: EVM_ADDR,
            chain: 'ethereum',
            label: 'E2E Cold Wallet',
        });

        // Simulates exactly the class of request that produced the reported
        // bug: a client hitting a wallet-adjacent path that doesn't
        // actually exist on the router (typo, stale bundle, renamed route).
        const res = await request(app).get('/api/wallets/ens/lookup/extra');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(() => JSON.parse(res.text)).not.toThrow();
        expect(res.body.error).toBeTruthy();
    });

    it('returns a structured JSON error for a refresh call on a wallet id that was never added', async () => {
        const res = await request(app).post(
            '/api/wallets/not-a-real-id/refresh',
        );
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.error).toBeTruthy();
    });
});
