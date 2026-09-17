'use strict';

/**
 * End-to-end coverage for eBay's Marketplace Account Deletion / Closure
 * compliance webhook (required by eBay for any app holding a production
 * sell.* OAuth scope — https://developer.ebay.com/marketplace-account-deletion).
 * Mirrors tests/e2e/webhook-sync.test.js's approach: drives the real Express
 * app (app/server.js) via supertest against an isolated temp DB/data dir, no
 * mocking of our own routes.
 *
 * Exercises the real user-facing flow end-to-end:
 *   1. An eBay connection already exists (encrypted tokens-ebay.json on
 *      disk, matching what /ebay/callback would have written) with some
 *      eBay-sourced sideGigLedger history already synced in.
 *   2. eBay's one-time verification handshake (GET with challenge_code) is
 *      answered correctly.
 *   3. eBay's actual deletion notification (POST) is accepted, purges the
 *      stored OAuth tokens and disables further sync — but leaves the
 *      user's own already-synced financial ledger history untouched, since
 *      that's the user's own data, not eBay's to delete.
 *   4. A malformed/unverifiable notification is rejected without crashing
 *      the process or affecting stored state.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-ebay-deletion-e2e-'),
);
const TEST_DB = path.join(TEST_DATA_DIR, 'db.json');
const TOKEN_FILE = path.join(TEST_DATA_DIR, 'tokens-ebay.json');
process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB;
process.env.FIRE_AUTH_DISABLED = 'true';
process.env.SYNC_MASTER_KEY = '22'.repeat(32);
process.env.EBAY_VERIFICATION_TOKEN = 'e2e-test-verification-token-1234567890';
process.env.EBAY_NOTIFICATION_ENDPOINT_URL =
    'https://fire.example.test/api/sync/ebay/marketplace-account-deletion';

const request = require('supertest');
const app = require('../../app/server');
const { encrypt } = require('../../app/lib/crypto-utils');

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
    sideGigLedger: [
        {
            id: 'ebay-1001',
            platform: 'eBay',
            date: '2026-06-01',
            description: 'Used camera lens',
            gross: 120,
            fees: 14.4,
            net: 105.6,
            orderId: '1001',
        },
    ],
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
    ebaySyncEnabled: true,
};

function resetState(overrides) {
    const state = { ...BLANK_STATE, ...overrides };
    fs.writeFileSync(TEST_DB, JSON.stringify(state, null, 2));
    return state;
}

function writeExistingEbayConnection() {
    const payload = {
        access_token: 'existing-access-token',
        refresh_token: 'existing-refresh-token',
        environment: 'sandbox',
        lastSyncedAt: '2026-09-01T00:00:00.000Z',
    };
    fs.writeFileSync(
        TOKEN_FILE,
        JSON.stringify({
            lastUpdated: new Date().toISOString(),
            data: encrypt(JSON.stringify(payload)),
        }),
    );
}

afterAll(() => {
    try {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
});

describe('eBay Marketplace Account Deletion — end-to-end', () => {
    beforeEach(() => {
        resetState();
        writeExistingEbayConnection();
    });

    it('starts from a real connected state before the deletion flow runs', async () => {
        const status = await request(app).get('/api/sync/ebay/status');
        expect(status.status).toBe(200);
        expect(status.body.connected).toBe(true);
        expect(status.body.syncEnabled).toBe(true);
    });

    it('answers the eBay verification handshake with the correct challenge response', async () => {
        const challengeCode = 'real-looking-challenge-code-abcdef';
        const res = await request(app)
            .get('/api/sync/ebay/marketplace-account-deletion')
            .query({ challenge_code: challengeCode });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/json/);

        const expected = crypto
            .createHash('sha256')
            .update(
                challengeCode +
                    process.env.EBAY_VERIFICATION_TOKEN +
                    process.env.EBAY_NOTIFICATION_ENDPOINT_URL,
            )
            .digest('hex');
        expect(res.body.challengeResponse).toBe(expected);
    });

    it('processes a real deletion notification end-to-end: purges tokens, disables sync, keeps ledger history', async () => {
        const notifyRes = await request(app)
            .post('/api/sync/ebay/marketplace-account-deletion')
            .send({
                metadata: {
                    topic: 'MARKETPLACE_ACCOUNT_DELETION',
                    schemaVersion: '1.0',
                },
                notification: {
                    notificationId: crypto.randomUUID(),
                    eventDate: new Date().toISOString(),
                    publishDate: new Date().toISOString(),
                    publishAttemptCount: 1,
                    data: {
                        username: 'e2e-test-seller',
                        userId: 'e2e-user-id',
                        eiasToken: 'eias-token-placeholder',
                    },
                },
            });

        expect(notifyRes.status).toBe(200);
        expect(notifyRes.body.status).toBe('acknowledged');

        // Tokens must actually be gone from disk, not just reported as such.
        expect(fs.existsSync(TOKEN_FILE)).toBe(false);

        const status = await request(app).get('/api/sync/ebay/status');
        expect(status.body.connected).toBe(false);
        expect(status.body.syncEnabled).toBe(false);

        // The user's own already-recorded financial history is theirs to
        // keep — eBay deleting the seller's account doesn't erase the
        // buyer-side app's own ledger of past transactions.
        const state = await request(app).get('/api/state');
        expect(state.body.sideGigLedger.some((e) => e.id === 'ebay-1001')).toBe(
            true,
        );
    });

    it('rejects a malformed/unverifiable notification without touching stored state', async () => {
        const res = await request(app)
            .post('/api/sync/ebay/marketplace-account-deletion')
            .send({ some: 'unrelated payload' });

        expect(res.status).toBe(400);
        // Nothing should have been purged or disabled by a rejected request.
        expect(fs.existsSync(TOKEN_FILE)).toBe(true);
        const status = await request(app).get('/api/sync/ebay/status');
        expect(status.body.connected).toBe(true);
        expect(status.body.syncEnabled).toBe(true);
    });
});
