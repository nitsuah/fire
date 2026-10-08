/* ==========================================================================
   etsy-sync.js — Etsy connection cards (Side Hustle Hub + Settings)
   Depends on globals: state, saveState, refreshAllUI, showSideGigToast,
   isBrowserOnlyMode (side-gig.js).

   Self-hosted: /api/sync/etsy/* keeps the tokens in the server's encrypted
   token store and merges receipts into the server ledger. Browser-only
   (Netlify): the browser holds a sealed token blob under its own
   localStorage key (never in fire_tracker_state or its backups), and
   status, the sync toggle and disconnect are handled here.
   ========================================================================== */

const ETSY_TOKEN_KEY = 'fire_tracker_etsy_token';
const ETSY_LAST_SYNC_KEY = 'fire_tracker_etsy_last_sync';
const ETSY_CONNECT_PENDING_KEY = 'fire_tracker_etsy_connect_pending';
// Set when a sync stopped at its page cap; the next sync starts here.
const ETSY_RESUME_KEY = 'fire_tracker_etsy_resume_from';
// Only these mean the grant is gone; other 401s (e.g. a rejected app key)
// keep the connection and any refreshed tokens.
const ETSY_DEAD_GRANT_CODES = new Set(['etsy_revoked', 'etsy_token_invalid']);
// Later syncs re-read a week before the last one; dedupe drops repeats.
const ETSY_RESYNC_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

function etsyRead(key, storage = localStorage) {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

function etsyWrite(key, value, storage = localStorage) {
    try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
    } catch {
        /* storage unavailable — nothing to persist */
    }
}

// Mirrors isApiSyncedEtsyEntry in app/lib/etsy-connector.js.
function isApiSyncedEtsyEntry(entry) {
    return (
        Boolean(entry?.etsyReceiptId) &&
        entry.id === `etsy-${entry.etsyReceiptId}`
    );
}

