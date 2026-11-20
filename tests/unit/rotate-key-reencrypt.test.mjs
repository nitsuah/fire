import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OLD = 'aa'.repeat(32);
const NEW = 'bb'.repeat(32);
const ENV_KEYS = ['FIRE_DATA_DIR', 'FIRE_DB_FILE', 'SYNC_MASTER_KEY'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let dir;

function load() {
    vi.resetModules();
    for (const m of Object.keys(require.cache)) {
        if (m.includes(`${path.sep}app${path.sep}lib${path.sep}`))
            delete require.cache[m];
    }
    return {
        db: require('../../app/lib/db.js'),
        tokens: require('../../app/lib/token-store.js'),
        backup: require('../../app/lib/local-backup.js'),
        cryptoUtils: require('../../app/lib/crypto-utils.js'),
    };
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fire-rotate-'));
    process.env.FIRE_DATA_DIR = dir;
    process.env.FIRE_DB_FILE = path.join(dir, 'db.json');
    process.env.SYNC_MASTER_KEY = OLD;
});

afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
});

const nodeCrypto = require('node:crypto');

function sealEnvelope(text, keyHex) {
    const iv = nodeCrypto.randomBytes(12);
    const c = nodeCrypto.createCipheriv(
        'aes-256-gcm',
        Buffer.from(keyHex, 'hex'),
        iv,
    );
    const data = c.update(text, 'utf8', 'hex') + c.final('hex');
    return JSON.stringify({
        enc: true,
        iv: iv.toString('hex'),
        tag: c.getAuthTag().toString('hex'),
        data,
    });
}

function openEnvelope(raw, keyHex) {
    const e = JSON.parse(raw);
    const d = nodeCrypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(keyHex, 'hex'),
        Buffer.from(e.iv, 'hex'),
    );
    d.setAuthTag(Buffer.from(e.tag, 'hex'));
    return d.update(e.data, 'hex', 'utf8') + d.final('utf8');
}

function seed(mods) {
    mods.db.initDatabase();
    mods.db.writeState({ ...mods.db.defaultState(), taxRate: 31 });
    mods.tokens.saveTokens('etsy', { access_token: 'etsy-secret' });
    mods.tokens.saveTokens('ebay', { access_token: 'ebay-secret' });
    fs.writeFileSync(
        path.join(dir, 'tokens-gdrive.json'),
        sealEnvelope(JSON.stringify({ refresh_token: 'drive-secret' }), OLD),
    );
    mods.backup.runDailyBackup({ dbFile: process.env.FIRE_DB_FILE });
}

describe('rotateMasterKey', () => {
    it('re-encrypts the db, token files and local backups under the new key', async () => {
        const mods = load();
        seed(mods);
        const backupFile = fs
            .readdirSync(path.join(dir, 'backups'))
            .map((n) => path.join(dir, 'backups', n))[0];

        const result = await mods.db.rotateMasterKey(NEW);
        expect(result).toEqual({ tokens: 3, backups: 1 });
        expect(process.env.SYNC_MASTER_KEY).toBe(NEW);

        // Everything opens with the new key...
        expect(mods.db.readState().taxRate).toBe(31);
        expect(mods.tokens.loadTokens('etsy').access_token).toBe('etsy-secret');
        expect(mods.tokens.loadTokens('ebay').access_token).toBe('ebay-secret');
        expect(
            JSON.parse(
                openEnvelope(
                    fs.readFileSync(path.join(dir, 'tokens-gdrive.json'), 'utf8'),
                    NEW,
                ),
            ).refresh_token,
        ).toBe('drive-secret');
        const plain = openEnvelope(fs.readFileSync(backupFile, 'utf8'), NEW);
        expect(JSON.parse(plain).taxRate).toBe(31);

        // ...and nothing opens with the old one.
        process.env.SYNC_MASTER_KEY = OLD;
        expect(() => mods.cryptoUtils.decrypt(
            JSON.parse(fs.readFileSync(path.join(dir, 'tokens-etsy.json'), 'utf8')).data,
        )).toThrow();
    });

    it('changes nothing when a token file cannot be read with the current key', async () => {
        const mods = load();
        seed(mods);
        fs.writeFileSync(path.join(dir, 'tokens-stripe.json'), '{"data":"x:y:z"}');
        const before = Object.fromEntries(
            fs
                .readdirSync(dir)
                .filter((n) => n.endsWith('.json'))
                .map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]),
        );
        await expect(mods.db.rotateMasterKey(NEW)).rejects.toThrow(
            /tokens-stripe\.json/,
        );
        expect(process.env.SYNC_MASTER_KEY).toBe(OLD);
        for (const [n, content] of Object.entries(before)) {
            expect(fs.readFileSync(path.join(dir, n), 'utf8')).toBe(content);
        }
        expect(mods.db.readState().taxRate).toBe(31);
        expect(mods.tokens.loadTokens('etsy').access_token).toBe('etsy-secret');
    });

    it('rejects a malformed key', async () => {
        const mods = load();
        await expect(mods.db.rotateMasterKey('short')).rejects.toThrow();
    });
});
