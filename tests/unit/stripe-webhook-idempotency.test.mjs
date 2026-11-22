import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    it,
    expect,
    vi,
} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-stripe-idempotency-test-'),
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

let checkAndRecord;
let validateEventId;
let getStats;
let clearStore;

beforeAll(async () => {
    ({ checkAndRecord, validateEventId, getStats, clearStore } =
        await import('../../app/lib/stripe-webhook-idempotency.js'));
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
    clearStore();
    vi.restoreAllMocks();
});

describe('stripe-webhook-idempotency', () => {
    describe('validateEventId', () => {
        it('accepts valid Stripe event IDs', () => {
            expect(validateEventId('evt_123')).toBe(true);
            expect(validateEventId('evt_abc123XYZ')).toBe(true);
            expect(validateEventId('evt_a')).toBe(true);
        });

        it('rejects invalid event IDs', () => {
            expect(validateEventId('')).toBe(false);
            expect(validateEventId('evt_')).toBe(false);
            expect(validateEventId('evt_-123')).toBe(false);
            expect(validateEventId('evt_123!')).toBe(false);
            expect(validateEventId('test_123')).toBe(false);
            expect(validateEventId('evt 123')).toBe(false);
            expect(validateEventId(null)).toBe(false);
            expect(validateEventId(undefined)).toBe(false);
            expect(validateEventId(123)).toBe(false);
        });
    });

    describe('checkAndRecord', () => {
        const now = 1700000000000;

        it('returns processed=true for first delivery', async () => {
            const result = await checkAndRecord(
                'evt_test1',
                'payment_intent.succeeded',
                now,
            );
            expect(result.processed).toBe(true);
            expect(result.duplicate).toBe(false);
        });

        it('returns duplicate=true for second delivery of same ID', async () => {
            await checkAndRecord('evt_test2', 'payment_intent.succeeded', now);
            const result = await checkAndRecord(
                'evt_test2',
                'payment_intent.succeeded',
                now,
            );
            expect(result.processed).toBe(false);
            expect(result.duplicate).toBe(true);
        });

        it('does not reprocess on duplicate', async () => {
            await checkAndRecord('evt_test3', 'payment_intent.succeeded', now);
            const stats1 = getStats();
            await checkAndRecord('evt_test3', 'payment_intent.failed', now);
            const stats2 = getStats();
            expect(stats2.count).toBe(stats1.count);
        });

        it('throws on invalid event ID', async () => {
            await expect(
                checkAndRecord('invalid_id', 'payment_intent.succeeded', now),
            ).rejects.toThrow('Invalid event ID');
            await expect(
                checkAndRecord('evt_', 'payment_intent.succeeded', now),
            ).rejects.toThrow('Invalid event ID');
            await expect(
                checkAndRecord('', 'payment_intent.succeeded', now),
            ).rejects.toThrow('Invalid event ID');
        });

        it('prunes entries older than 30 days on write', async () => {
            const oldTime = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago
            await checkAndRecord('evt_old', 'test', oldTime);
            await checkAndRecord('evt_new', 'test', now);
            const stats = getStats();
            expect(stats.count).toBe(1);
            expect(stats.newest).toBe(now);
        });

        it('keeps entries within 30 days', async () => {
            const recentTime = now - 15 * 24 * 60 * 60 * 1000; // 15 days ago
            await checkAndRecord('evt_recent', 'test', recentTime);
            await checkAndRecord('evt_new', 'test', now);
            const stats = getStats();
            expect(stats.count).toBe(2);
        });

        it('enforces capacity limit (MAX_ENTRIES) on a full ledger', async () => {
            const { MAX_ENTRIES } =
                await import('../../app/lib/stripe-webhook-idempotency.js');
            const file = path.join(
                TEST_DATA_DIR,
                'stripe-webhook-idempotency.json',
            );
            const entries = Array.from({ length: MAX_ENTRIES }, (_, i) => ({
                id: `evt_seed_${i}`,
                type: 'seed',
                receivedAt: now - MAX_ENTRIES + i,
            }));
            fs.writeFileSync(file, JSON.stringify({ entries }));
            expect(
                (await checkAndRecord('evt_newest', 'test', now)).processed,
            ).toBe(true);
            const stored = JSON.parse(fs.readFileSync(file, 'utf8')).entries;
            expect(stored).toHaveLength(MAX_ENTRIES);
            expect(stored.some((e) => e.id === 'evt_seed_0')).toBe(false);
            expect(stored.some((e) => e.id === 'evt_newest')).toBe(true);
        });

        it('does not treat an expired record as a duplicate', async () => {
            const { TTL_MS } =
                await import('../../app/lib/stripe-webhook-idempotency.js');
            await checkAndRecord('evt_old', 'test', now);
            const later = now + TTL_MS + 1000;
            expect(
                (await checkAndRecord('evt_old', 'test', later)).processed,
            ).toBe(true);
            // ...while an unexpired record still is one
            expect(
                (await checkAndRecord('evt_old', 'test', later + 1)).duplicate,
            ).toBe(true);
        });

        it('survives module reload (durable store)', async () => {
            await checkAndRecord('evt_durable', 'test', now);
            // Clear module cache to simulate fresh load
            vi.resetModules();
            const { checkAndRecord: checkAndRecord2, getStats: getStats2 } =
                await import('../../app/lib/stripe-webhook-idempotency.js');
            const stats = getStats2();
            expect(stats.count).toBe(1);
            // Second delivery after reload should be duplicate
            const result = await checkAndRecord2('evt_durable', 'test', now);
            expect(result.duplicate).toBe(true);
        });

        it('concurrent duplicate requests result in one processing', async () => {
            // Fire multiple concurrent requests for the same event ID
            const promises = Array(5)
                .fill(null)
                .map(() => checkAndRecord('evt_concurrent', 'test', now));
            const results = await Promise.all(promises);
            const processed = results.filter((r) => r.processed).length;
            const duplicates = results.filter((r) => r.duplicate).length;
            expect(processed).toBe(1);
            expect(duplicates).toBe(4);
        });

        it('different event IDs are processed independently', async () => {
            await checkAndRecord('evt_a', 'type_a', now);
            await checkAndRecord('evt_b', 'type_b', now);
            await checkAndRecord('evt_c', 'type_c', now);
            const stats = getStats();
            expect(stats.count).toBe(3);
        });

        it('fails closed when the store file is corrupt (no silent replay)', async () => {
            await checkAndRecord('evt_before_corruption', 'test', now);
            const file = path.join(
                TEST_DATA_DIR,
                'stripe-webhook-idempotency.json',
            );
            fs.writeFileSync(file, '{not json');
            await expect(
                checkAndRecord('evt_before_corruption', 'test', now),
            ).rejects.toMatchObject({ code: 'STORE_CORRUPT' });
            fs.writeFileSync(file, JSON.stringify({ entries: 'nope' }));
            await expect(
                checkAndRecord('evt_other', 'test', now),
            ).rejects.toMatchObject({ code: 'STORE_CORRUPT' });
            // The chain recovers once the file is repaired
            fs.unlinkSync(file);
            expect(
                (await checkAndRecord('evt_after_repair', 'test', now))
                    .processed,
            ).toBe(true);
        });

        it('rejects an overlong event ID before touching the store', async () => {
            expect(validateEventId(`evt_${'a'.repeat(255)}`)).toBe(true);
            expect(validateEventId(`evt_${'a'.repeat(256)}`)).toBe(false);
        });
    });
});
