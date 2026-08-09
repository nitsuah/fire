'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR =
    process.env.FIRE_DATA_DIR || path.join(__dirname, '../../data');
const DB_FILE = process.env.FIRE_DB_FILE || path.join(DATA_DIR, 'db.json');

const MASTER_KEY = process.env.SYNC_MASTER_KEY
    ? Buffer.from(process.env.SYNC_MASTER_KEY, 'hex')
    : null;

function encryptState(json) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
    let enc = cipher.update(json, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({ enc: true, iv: iv.toString('hex'), tag, data: enc });
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
    try {
        let raw = fs.readFileSync(DB_FILE, 'utf8');
        if (MASTER_KEY) raw = decryptState(raw);
        return JSON.parse(raw);
    } catch (e) {
        console.error(
            'Error reading database, returning default fallback state',
            e,
        );
        return defaultState();
    }
}

function writeState(state) {
    try {
        const json = JSON.stringify(state, null, 2);
        fs.writeFileSync(DB_FILE, MASTER_KEY ? encryptState(json) : json);
        return true;
    } catch (e) {
        console.error('Error writing to database', e);
        return false;
    }
}

module.exports = {
    DATA_DIR,
    DB_FILE,
    defaultState,
    initDatabase,
    readState,
    writeState,
};
