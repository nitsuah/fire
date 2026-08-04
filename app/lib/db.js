'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR =
    process.env.FIRE_DATA_DIR || path.join(__dirname, '../../data');
const DB_FILE = process.env.FIRE_DB_FILE || path.join(DATA_DIR, 'db.json');

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
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
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
        fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
        return true;
    } catch (e) {
        console.error('Error writing to database', e);
        return false;
    }
}

module.exports = { DATA_DIR, DB_FILE, initDatabase, readState, writeState };
