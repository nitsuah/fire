/* global require, module, console */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');
const { encrypt, decrypt } = require('./crypto-utils');

function getTokenFile(provider) {
    return path.join(DATA_DIR, `tokens-${provider}.json`);
}

function loadTokens(provider) {
    const file = getTokenFile(provider);
    if (!fs.existsSync(file)) return null;
    try {
        const { data: encrypted, lastUpdated } = JSON.parse(
            fs.readFileSync(file, 'utf8'),
        );
        const tokens = JSON.parse(decrypt(encrypted));
        tokens._tokenLastUpdated = lastUpdated;
        return tokens;
    } catch (err) {
        console.error(`[Sync] Unable to read ${provider} tokens:`, err.message);
        return null;
    }
}

function saveTokens(provider, tokens) {
    // eslint-disable-next-line no-unused-vars
    const { _tokenLastUpdated, ...payload } = tokens;
    const tokenData = {
        lastUpdated: new Date().toISOString(),
        data: encrypt(JSON.stringify(payload)),
    };
    const file = getTokenFile(provider);
    const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(tokenData), { mode: 0o600 });
        fs.renameSync(tmp, file);
    } catch (err) {
        try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch (cleanupErr) {
            console.error(
                '[Sync] Unable to clean up temporary token file:',
                cleanupErr.message,
            );
        }
        throw err;
    }
}

module.exports = { getTokenFile, loadTokens, saveTokens };
