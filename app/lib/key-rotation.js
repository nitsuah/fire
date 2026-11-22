/* global module, require, Buffer, process, console */
'use strict';

// Re-encrypts the files under the data directory that are sealed with
// SYNC_MASTER_KEY (provider token files and the local daily db backups) so a
// key rotation leaves nothing behind that only the old key can open.
// Everything is decrypted and re-encrypted in memory first; files are only
// written once all of them succeeded, and a failed write rolls back.

const fs = require('fs');
const path = require('path');
const crypto = require('./node-crypto');

const TOKEN_FILE_RE = /^tokens-[A-Za-z0-9_-]+\.json$/;
const BACKUP_FILE_RE = /^db-\d{4}-\d{2}-\d{2}\.json$/;

function sealEnvelope(text, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return JSON.stringify({
        enc: true,
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        data: enc,
    });
}

function openEnvelope(parsed, key) {
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(parsed.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
    let dec = decipher.update(parsed.data, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
}

// token-store.js format: iv:tag:ciphertext (hex).
function sealColon(text, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
}

function openColon(text, key) {
    const [iv, tag, data] = text.split(':');
    return openEnvelope({ iv, tag, data }, key);
}

const isColonCipher = (v) => typeof v === 'string' && v.split(':').length === 3;

// Returns the new file content, or null if the file needs no change.
function reencryptContent(name, raw, oldKey, newKey) {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.enc === true && parsed.iv) {
        if (!oldKey) throw new Error('encrypted but no current key');
        return sealEnvelope(openEnvelope(parsed, oldKey), newKey);
    }
    if (TOKEN_FILE_RE.test(name) && isColonCipher(parsed && parsed.data)) {
        if (!oldKey) throw new Error('encrypted but no current key');
        return JSON.stringify({
            ...parsed,
            data: sealColon(openColon(parsed.data, oldKey), newKey),
        });
    }
    // Plaintext copies (backups made before a key was set, a legacy Drive
    // token) get sealed with the new key rather than left readable.
    // Only an unsealed JSON object (a db snapshot or the legacy Drive token)
    // is treated as plaintext; anything else is not a format we know.
    const isPlainObject =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    if (
        isPlainObject &&
        (BACKUP_FILE_RE.test(name) || name === 'tokens-gdrive.json')
    ) {
        return sealEnvelope(raw, newKey);
    }
    throw new Error('unrecognised format');
}

function listSecretFiles(dataDir, dbDir = dataDir) {
    const out = [];
    const add = (dir, re) => {
        let names = [];
        try {
            names = fs.readdirSync(dir);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
        for (const name of names.filter((n) => re.test(n))) {
            out.push({ name, file: path.join(dir, name) });
        }
    };
    add(dataDir, TOKEN_FILE_RE);
    add(path.join(dbDir, 'backups'), BACKUP_FILE_RE);
    return out;
}

// Plans every rewrite in memory. Throws (naming the files, never contents)
// if any file cannot be read with the current key; nothing is written then.
function planReencrypt(dataDir, oldKey, newKey, dbDir = dataDir) {
    const plan = [];
    const failed = [];
    for (const { name, file } of listSecretFiles(dataDir, dbDir)) {
        try {
            const before = fs.readFileSync(file, 'utf8');
            plan.push({
                file,
                name,
                before,
                after: reencryptContent(name, before, oldKey, newKey),
            });
        } catch (err) {
            // Log the error type only: parse errors can quote file contents.
            console.error(
                `[Rotate] Cannot re-encrypt ${name}: ${(err && (err.code || err.name)) || 'Error'}`,
            );
            failed.push(name);
        }
    }
    if (failed.length) {
        throw new Error(
            `Could not re-encrypt: ${failed.join(', ')}. Nothing was changed; fix or remove these files and retry.`,
        );
    }
    return plan;
}

function writeAtomic(file, content) {
    const tmp = `${file}.rot.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.renameSync(tmp, file);
}

// Applies a plan synchronously. Returns { tokens, backups, rollback }.
function applyPlan(plan) {
    const done = [];
    const rollback = () => {
        for (const item of done.reverse()) {
            try {
                writeAtomic(item.file, item.before);
            } catch (err) {
                console.error(
                    `[Rotate] Could not restore ${item.name}:`,
                    err.message,
                );
            }
        }
    };
    try {
        for (const item of plan) {
            writeAtomic(item.file, item.after);
            done.push(item);
        }
    } catch (err) {
        rollback();
        throw err;
    }
    return {
        tokens: plan.filter((p) => TOKEN_FILE_RE.test(p.name)).length,
        backups: plan.filter((p) => BACKUP_FILE_RE.test(p.name)).length,
        rollback,
    };
}

module.exports = { planReencrypt, applyPlan, listSecretFiles };
