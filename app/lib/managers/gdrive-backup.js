/* ==========================================================================
   managers/gdrive-backup.js — Google Drive encrypted backup panel (Settings)
   Backed by /api/backup/drive/*. Loaded on demand from window.loadSettingsTab
   (see app.js) rather than on DOMContentLoaded, matching the rest of the
   Settings tab's lazy-load-on-open pattern.

   Backup file ids come back from Google's API — external, third-party data —
   so restore buttons carry only the escaped file id via data-file-id and are
   wired through a single delegated click listener rather than an inline
   onclick="...('${id}')" string.

   Self-hosted: the server keeps the Drive tokens and backs up db.json.
   Browser-only (Netlify, netlify/functions/gdrive-backup.mjs): the browser
   holds a SYNC_MASTER_KEY-sealed token blob under its own localStorage key
   (never in fire_tracker_state or its backups) and sends it with each call,
   backs up its own `state`, and applies the decrypted state on restore.
   ========================================================================== */

const GDRIVE_TOKEN_KEY = 'fire_tracker_gdrive_token';
const GDRIVE_CONNECT_PENDING_KEY = 'fire_tracker_gdrive_connect_pending';
// Only these mean the grant is gone and the blob should be dropped.
const GDRIVE_DEAD_GRANT_CODES = new Set([
    'gdrive_revoked',
    'gdrive_token_invalid',
]);

// True once /api/backup/drive/status has reported `hosted: true`, or once
// state.js's /api/state probe has settled the deploy mode (#292). Callers
// await this so a slow /api/state cannot make a self-hosted deploy look
// hosted for the first status check.
let gdriveServerHosted = false;

async function gdriveHosted() {
    if (gdriveServerHosted) return true;
    if (typeof isBrowserOnlyModeAsync === 'function')
        return await isBrowserOnlyModeAsync();
    return typeof isBrowserOnlyMode === 'function' && isBrowserOnlyMode();
}

function gdriveRead(key, storage = localStorage) {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

function gdriveWrite(key, value, storage = localStorage) {
    try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
    } catch {
        /* storage unavailable — nothing to persist */
    }
}

function gdriveToast(message, type) {
    if (typeof showSideGigToast === 'function') showSideGigToast(message, type);
}

// Calls a Drive endpoint. On the hosted deploy, attaches the sealed blob
// (JSON body for POST, header for GET), keeps a refreshed blob the function
// hands back, and drops the blob when the grant is dead.
async function gdriveFetch(path, { method = 'GET', body } = {}) {
    const hosted = await gdriveHosted();
    const blob = hosted ? gdriveRead(GDRIVE_TOKEN_KEY) : null;
    if (hosted && !blob) throw new Error('Google Drive is not connected.');
    const headers = {};
    let payload;
    if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(hosted ? { ...body, tokens: blob } : body);
    } else if (hosted) {
        headers['X-GDrive-Tokens'] = blob;
    }
    const res = await fetch(path, { method, headers, body: payload });
    const data = await res.json().catch(() => ({}));
    if (hosted && data.tokens) gdriveWrite(GDRIVE_TOKEN_KEY, data.tokens);
    if (
        hosted &&
        res.status === 401 &&
        GDRIVE_DEAD_GRANT_CODES.has(data.code)
    ) {
        gdriveWrite(GDRIVE_TOKEN_KEY, null);
        loadGDriveBackupPanel();
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

async function loadGDriveBackupPanel() {
    const statusEl = document.getElementById('gdrive-status');
    const connectBtn = document.getElementById('btn-gdrive-connect');
    const backupBtn = document.getElementById('btn-gdrive-backup-now');
    if (!statusEl) return;

    try {
        const res = await fetch('/api/backup/drive/status');
        const data = await res.json();
        gdriveServerHosted = data.hosted === true;
        if (!res.ok) {
            throw new Error(
                data.error || 'Unable to check Google Drive backup status.',
            );
        }

        if (!data.clientConfigured) {
            statusEl.textContent =
                'Google Drive backup is not configured on this server (GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET missing).';
            statusEl.style.color = 'var(--text-muted)';
            if (connectBtn) connectBtn.disabled = true;
            if (backupBtn) backupBtn.disabled = true;
            return;
        }

        if (!data.masterKeySet) {
            statusEl.textContent =
                'SYNC_MASTER_KEY must be set on the server before Drive tokens can be stored securely.';
            statusEl.style.color = 'var(--color-warning)';
            if (connectBtn) connectBtn.disabled = true;
            if (backupBtn) backupBtn.disabled = true;
            return;
        }
        if (connectBtn) connectBtn.disabled = false;

        const authorized = (await gdriveHosted())
            ? Boolean(gdriveRead(GDRIVE_TOKEN_KEY))
            : data.authorized;
        if (authorized) {
            statusEl.textContent = 'Connected to Google Drive.';
            statusEl.style.color = 'var(--color-success)';
            if (connectBtn) connectBtn.style.display = 'none';
            if (backupBtn) backupBtn.disabled = false;
            loadGDriveBackupList();
        } else {
            statusEl.textContent = 'Not connected.';
            statusEl.style.color = 'var(--text-muted)';
            if (connectBtn) connectBtn.style.display = '';
            if (backupBtn) backupBtn.disabled = true;
        }
    } catch (err) {
        statusEl.textContent = 'Unable to check Google Drive backup status.';
        statusEl.style.color = 'var(--color-danger)';
    }
}

function connectGoogleDrive() {
    // The OAuth state cookie protects Google → callback; this marker protects
    // callback → SPA, so a crafted /#gdrive-connected=<blob> link can't
    // silently connect someone else's Drive in this browser.
    gdriveWrite(GDRIVE_CONNECT_PENDING_KEY, '1', sessionStorage);
    window.location.assign('/api/backup/drive/authorize');
}

// The hosted callback returns to /#gdrive-connected=<blob> or
// /#gdrive-error=<code>. Runs on page load (see app.js).
function initGDriveBackup() {
    const match = (window.location.hash || '').match(
        /^#gdrive-(connected|error)=(.*)$/,
    );
    if (!match) return;
    history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
    );
    const pending =
        gdriveRead(GDRIVE_CONNECT_PENDING_KEY, sessionStorage) === '1';
    gdriveWrite(GDRIVE_CONNECT_PENDING_KEY, null, sessionStorage);
    if (!pending) {
        console.warn('[Drive] Ignored an OAuth result this tab did not start.');
        return;
    }
    if (match[1] === 'error') {
        gdriveToast(
            `Google Drive connection failed (${decodeURIComponent(match[2])}). Please try again.`,
            'error',
        );
        return;
    }
    gdriveWrite(GDRIVE_TOKEN_KEY, decodeURIComponent(match[2]));
    gdriveToast(
        'Google Drive connected. Use Settings → Google Drive Backup to back up.',
    );
}

