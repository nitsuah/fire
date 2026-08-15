'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR =
    process.env.FIRE_DATA_DIR || path.join(__dirname, '../../data');
const DB_FILE = process.env.FIRE_DB_FILE || path.join(DATA_DIR, 'db.json');

let MASTER_KEY = null;
if (process.env.SYNC_MASTER_KEY) {
    const raw = process.env.SYNC_MASTER_KEY;
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
        throw new Error(
            'SYNC_MASTER_KEY must be exactly 64 hexadecimal characters (32 bytes). ' +
                "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        );
    }
    MASTER_KEY = Buffer.from(raw, 'hex');
}

function encryptState(json) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
    let enc = cipher.update(json, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({
        enc: true,
        iv: iv.toString('hex'),
        tag,
        data: enc,
    });
}

function decryptState(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed.enc) return raw;
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        MASTER_KEY,
        Buffer.from(parsed.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
    let dec = decipher.update(parsed.data, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
}

function defaultState() {
    return {
        importedPositions: [],
        customAccounts: [],
        cds: [],
        wallets: [],
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
        webhookTemplates: [],
    };
}

function initDatabase() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultState(), null, 2));
    }
}

function readState() {
    if (!fs.existsSync(DB_FILE)) {
        return defaultState();
    }
    let raw = fs.readFileSync(DB_FILE, 'utf8');
    if (MASTER_KEY) raw = decryptState(raw);
    return JSON.parse(raw);
}

function writeState(state) {
    try {
        const json = JSON.stringify(state, null, 2);
        const content = MASTER_KEY ? encryptState(json) : json;
        const tmp = DB_FILE + '.tmp';
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, DB_FILE);
        return true;
    } catch (e) {
        console.error('Error writing to database', e);
        return false;
    }
}

let _mutateQueue = Promise.resolve();

/**
 * Serialize read-modify-write operations so concurrent requests cannot
 * silently overwrite each other's changes.
 *
 * @param {function(Object): void} fn - Receives the current state object and
 *   should mutate it in place. May be synchronous or return a Promise.
 * @returns {Promise<boolean>} Resolves to true on success, false on failure.
 */
function mutateState(fn) {
    const next = _mutateQueue.then(async () => {
        const db = readState();
        await fn(db);
        return writeState(db);
    });
    // Recover the queue on failure so subsequent mutations still run.
    _mutateQueue = next.catch(() => {});
    return next;
}

async function rotateMasterKey(newKeyHex) {
    if (!newKeyHex || !/^[0-9a-fA-F]{64}$/.test(newKeyHex)) {
        throw new Error(
            'New key must be 64 hexadecimal characters (32 bytes).',
        );
    }
    const prevKey = MASTER_KEY;
    const prevEnv = process.env.SYNC_MASTER_KEY;
    const nextKey = Buffer.from(newKeyHex, 'hex');
    const ok = await mutateState(() => {
        MASTER_KEY = nextKey;
        process.env.SYNC_MASTER_KEY = newKeyHex;
    });
    if (!ok) {
        MASTER_KEY = prevKey;
        if (prevEnv === undefined) {
            delete process.env.SYNC_MASTER_KEY;
        } else {
            process.env.SYNC_MASTER_KEY = prevEnv;
        }
        throw new Error('Failed to re-encrypt database with new key.');
    }
}

module.exports = {
    DATA_DIR,
    DB_FILE,
    defaultState,
    initDatabase,
    readState,
    writeState,
    mutateState,
    rotateMasterKey,
};