async function fetchEtsyStatus() {
    if (isBrowserOnlyMode()) {
        return {
            connected: Boolean(etsyRead(ETSY_TOKEN_KEY)),
            lastSync: etsyRead(ETSY_LAST_SYNC_KEY),
            syncEnabled: state.etsySyncEnabled !== false,
        };
    }
    const res = await fetch('/api/sync/etsy/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// Paints every Etsy card (Side Hustle Hub and Settings share the markup:
// .etsy-status, [data-etsy-action], .etsy-sync-toggle).
async function renderEtsyStatus(note) {
    const statusEls = document.querySelectorAll('.etsy-status');
    if (!statusEls.length) return;
    let data;
    try {
        data = await fetchEtsyStatus();
    } catch {
        statusEls.forEach((el) => {
            el.textContent = 'Status: Error checking Etsy connection';
            el.style.color = 'var(--color-danger)';
        });
        return;
    }
    const lastSync = data.lastSync
        ? new Date(data.lastSync).toLocaleString()
        : 'never';
    const text =
        note?.text ||
        (data.connected
            ? `Status: Connected · Last sync: ${lastSync}`
            : 'Status: Disconnected');
    const color =
        note?.color ||
        (data.connected ? 'var(--color-success)' : 'var(--text-muted)');
    statusEls.forEach((el) => {
        el.textContent = text;
        el.style.color = color;
    });
    document.querySelectorAll('[data-etsy-action]').forEach((btn) => {
        const action = btn.dataset.etsyAction;
        if (action === 'connect') btn.hidden = data.connected;
        if (action === 'disconnect') btn.hidden = !data.connected;
        if (action === 'sync') {
            btn.hidden = !data.connected;
            btn.disabled = data.syncEnabled === false;
        }
    });
    document.querySelectorAll('.etsy-sync-toggle').forEach((t) => {
        t.checked = data.syncEnabled !== false;
    });
}

function startEtsyConnect() {
    // The OAuth state cookie protects Etsy → callback; this marker protects
    // callback → SPA, so a crafted /#etsy-connected=<blob> link can't
    // silently connect someone else's shop in this browser.
    etsyWrite(ETSY_CONNECT_PENDING_KEY, '1', sessionStorage);
    window.location.assign('/api/sync/etsy/authorize');
}

// etsy callback returns to /#etsy-connected=<blob|stored> or
// /#etsy-error=<code>.
async function consumeEtsyOauthFragment() {
    const match = (window.location.hash || '').match(
        /^#etsy-(connected|error)=(.*)$/,
    );
    if (!match) return;
    history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
    );
    const pending = etsyRead(ETSY_CONNECT_PENDING_KEY, sessionStorage) === '1';
    etsyWrite(ETSY_CONNECT_PENDING_KEY, null, sessionStorage);
    if (!pending) {
        console.warn('[Etsy] Ignored an OAuth result this tab did not start.');
        return;
    }
    if (match[1] === 'error') {
        showSideGigToast(
            `Etsy connection failed (${decodeURIComponent(match[2])}). Please try again.`,
            'error',
        );
        return;
    }
    const value = decodeURIComponent(match[2]);
    if (isBrowserOnlyMode() && value !== 'stored') {
        etsyWrite(ETSY_TOKEN_KEY, value);
        etsyWrite(ETSY_LAST_SYNC_KEY, null);
        etsyWrite(ETSY_RESUME_KEY, null);
    }
    showSideGigToast('Etsy connected — syncing your sales…');
    await runEtsySyncNow({ silent: true, toastOnDone: true });
}

// The grant is dead (revoked in Etsy, or an unreadable blob): drop it and,
// for a revocation, the rows the receipts sync created. Manually logged
// Etsy sales are the user's own and stay.
async function handleEtsyConnectionLost(code, message) {
    etsyWrite(ETSY_TOKEN_KEY, null);
    etsyWrite(ETSY_LAST_SYNC_KEY, null);
    etsyWrite(ETSY_RESUME_KEY, null);
    let removed = 0;
    if (code === 'etsy_revoked') {
        if (isBrowserOnlyMode()) {
            const before = state.sideGigLedger.length;
            state.sideGigLedger = state.sideGigLedger.filter(
                (e) => !isApiSyncedEtsyEntry(e),
            );
            removed = before - state.sideGigLedger.length;
            await saveState();
        } else if (typeof resyncStateFromServer === 'function') {
            await resyncStateFromServer({ force: true });
        }
        if (typeof refreshAllUI === 'function') refreshAllUI();
    }
    showSideGigToast(
        `${message}${removed ? ` Removed ${removed} Etsy-synced sale${removed === 1 ? '' : 's'}.` : ''}`,
        'error',
    );
    renderEtsyStatus();
}

async function syncEtsyViaServer() {
    const res = await fetch('/api/sync/etsy/sync', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && ETSY_DEAD_GRANT_CODES.has(data.code)) {
        await handleEtsyConnectionLost(data.code, data.error);
        return null;
    }
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    if (data.added && typeof resyncStateFromServer === 'function')
        await resyncStateFromServer({ force: true });
    return data;
}

async function syncEtsyViaFunction() {
    if (state.etsySyncEnabled === false)
        throw new Error('Etsy sync is disabled. Enable it first.');
    const blob = etsyRead(ETSY_TOKEN_KEY);
    if (!blob) throw new Error('Etsy is not connected.');
    const last = Date.parse(etsyRead(ETSY_LAST_SYNC_KEY) || '');
    const since =
        etsyRead(ETSY_RESUME_KEY) ||
        (Number.isNaN(last)
            ? undefined
            : new Date(last - ETSY_RESYNC_LOOKBACK_MS).toISOString());
    const res = await fetch('/api/sync/etsy/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: blob, since }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.tokens) etsyWrite(ETSY_TOKEN_KEY, data.tokens);
    if (res.status === 401 && ETSY_DEAD_GRANT_CODES.has(data.code)) {
        await handleEtsyConnectionLost(data.code, data.error);
        return null;
    }
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    const ids = new Set(state.sideGigLedger.map((e) => e.id));
    let added = 0;
    for (const entry of data.entries || []) {
        if (ids.has(entry.id)) continue;
        state.sideGigLedger.push(entry);
        ids.add(entry.id);
        added++;
    }
    if (added) await saveState();
    etsyWrite(ETSY_LAST_SYNC_KEY, data.syncedAt);
    etsyWrite(ETSY_RESUME_KEY, data.truncated ? data.resumeFrom : null);
    return { ...data, added };
}

async function runEtsySyncNow({ silent = false, toastOnDone = false } = {}) {
    const buttons = document.querySelectorAll('[data-etsy-action="sync"]');
    buttons.forEach((b) => {
        b.disabled = true;
        b.dataset.label = b.dataset.label || b.textContent;
        b.textContent = 'Syncing…';
    });
    let note;
    try {
        const data = isBrowserOnlyMode()
            ? await syncEtsyViaFunction()
            : await syncEtsyViaServer();
        if (!data) return;
        const msg = data.truncated
            ? `Etsy sync: ${data.added} new sale${data.added === 1 ? '' : 's'} of ${data.fetched} fetched. More orders remain — click Sync Now again to continue.`
            : `Etsy sync complete — ${data.added} new sale${data.added === 1 ? '' : 's'} of ${data.fetched} fetched.`;
        note = {
            text: `Status: Connected · ${msg}`,
            color: 'var(--color-success)',
        };
        if (!silent || toastOnDone) showSideGigToast(msg);
        if (typeof refreshAllUI === 'function') refreshAllUI();
    } catch (err) {
        note = {
            text: `Sync failed: ${err.message}`,
            color: 'var(--color-danger)',
        };
        if (!silent || toastOnDone)
            showSideGigToast(`Etsy sync failed: ${err.message}`, 'error');
    } finally {
        buttons.forEach((b) => {
            b.textContent = b.dataset.label;
        });
        await renderEtsyStatus(note);
    }
}

async function disconnectEtsy() {
    if (
        !confirm(
            'Disconnect Etsy? Sales already synced stay in your ledger; new orders stop syncing.',
        )
    )
        return;
    if (!isBrowserOnlyMode()) {
        try {
            const res = await fetch('/api/sync/etsy/disconnect', {
                method: 'POST',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            showSideGigToast(
                `Could not disconnect Etsy: ${err.message}`,
                'error',
            );
            return;
        }
    }
    etsyWrite(ETSY_TOKEN_KEY, null);
    etsyWrite(ETSY_LAST_SYNC_KEY, null);
    etsyWrite(ETSY_RESUME_KEY, null);
    showSideGigToast('Etsy disconnected.');
    renderEtsyStatus();
}

async function toggleEtsySync(enabled) {
    if (isBrowserOnlyMode()) {
        state.etsySyncEnabled = enabled;
        await saveState();
    } else {
        try {
            const res = await fetch('/api/sync/etsy/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            state.etsySyncEnabled = enabled;
        } catch (err) {
            showSideGigToast(
                `Failed to update Etsy sync setting: ${err.message}`,
                'error',
            );
        }
    }
    renderEtsyStatus();
}

function initEtsySync() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-etsy-action]');
        if (!btn) return;
        const action = btn.dataset.etsyAction;
        if (action === 'connect') startEtsyConnect();
        else if (action === 'sync') runEtsySyncNow();
        else if (action === 'disconnect') disconnectEtsy();
    });
    document.addEventListener('change', (e) => {
        if (e.target.classList?.contains('etsy-sync-toggle'))
            toggleEtsySync(e.target.checked);
    });
    consumeEtsyOauthFragment().finally(() => renderEtsyStatus());
}