async function runGDriveBackupNow() {
    const btn = document.getElementById('btn-gdrive-backup-now');
    const statusEl = document.getElementById('gdrive-status');
    if (!btn) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Backing up…';
    try {
        // Self-hosted backs up db.json; hosted sends this browser's state.
        const data = await gdriveFetch('/api/backup/drive', {
            method: 'POST',
            body: (await gdriveHosted()) ? { state } : undefined,
        });
        if (statusEl) {
            statusEl.textContent = `Backup saved and verified: ${data.fileName}`;
            statusEl.style.color = 'var(--color-success)';
        }
        loadGDriveBackupList();
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `Backup failed: ${err.message}`;
            statusEl.style.color = 'var(--color-danger)';
        }
    } finally {
        btn.textContent = original;
        btn.disabled = false;
    }
}

async function loadGDriveBackupList() {
    const listEl = document.getElementById('gdrive-backup-list');
    if (!listEl) return;
    listEl.innerHTML = '<p class="text-muted csp-text-12">Loading backups…</p>';
    try {
        const data = await gdriveFetch('/api/backup/drive/list');
        const files = Array.isArray(data.files) ? data.files : [];
        if (files.length === 0) {
            listEl.innerHTML =
                '<p class="text-muted csp-text-12">No backups yet.</p>';
            return;
        }
        listEl.innerHTML = files
            .map((f) => {
                const created = f.createdTime
                    ? new Date(f.createdTime).toLocaleString()
                    : 'unknown date';
                const sizeKb = f.size
                    ? `${Math.round(Number(f.size) / 1024)} KB`
                    : '';
                return `
                <div class="chain-balance-row">
                    <span class="chain-name">${escHtml(f.name)}<span class="text-muted csp-block csp-text-10">${escHtml(created)} ${escHtml(sizeKb)}</span></span>
                    <span class="chain-val"><button type="button" class="action-btn" data-action="restore-backup" data-file-id="${escHtml(f.id)}">Restore</button></span>
                </div>`;
            })
            .join('');
    } catch (err) {
        listEl.innerHTML = `<p class="veh-est-error">${escHtml(err.message)}</p>`;
    }
}

document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="restore-backup"]');
    if (!btn) return;
    const fileId = btn.dataset.fileId;
    if (!fileId) return;
    if (
        !confirm(
            'This will REPLACE all current data with this backup. Continue?',
        )
    )
        return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Restoring…';
    try {
        const data = await gdriveFetch('/api/backup/drive/restore', {
            method: 'POST',
            body: { fileId },
        });
        if (await gdriveHosted()) {
            if (!data.state || typeof data.state !== 'object')
                throw new Error('Restore returned no data.');
            state = sanitizeState(data.state);
            await saveState();
        }
        alert('Backup restored. Reloading…');
        window.location.reload();
    } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = original;
    }
});
