import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDailyBackup } from '../../app/lib/local-backup.js';

let dir;
let dbFile;
const backupDir = () => path.join(dir, 'backups');
const list = () => fs.readdirSync(backupDir()).sort();

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fire-backup-'));
    dbFile = path.join(dir, 'db.json');
    fs.writeFileSync(dbFile, JSON.stringify({ v: 1 }));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('runDailyBackup', () => {
    it("copies db.json once per day and keeps the day's first copy", () => {
        const r1 = runDailyBackup({ dbFile, now: new Date(2026, 8, 26, 1) });
        expect(path.basename(r1.created)).toBe('db-2026-09-26.json');
        fs.writeFileSync(dbFile, JSON.stringify({ v: 2 }));
        const r2 = runDailyBackup({ dbFile, now: new Date(2026, 8, 26, 15) });
        expect(r2.created).toBeNull();
        const saved = JSON.parse(
            fs.readFileSync(path.join(backupDir(), 'db-2026-09-26.json')),
        );
        expect(saved.v).toBe(1);
    });

    it('keeps only the newest N daily copies', () => {
        for (let d = 1; d <= 5; d++) {
            runDailyBackup({ dbFile, now: new Date(2026, 8, d), keep: 3 });
        }
        expect(list()).toEqual([
            'db-2026-09-03.json',
            'db-2026-09-04.json',
            'db-2026-09-05.json',
        ]);
    });

    it('leaves unrelated files in the backup folder alone', () => {
        fs.mkdirSync(backupDir());
        fs.writeFileSync(path.join(backupDir(), 'notes.txt'), 'keep me');
        runDailyBackup({ dbFile, now: new Date(2026, 8, 26), keep: 1 });
        expect(list()).toContain('notes.txt');
    });

    it('removes stale db.json.tmp files but not fresh ones or other files', () => {
        const tmpDir = path.join(dir, 'tmp');
        fs.mkdirSync(tmpDir);
        const stale = path.join(dir, 'db.json.tmp.4256.abc');
        const staleSub = path.join(tmpDir, 'db.json.tmp.4332.def');
        const fresh = path.join(dir, 'db.json.tmp');
        const other = path.join(dir, 'tokens.json');
        for (const f of [stale, staleSub, fresh, other])
            fs.writeFileSync(f, 'x');
        const old = new Date(2026, 7, 14);
        fs.utimesSync(stale, old, old);
        fs.utimesSync(staleSub, old, old);

        const r = runDailyBackup({ dbFile, now: new Date() });
        expect(r.tmpRemoved.sort()).toEqual([
            'db.json.tmp.4256.abc',
            'db.json.tmp.4332.def',
        ]);
        expect(fs.existsSync(fresh)).toBe(true);
        expect(fs.existsSync(other)).toBe(true);
    });

    it('does nothing when there is no database yet', () => {
        const r = runDailyBackup({ dbFile: path.join(dir, 'missing.json') });
        expect(r.created).toBeNull();
    });
});
