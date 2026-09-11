/* ==========================================================================
   managers/gdrive-backup.js — Google Drive encrypted backup panel (Settings)
   Backed by /api/backup/drive/*. Loaded on demand from window.loadSettingsTab
   (see app.js) rather than on DOMContentLoaded, matching the rest of the
   Settings tab's lazy-load-on-open pattern.

   Backup file ids come back from Google's API — external, third-party data —
   so restore buttons carry only the escaped file id via data-file-id and are
   wired through a single delegated click listener rather than an inline
   onclick="...('${id}')" string.
   ========================================================================== */

async function loadGDriveBackupPanel() {
    const statusEl = document.getElementById('gdrive-status');
    const connectBtn = document.getElementById('btn-gdrive-connect');
    const backupBtn = document.getElementById('btn-gdrive-backup-now');
    if (!statusEl) return;

    try {
        const res = await fetch('/api/backup/drive/status');
        const data = await res.json();
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

        if (data.authorized) {
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
    window.location.assign('/api/backup/drive/authorize');
}

async function runGDriveBackupNow() {
    const btn = document.getElementById('btn-gdrive-backup-now');
    const statusEl = document.getElementById('gdrive-status');
    if (!btn) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Backing up…';
    try {
        const res = await fetch('/api/backup/drive', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Backup failed.');
        if (statusEl) {
            statusEl.textContent = `Backup saved: ${data.fileName}`;
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
    listEl.innerHTML =
        '<p class="text-muted" style="font-size:12px;">Loading backups…</p>';
    try {
        const res = await fetch('/api/backup/drive/list');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to list backups.');
        const files = Array.isArray(data.files) ? data.files : [];
        if (files.length === 0) {
            listEl.innerHTML =
                '<p class="text-muted" style="font-size:12px;">No backups yet.</p>';
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
                    <span class="chain-name">${escHtml(f.name)}<span class="text-muted" style="display:block;font-size:10px;">${escHtml(created)} ${escHtml(sizeKb)}</span></span>
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
        const res = await fetch('/api/backup/drive/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Restore failed.');
        alert('Backup restored. Reloading…');
        window.location.reload();
    } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = original;
    }
});
