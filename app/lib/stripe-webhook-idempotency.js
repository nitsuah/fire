/* global module, require, process, console */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('./node-crypto');
const { DATA_DIR } = require('./db');

const IDEMPOTENCY_FILE = path.join(DATA_DIR, 'stripe-webhook-idempotency.json');
const MAX_ENTRIES = 10000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Stripe event IDs are short; the upper bound only stops abuse of the store.
const EVENT_ID_REGEX = /^evt_[A-Za-z0-9_]{1,255}$/;

// One write chain per process: the store assumes a single server process owns
// DATA_DIR (as the self-hosted deploy runs). Several processes sharing the file
// would need a cross-process lock.
let _writeChain = Promise.resolve();

function readStore() {
    if (!fs.existsSync(IDEMPOTENCY_FILE)) {
        return { entries: [] };
    }
    // Fail closed: an unreadable store must not look empty, or every past event
    // would be accepted again. The webhook answers 500, so Stripe retries until
    // the file is repaired or removed.
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(IDEMPOTENCY_FILE, 'utf8'));
    } catch (err) {
        console.error(
            `[Stripe Idempotency] Store ${IDEMPOTENCY_FILE} is unreadable:`,
            err.message,
        );
        const failure = new Error('Idempotency store unreadable');
        failure.code = 'STORE_CORRUPT';
        throw failure;
    }
    if (!parsed || !Array.isArray(parsed.entries)) {
        const failure = new Error('Idempotency store has an invalid shape');
        failure.code = 'STORE_CORRUPT';
        throw failure;
    }
    return parsed;
}

function writeStore(store) {
    const tmp = `${IDEMPOTENCY_FILE}.${process.pid}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
        // Durable replace: flush the new file, rename it over the old one,
        // then flush the directory so the rename survives a crash.
        const fd = fs.openSync(tmp, 'w', 0o600);
        try {
            fs.writeSync(fd, JSON.stringify(store));
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, IDEMPOTENCY_FILE);
        syncDir(path.dirname(IDEMPOTENCY_FILE));
        return true;
    } catch (err) {
        try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch (cleanupErr) {
            console.error(
                '[Stripe Idempotency] Failed to clean up temp file:',
                cleanupErr.message,
            );
        }
        throw err;
    }
}

function syncDir(dir) {
    let fd;
    try {
        fd = fs.openSync(dir, 'r');
    } catch {
        return; // platforms that cannot open a directory (Windows) skip this
    }
    try {
        fs.fsyncSync(fd);
    } catch (err) {
        // Some filesystems reject fsync on a directory; the data file itself
        // is already flushed, so only log it.
        if (
            err.code !== 'EINVAL' &&
            err.code !== 'EPERM' &&
            err.code !== 'EISDIR'
        )
            throw err;
    } finally {
        fs.closeSync(fd);
    }
}

function pruneOldEntries(entries, now = Date.now()) {
    const cutoff = now - TTL_MS;
    return entries.filter((e) => e.receivedAt > cutoff);
}

function enforceCapacity(entries) {
    if (entries.length > MAX_ENTRIES) {
        return entries.slice(-MAX_ENTRIES);
    }
    return entries;
}

function validateEventId(eventId) {
    return typeof eventId === 'string' && EVENT_ID_REGEX.test(eventId);
}

/**
 * Check if an event ID has already been processed.
 * If not, record it and return { processed: true }.
 * If yes, return { processed: false, duplicate: true }.
 * Throws on invalid eventId.
 */
async function checkAndRecord(eventId, eventType, now = Date.now()) {
    if (!validateEventId(eventId)) {
        const err = new Error('Invalid event ID');
        err.code = 'INVALID_EVENT_ID';
        throw err;
    }

    const task = _writeChain.then(async () => {
        const store = readStore();
        // Expired records no longer count as duplicates (and are dropped).
        let entries = pruneOldEntries(store.entries, now);

        // Check for duplicate
        const existing = entries.find((e) => e.id === eventId);
        if (existing) {
            return { processed: false, duplicate: true };
        }

        // Record new event
        entries.push({ id: eventId, type: eventType, receivedAt: now });
        entries = pruneOldEntries(entries, now);
        entries = enforceCapacity(entries);

        writeStore({ entries });
        return { processed: true, duplicate: false };
    });

    _writeChain = task.catch(() => {}); // recover chain on failure
    return task;
}

/**
 * Get current store stats (for testing/debugging)
 */
function getStats() {
    const store = readStore();
    return {
        count: store.entries.length,
        oldest: store.entries[0]?.receivedAt ?? null,
        newest: store.entries[store.entries.length - 1]?.receivedAt ?? null,
    };
}

/**
 * Clear the store (for testing)
 */
function clearStore() {
    try {
        if (fs.existsSync(IDEMPOTENCY_FILE)) fs.unlinkSync(IDEMPOTENCY_FILE);
    } catch (err) {
        console.error(
            '[Stripe Idempotency] Failed to clear store:',
            err.message,
        );
    }
}

module.exports = {
    checkAndRecord,
    validateEventId,
    getStats,
    clearStore,
    EVENT_ID_REGEX,
    MAX_ENTRIES,
    TTL_MS,
};
