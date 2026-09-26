'use strict';

/* ==========================================================================
   local-backup.js — Daily rotated copies of db.json on local disk

   db.json is the only copy of everything unless Google Drive backup is set
   up, and one bad full-state save can overwrite it. The server copies it to
   data/backups/db-YYYY-MM-DD.json once per day (the first run of the day,
   i.e. the start-of-day state, which is what you'd want to roll back to)
   and keeps the newest KEEP_DAYS copies. It also removes stale atomic-write
   temp files (db.json.tmp*) left behind by crashed writes.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 14;
const BACKUP_RE = /^db-(\d{4}-\d{2}-\d{2})\.json$/;
const TMP_RE = /^db\.json\.tmp(\..+)?$/;
const TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function dayKey(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// Returns { created: path|null, pruned: [names], tmpRemoved: [names] }.
function runDailyBackup({
    dbFile,
    backupDir = path.join(path.dirname(dbFile), 'backups'),
    now = new Date(),
    keep = KEEP_DAYS,
} = {}) {
    const result = { created: null, pruned: [], tmpRemoved: [] };
    if (!dbFile || !fs.existsSync(dbFile)) return result;

    fs.mkdirSync(backupDir, { recursive: true });
    const target = path.join(backupDir, `db-${dayKey(now)}.json`);
    if (!fs.existsSync(target)) {
        // Copy to a temp name then rename, so a crash never leaves a
        // truncated file that looks like a valid backup.
        const partial = `${target}.partial`;
        fs.copyFileSync(dbFile, partial);
        fs.renameSync(partial, target);
        result.created = target;
    }

    const backups = fs
        .readdirSync(backupDir)
        .filter((f) => BACKUP_RE.test(f))
        .sort(); // YYYY-MM-DD sorts chronologically
    for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
        fs.unlinkSync(path.join(backupDir, name));
        result.pruned.push(name);
    }

    // Stale temp files from interrupted writes: in the data dir and its
    // tmp/ subfolder. Only ones over a day old, so an in-flight write's
    // temp file is never touched.
    const dataDir = path.dirname(dbFile);
    for (const dir of [dataDir, path.join(dataDir, 'tmp')]) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            if (!TMP_RE.test(name)) continue;
            const full = path.join(dir, name);
            try {
                const age = now.getTime() - fs.statSync(full).mtimeMs;
                if (age > TMP_MAX_AGE_MS) {
                    fs.unlinkSync(full);
                    result.tmpRemoved.push(name);
                }
            } catch {
                // raced with another writer — skip
            }
        }
    }
    return result;
}

module.exports = { runDailyBackup, KEEP_DAYS };
