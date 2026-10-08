/* ==========================================================================
   side-gig.js — Side Hustle Hub Manager & Platform Fee Calculators
   Depends on globals: state, saveState, refreshAllUI, formatCurrency
   ========================================================================== */

function showSideGigToast(message, type = 'success') {
    let toast = document.getElementById('sidegig-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sidegig-toast';
        toast.className = 'app-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add('is-visible');
    clearTimeout(showSideGigToast.timer);
    showSideGigToast.timer = setTimeout(() => {
        toast.classList.remove('is-visible');
    }, 4500);
}

function initSideGigManager() {
    const priceInput = document.getElementById('ebay-price');
    const costInput = document.getElementById('ebay-cost');
    const shippingCharged = document.getElementById('ebay-shipping-charged');
    const shippingActual = document.getElementById('ebay-shipping-actual');
    const catRateInput = document.getElementById('ebay-category-rate');
    const adRateInput = document.getElementById('ebay-ad-rate');

    const inputs = [
        priceInput,
        costInput,
        shippingCharged,
        shippingActual,
        catRateInput,
        adRateInput,
    ];

    inputs.forEach((input) => {
        input.addEventListener('input', calculateEbayProfit);
    });

    document
        .getElementById('btn-save-ebay-sale')
        .addEventListener('click', async () => {
            const gross =
                parseFloat(priceInput.value) +
                parseFloat(shippingCharged.value);
            const fees = calculateEbayFeesTotal();
            const shippingCost = parseFloat(shippingActual.value);
            const costBasis = parseFloat(costInput.value);
            const netProfit = gross - fees - shippingCost - costBasis;

            // Item cost is kept out of `expenses` so tax tagging can apply it
            // as cost basis (see side-gig-tax.js).
            state.sideGigLedger.push({
                id: Date.now().toString(),
                date: localIsoDate(),
                desc: `eBay Sale: $${priceInput.value} Item`,
                category: 'eBay',
                revenue: gross,
                expenses: fees + shippingCost,
                costBasis,
                basisType: 'business',
                net: netProfit,
            });
            await saveState();
            refreshAllUI();
            alert('eBay sale successfully logged to Side Income history!');
        });

    // eBay OAuth Integration
    const ebayOauthBtn = document.getElementById('btn-ebay-oauth');
    if (ebayOauthBtn) {
        ebayOauthBtn.addEventListener('click', () => {
            markEbayConnectPending();
            window.location.assign('/api/sync/ebay/authorize');
        });
    }

    // Finish a browser-only OAuth round-trip, then check status
    consumeEbayOauthFragment();
    checkEbayConnection();

    // Check Plaid connection status on load
    checkPlaidConnection();

    // Initialize Plaid Link
    initPlaidLink();

    const manualForm = document.getElementById('form-sidegig-manual');
    manualForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const desc = document.getElementById('sg-desc').value;
        const cat = document.getElementById('sg-cat').value;
        const revenue = parseFloat(document.getElementById('sg-revenue').value);
        const expense =
            parseFloat(document.getElementById('sg-expense').value) || 0;
        const basisType = document.getElementById('sg-basis').value;
        const costRaw = document.getElementById('sg-cost').value;
        const costBasis = costRaw === '' ? null : parseFloat(costRaw);

        if (desc && !isNaN(revenue)) {
            state.sideGigLedger.push({
                id: Date.now().toString(),
                date: localIsoDate(),
                desc: desc,
                category: cat,
                revenue: revenue,
                expenses: expense,
                ...(basisType ? { basisType } : {}),
                ...(costBasis !== null && !isNaN(costBasis)
                    ? { costBasis }
                    : {}),
                net: revenue - expense - (costBasis || 0),
            });
            await saveState();
            refreshAllUI();
            manualForm.reset();
        }
    });

    initSideGigLedgerActions();
    calculateEbayProfit();
}

// ─── Browser-only (Netlify) eBay mode ────────────────────────────────────────
// With no Express backend (state never synced from /api/state), eBay
// connect/sync run through Netlify Functions (netlify/functions/ebay-*).
// The browser keeps only an opaque token blob, AES-GCM-encrypted server-side
// with SYNC_MASTER_KEY, under its own localStorage key (so JSON backups of
// fire_tracker_state never carry it). Status and the sync toggle are
// derived locally.
const EBAY_TOKEN_KEY = 'fire_tracker_ebay_token';
const EBAY_LAST_SYNC_KEY = 'fire_tracker_ebay_last_sync';
const EBAY_CONNECT_PENDING_KEY = 'fire_tracker_ebay_connect_pending';

// Mirrors isApiSyncedEbayEntry in app/lib/ebay-connector.js: only rows the
// Order API sync created (id exactly `ebay-<orderId>`).
function isApiSyncedEbayEntry(entry) {
    return Boolean(entry?.orderId) && entry.id === `ebay-${entry.orderId}`;
}

// The OAuth `state` cookie protects eBay → callback; this marker protects
// callback → SPA, so a crafted /#ebay-connected=<attacker blob> link can't
// silently connect someone else's eBay account in this browser.
function markEbayConnectPending() {
    try {
        sessionStorage.setItem(EBAY_CONNECT_PENDING_KEY, '1');
    } catch {
        /* storage unavailable — the callback will be ignored */
    }
}

function takeEbayConnectPending() {
    try {
        const pending = sessionStorage.getItem(EBAY_CONNECT_PENDING_KEY);
        sessionStorage.removeItem(EBAY_CONNECT_PENDING_KEY);
        return pending === '1';
    } catch {
        return false;
    }
}

function isBrowserOnlyMode() {
    return typeof syncedRevision === 'undefined' || syncedRevision === null;
}

function readEbayLocal(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeEbayLocal(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        /* storage unavailable — nothing to persist */
    }
}

function localEbayStatus() {
    return {
        connected: Boolean(readEbayLocal(EBAY_TOKEN_KEY)),
        lastSync: readEbayLocal(EBAY_LAST_SYNC_KEY),
        syncEnabled: state.ebaySyncEnabled !== false,
    };
}

async function fetchEbayStatus() {
    if (isBrowserOnlyMode()) return localEbayStatus();
    const res = await fetch('/api/sync/ebay/status');
    return res.json();
}

// ebay-callback returns to /#ebay-connected=<blob> or /#ebay-error=<code>.
async function consumeEbayOauthFragment() {
    const hash = window.location.hash || '';
    const match = hash.match(/^#ebay-(connected|error)=(.*)$/);
    if (!match) return;
    history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
    );
    if (!takeEbayConnectPending()) {
        console.warn('[eBay] Ignored an OAuth result this tab did not start.');
        return;
    }
    if (match[1] === 'connected') {
        writeEbayLocal(EBAY_TOKEN_KEY, decodeURIComponent(match[2]));
        showSideGigToast('eBay connected — syncing your sales…');
        await checkEbayConnection();
        try {
            await runEbaySyncNow({ silent: true });
            showSideGigToast('eBay connected and sales synced.');
        } catch (err) {
            showSideGigToast(
                `eBay connected, but the first sync failed: ${err.message}`,
                'error',
            );
        }
    } else {
        showSideGigToast(
            `eBay connection failed (${match[2]}). Please try again.`,
            'error',
        );
    }
}

// eBay revoked the grant (user disconnected the app or closed/deleted
// their eBay account): drop the token and, for a revocation, the rows
// the Order API sync created, then tell the user. Manually logged sales
// and uploaded CSV reports are the user's own records and are kept.
async function handleEbayConnectionLost(code, message) {
    writeEbayLocal(EBAY_TOKEN_KEY, null);
    writeEbayLocal(EBAY_LAST_SYNC_KEY, null);
    let removed = 0;
    if (code === 'ebay_revoked') {
        if (isBrowserOnlyMode()) {
            const before = state.sideGigLedger.length;
            state.sideGigLedger = state.sideGigLedger.filter(
                (e) => !isApiSyncedEbayEntry(e),
            );
            removed = before - state.sideGigLedger.length;
            await saveState();
        } else if (typeof resyncStateFromServer === 'function') {
            // The server already purged its tokens and synced rows.
            await resyncStateFromServer({ force: true });
        }
        if (typeof refreshAllUI === 'function') refreshAllUI();
    }
    alert(
        `${message}${removed ? ` Removed ${removed} eBay-synced sale${removed === 1 ? '' : 's'} from this browser.` : ''}`,
    );
    checkEbayConnection();
}

async function checkEbayConnection() {
    const statusEl = document.getElementById('ebay-sync-status');
    if (!statusEl) return;
    try {
        const data = await fetchEbayStatus();
        if (data.connected) {
            const lastSync = data.lastSync
                ? new Date(data.lastSync).toLocaleDateString()
                : 'never';
            statusEl.textContent = `Status: Connected (Last sync: ${lastSync})`;
            statusEl.style.color = 'var(--color-success)';
        } else {
            statusEl.textContent = 'Status: Disconnected';
            statusEl.style.color = 'var(--text-muted)';
        }
    } catch (err) {
        statusEl.textContent = 'Status: Error checking connection';
        statusEl.style.color = 'var(--color-danger)';
    }
}

// Settings tab — eBay Sync card. Reads/writes the server-side
// `ebaySyncEnabled` gate via /api/sync/ebay/*; the OAuth connect flow itself
// stays on the Financial Overview card (checkEbayConnection above).
async function loadEbaySettingsPanel() {
    const toggle = document.getElementById('setting-ebay-sync-enabled');
    const statusEl = document.getElementById('settings-ebay-status');
    const syncBtn = document.getElementById('btn-ebay-sync-now');
    if (!toggle || !statusEl) return;
    try {
        const data = await fetchEbayStatus();
        toggle.checked = data.syncEnabled !== false;
        const lastSyncText = data.lastSync
            ? new Date(data.lastSync).toLocaleString()
            : 'never';
        if (!data.connected) {
            statusEl.textContent =
                'Not connected — use the eBay Seller API card in Financial Overview to connect your account first.';
            statusEl.style.color = 'var(--text-muted)';
        } else {
            statusEl.textContent = `Connected · Last sync: ${lastSyncText}`;
            statusEl.style.color = 'var(--color-success)';
        }
        if (syncBtn) syncBtn.disabled = !data.connected || !toggle.checked;
    } catch (err) {
        statusEl.textContent = 'Unable to check eBay sync status.';
        statusEl.style.color = 'var(--color-danger)';
    }
}

async function toggleEbaySyncSetting() {
    const toggle = document.getElementById('setting-ebay-sync-enabled');
    if (!toggle) return;
    const enabled = toggle.checked;
    if (isBrowserOnlyMode()) {
        state.ebaySyncEnabled = enabled;
        await saveState();
        loadEbaySettingsPanel();
        return;
    }
    try {
        const res = await fetch('/api/sync/ebay/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            alert(d.error || 'Failed to update eBay sync setting.');
            toggle.checked = !enabled;
            return;
        }
    } catch (err) {
        alert('Failed to update eBay sync setting: ' + err.message);
        toggle.checked = !enabled;
        return;
    }
    loadEbaySettingsPanel();
}

async function runEbaySyncNow({ silent = false } = {}) {
    const btn =
        document.getElementById('btn-sidegig-ebay-sync') ||
        document.getElementById('btn-ebay-sync-now');
    const statusEl = document.getElementById('ebay-sync-status');
    if (!btn) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Syncing…';
    try {
        const data = isBrowserOnlyMode()
            ? await syncEbayViaFunction()
            : await syncEbayViaServer();
        if (!data)
            throw new Error(
                'eBay connection is no longer valid. Reconnect eBay and try again.',
            );
        if (statusEl) {
            statusEl.textContent = `Status: Connected · Synced ${data.added} new order${data.added === 1 ? '' : 's'} of ${data.fetched} fetched`;
            statusEl.style.color = 'var(--color-success)';
        }
        if (!silent)
            showSideGigToast(
                `eBay sync complete — ${data.added} new order${data.added === 1 ? '' : 's'}.`,
            );
        if (typeof refreshAllUI === 'function') refreshAllUI();
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `Sync failed: ${err.message}`;
            statusEl.style.color = 'var(--color-danger)';
        }
        if (!silent)
            showSideGigToast(`eBay sync failed: ${err.message}`, 'error');
    } finally {
        btn.textContent = original;
        loadEbaySettingsPanel();
    }
}

async function syncEbayViaServer() {
    const res = await fetch('/api/sync/ebay/sync', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.code) {
        await handleEbayConnectionLost(data.code, data.error);
        return null;
    }
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    return data;
}

async function syncEbayViaFunction() {
    if (state.ebaySyncEnabled === false) {
        throw new Error('eBay sync is disabled. Enable it above first.');
    }
    const blob = readEbayLocal(EBAY_TOKEN_KEY);
    if (!blob) throw new Error('eBay is not connected.');
    const res = await fetch('/api/sync/ebay/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: blob }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.code) {
        await handleEbayConnectionLost(data.code, data.error);
        return null;
    }
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    if (data.tokens) writeEbayLocal(EBAY_TOKEN_KEY, data.tokens);
    let added = 0;
    for (const entry of data.entries || []) {
        if (!state.sideGigLedger.some((e) => e.id === entry.id)) {
            state.sideGigLedger.push(entry);
            added++;
        }
    }
    await saveState();
    writeEbayLocal(EBAY_LAST_SYNC_KEY, data.syncedAt);
    return { ...data, added };
}

const PLAID_HOSTED_TOKEN_KEY = 'fire_plaid_hosted_token';
const PLAID_HOSTED_SYNC_KEY = 'fire_plaid_hosted_sync_enabled';
const PLAID_HOSTED_ACCESS_KEY = 'fire_plaid_hosted_access_key';

function isHostedPlaid() {
    return (
        window.location.hostname === 'lifefire.netlify.app' ||
        window.location.hostname.endsWith('.netlify.app')
    );
}

function getHostedPlaidToken() {
    return localStorage.getItem(PLAID_HOSTED_TOKEN_KEY) || '';
}

function setHostedPlaidToken(token) {
    if (token) localStorage.setItem(PLAID_HOSTED_TOKEN_KEY, token);
    else localStorage.removeItem(PLAID_HOSTED_TOKEN_KEY);
}

async function plaidRequest(path, options = {}, retried = false) {
    const { deferHostedTokenPersistence = false, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers || {});
    if (isHostedPlaid()) {
        const token = getHostedPlaidToken();
        if (token) headers.set('x-fire-plaid-token', token);
        const accessKey = localStorage.getItem(PLAID_HOSTED_ACCESS_KEY);
        if (accessKey) headers.set('x-fire-plaid-access', accessKey);
    }
    let body = fetchOptions.body;
    if (body && typeof body !== 'string') {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(body);
    }
    const res = await fetch(path, { ...fetchOptions, body, headers });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error(
            `Server returned a non-JSON response (HTTP ${res.status}).`,
        );
    }
    let data;
    try {
        data = await res.json();
    } catch {
        throw new Error(`Server returned malformed JSON (HTTP ${res.status}).`);
    }
    if (isHostedPlaid() && res.status === 401) {
        if (data.code === 'ACCESS_KEY_REQUIRED' && !retried) {
            const key = window.prompt(
                'Enter the hosted Plaid access key for this site:',
            );
            if (key?.trim()) {
                localStorage.setItem(PLAID_HOSTED_ACCESS_KEY, key.trim());
                return plaidRequest(path, options, true);
            }
        }
        // A dead token can never become valid again; drop it so the user
        // can link afresh instead of being stuck on the same 401.
        if (data.code === 'INVALID_TOKEN') setHostedPlaidToken('');
    }
    if (isHostedPlaid() && data.plaidToken && !deferHostedTokenPersistence) {
        setHostedPlaidToken(data.plaidToken);
    }
    return { res, data };
}

// Plaid rows without a plaidItemId predate item-aware sync. Replace them by
// id, or all of them when the sync was complete (no partial warning).
function applyHostedPlaidAccounts(
    accounts,
    syncedItemIds = [],
    partial = false,
) {
    const synced = new Set(syncedItemIds);
    const incomingIds = new Set(accounts.map((account) => account.id));
    const retained = (state.customAccounts || []).filter((account) =>
        account.source !== 'plaid'
            ? true
            : !incomingIds.has(account.id) &&
              (account.plaidItemId
                  ? !synced.has(account.plaidItemId)
                  : partial),
    );
    state.customAccounts = [...retained, ...accounts];
}

function applyHostedPlaidPositions(
    positions,
    syncedItemIds = [],
    partial = false,
) {
    const synced = new Set(syncedItemIds);
    const retained = (state.importedPositions || []).filter((position) =>
        position.source !== 'plaid'
            ? true
            : position.plaidItemId
              ? !synced.has(position.plaidItemId)
              : partial,
    );
    state.importedPositions = [...retained, ...positions];
}

function applyHostedPlaidTransactions(data) {
    const parsedAdded = data.transactions?.added || [];
    const parsedModified = data.transactions?.modified || [];
    const removedIds = new Set(data.transactions?.removedIds || []);
    if (!state.spendingTransactions) state.spendingTransactions = [];

    state.spendingTransactions = state.spendingTransactions.filter(
        (txn) => !removedIds.has(txn.id),
    );
    for (const txn of parsedAdded) {
        if (
            !state.spendingTransactions.some(
                (existing) => existing.id === txn.id,
            )
        ) {
            state.spendingTransactions.push(txn);
        }
    }
    for (const txn of parsedModified) {
        const index = state.spendingTransactions.findIndex(
            (existing) => existing.id === txn.id,
        );
        if (index === -1) state.spendingTransactions.push(txn);
        else state.spendingTransactions[index] = txn;
    }
}

async function checkPlaidConnection() {
    const statusEl = document.getElementById('plaid-sync-status');
    if (!statusEl) return;
    try {
        const { res, data } = await plaidRequest('/api/sync/plaid/status');
        if (!res.ok)
            throw new Error(data.error || 'Unable to check Plaid status.');
        if (data.connected) {
            statusEl.textContent = `Status: Linked (${data.itemCount} account${data.itemCount !== 1 ? 's' : ''})`;
            statusEl.style.color = 'var(--color-success)';
        } else {
            statusEl.textContent = 'Status: Not Linked';
            statusEl.style.color = 'var(--text-muted)';
        }
        if (typeof setFidelityImportDisabled === 'function') {
            const syncEnabled = isHostedPlaid()
                ? localStorage.getItem(PLAID_HOSTED_SYNC_KEY) !== 'false'
                : data.syncEnabled !== false;
            setFidelityImportDisabled(data.connected && syncEnabled);
        }
    } catch (err) {
        statusEl.textContent = `Status: Error - ${err.message}`;
        statusEl.style.color = 'var(--color-danger)';
    }
}

let plaidLinkHandler = null;

function initPlaidLink() {
    const linkBtn = document.getElementById('btn-plaid-link');
    if (!linkBtn) return;

    linkBtn.addEventListener('click', async () => {
        const statusEl = document.getElementById('plaid-sync-status');
        statusEl.textContent = 'Status: Opening Plaid Link...';
        statusEl.style.color = 'var(--color-warning)';

        try {
            const { res, data } = await plaidRequest(
                '/api/sync/plaid/create-link-token',
                { method: 'POST' },
            );
            if (!res.ok || !data.linkToken) {
                throw new Error(data.error || 'Failed to create link token');
            }

            if (plaidLinkHandler) plaidLinkHandler.destroy();

            plaidLinkHandler = Plaid.create({
                token: data.linkToken,
                onSuccess: async (public_token) => {
                    statusEl.textContent = 'Status: Exchanging token...';
                    statusEl.style.color = 'var(--color-warning)';

                    try {
                        const { res: exchangeRes, data: exchangeData } =
                            await plaidRequest('/api/sync/plaid/exchange', {
                                method: 'POST',
                                body: {
                                    public_token,
                                    ...(isHostedPlaid()
                                        ? { plaidToken: getHostedPlaidToken() }
                                        : {}),
                                },
                            });

                        if (
                            !exchangeRes.ok ||
                            exchangeData.status !== 'success'
                        ) {
                            throw new Error(
                                exchangeData.error || 'Token exchange failed',
                            );
                        }

                        if (isHostedPlaid() && exchangeData.plaidToken) {
                            setHostedPlaidToken(exchangeData.plaidToken);
                        }

                        const accountsResult = await plaidRequest(
                            '/api/sync/plaid/accounts',
                            { method: 'POST' },
                        );
                        if (!accountsResult.res.ok)
                            throw new Error(
                                accountsResult.data.error ||
                                    'Account sync failed',
                            );
                        if (isHostedPlaid()) {
                            applyHostedPlaidAccounts(
                                accountsResult.data.accounts || [],
                                accountsResult.data.syncedItemIds || [],
                                Boolean(accountsResult.data.warning),
                            );
                            await saveState();
                        }

                        const positionsResult = await plaidRequest(
                            '/api/sync/plaid/positions',
                            { method: 'POST' },
                        );
                        if (!positionsResult.res.ok)
                            throw new Error(
                                positionsResult.data.error ||
                                    'Position sync failed',
                            );
                        if (isHostedPlaid()) {
                            applyHostedPlaidPositions(
                                positionsResult.data.positions || [],
                                positionsResult.data.syncedItemIds || [],
                                Boolean(positionsResult.data.warning),
                            );
                            await saveState();
                        }

                        await checkPlaidConnection();
                        refreshAllUI();
                        const warnings = [
                            exchangeData.warning,
                            accountsResult.data.warning,
                            positionsResult.data.warning,
                        ].filter(Boolean);
                        if (warnings.length) {
                            statusEl.textContent = `Status: Linked with warnings - ${warnings.join(' ')}`;
                            statusEl.style.color = 'var(--color-warning)';
                        }
                    } catch (err) {
                        statusEl.textContent = `Status: Error - ${err.message}`;
                        statusEl.style.color = 'var(--color-danger)';
                    }
                },
                onExit: (err) => {
                    if (err) {
                        statusEl.textContent = `Status: ${err.error_message || 'Cancelled'}`;
                        statusEl.style.color = 'var(--color-danger)';
                    } else {
                        statusEl.textContent = 'Status: Not Linked';
                        statusEl.style.color = 'var(--text-muted)';
                    }
                },
                onEvent: (eventName, metadata) => {
                    console.log('[Plaid Link Event]', eventName, metadata);
                },
            });

            plaidLinkHandler.open();
        } catch (err) {
            statusEl.textContent = `Status: Error - ${err.message}`;
            statusEl.style.color = 'var(--color-danger)';
        }
    });
}

// `note` ({ text, color }) is the outcome of a sync that just ran; it is
// appended to the linked status so the refresh doesn't wipe it.
async function loadPlaidSettingsPanel(note = null) {
    const toggle = document.getElementById('setting-plaid-sync-enabled');
    const statusEl = document.getElementById('settings-plaid-status');
    const syncBtn = document.getElementById('btn-plaid-sync-now');
    if (!toggle || !statusEl) return;
    try {
        const { res, data } = await plaidRequest('/api/sync/plaid/status');
        if (!res.ok)
            throw new Error(data.error || 'Unable to check Plaid status.');
        const syncEnabled = isHostedPlaid()
            ? localStorage.getItem(PLAID_HOSTED_SYNC_KEY) !== 'false'
            : data.syncEnabled !== false;
        toggle.checked = syncEnabled;
        if (!data.connected) {
            statusEl.textContent =
                'Not connected — use the Plaid Investments card in Financial Overview to link an account first.';
            statusEl.style.color = 'var(--text-muted)';
        } else {
            const lastSyncText = data.lastTransactionsSync
                ? new Date(data.lastTransactionsSync).toLocaleString()
                : 'never';
            const linkedText = `Linked (${data.itemCount} account${data.itemCount !== 1 ? 's' : ''}) · Last sync: ${lastSyncText}`;
            statusEl.textContent = note
                ? `${linkedText} · ${note.text}`
                : linkedText;
            statusEl.style.color = note?.color || 'var(--color-success)';
        }
        if (syncBtn) syncBtn.disabled = !data.connected || !toggle.checked;
        if (typeof setFidelityImportDisabled === 'function') {
            setFidelityImportDisabled(data.connected && syncEnabled);
        }
    } catch (err) {
        statusEl.textContent = 'Unable to check Plaid sync status.';
        statusEl.style.color = 'var(--color-danger)';
    }
}

async function togglePlaidSyncSetting() {
    const toggle = document.getElementById('setting-plaid-sync-enabled');
    if (!toggle) return;
    const enabled = toggle.checked;
    try {
        if (isHostedPlaid()) {
            localStorage.setItem(PLAID_HOSTED_SYNC_KEY, String(enabled));
        } else {
            const { res, data } = await plaidRequest('/api/sync/plaid/toggle', {
                method: 'POST',
                body: { enabled },
            });
            if (!res.ok)
                throw new Error(
                    data.error || 'Failed to update Plaid sync setting.',
                );
        }
    } catch (err) {
        alert(err.message);
        toggle.checked = !enabled;
        return;
    }
    loadPlaidSettingsPanel();
}

async function runPlaidTransactionsSyncNow() {
    const btn = document.getElementById('btn-plaid-sync-now');
    const statusEl = document.getElementById('settings-plaid-status');
    if (!btn) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Syncing…';
    let note = null;
    try {
        const { res, data } = await plaidRequest(
            '/api/sync/plaid/transactions',
            { method: 'POST', deferHostedTokenPersistence: true },
        );
        if (!res.ok) throw new Error(data.error || 'Sync failed');
        if (isHostedPlaid()) {
            applyHostedPlaidTransactions(data);
            await saveState();
            if (data.plaidToken) setHostedPlaidToken(data.plaidToken);
        }
        const summary = `Synced ${data.added} new transaction${data.added === 1 ? '' : 's'} of ${data.fetched} fetched.`;
        note = data.warning
            ? {
                  text: `${summary} ${data.warning}`,
                  color: 'var(--color-warning)',
              }
            : { text: summary, color: 'var(--color-success)' };
        if (statusEl) {
            statusEl.textContent = note.text;
            statusEl.style.color = note.color;
        }
        if (typeof refreshAllUI === 'function') refreshAllUI();
    } catch (err) {
        note = {
            text: `Sync failed: ${err.message}`,
            color: 'var(--color-danger)',
        };
        if (statusEl) {
            statusEl.textContent = note.text;
            statusEl.style.color = note.color;
        }
    } finally {
        btn.textContent = original;
        loadPlaidSettingsPanel(note);
    }
}

function calculateEbayFeesTotal() {
    const price = parseFloat(document.getElementById('ebay-price').value) || 0;
    const shippingCharged =
        parseFloat(document.getElementById('ebay-shipping-charged').value) || 0;
    const categoryRate =
        parseFloat(document.getElementById('ebay-category-rate').value) / 100;
    const adRate =
        parseFloat(document.getElementById('ebay-ad-rate').value) / 100;

    const totalTransactionVal = price + shippingCharged;
    // eBay's per-order fee is $0.30 for orders of $10.00 or less, $0.40 above
    // that — not a flat $0.30 regardless of order size.
    const orderFee = totalTransactionVal > 10 ? 0.4 : 0.3;
    const standardFee = totalTransactionVal * categoryRate + orderFee;
    const adFee = totalTransactionVal * adRate;

    return standardFee + adFee;
}

function calculateEbayProfit() {
    const price = parseFloat(document.getElementById('ebay-price').value) || 0;
    const cost = parseFloat(document.getElementById('ebay-cost').value) || 0;
    const shippingCharged =
        parseFloat(document.getElementById('ebay-shipping-charged').value) || 0;
    const shippingActual =
        parseFloat(document.getElementById('ebay-shipping-actual').value) || 0;

    const gross = price + shippingCharged;
    const fees = calculateEbayFeesTotal();
    const netProfit = gross - fees - shippingActual - cost;
    const roi = cost > 0 ? (netProfit / cost) * 100 : 0;

    document.getElementById('ebay-res-gross').textContent =
        formatCurrency(gross);
    document.getElementById('ebay-res-fees').textContent = formatCurrency(fees);
    document.getElementById('ebay-res-profit').textContent =
        formatCurrency(netProfit);
    document.getElementById('ebay-res-roi').textContent = `${roi.toFixed(1)}%`;

    const profitBox = document.getElementById('ebay-res-profit');
    if (netProfit < 0) {
        profitBox.className = 'result-value text-coral';
    } else {
        profitBox.className = 'result-value text-emerald';
    }
}

// Inline edits from the ledger table: tag how an item was acquired, and its
// cost basis (blank = unknown).
window.updateSideGigTax = async function (id, field, value) {
    const idx = state.sideGigLedger.findIndex((sg) => sg.id === id);
    if (idx < 0) return;
    const entry = state.sideGigLedger[idx];
    if (field === 'basisType') {
        if (value) entry.basisType = value;
        else delete entry.basisType;
    } else if (field === 'costBasis') {
        state.sideGigLedger[idx] = applyCostBasis(entry, value);
    }
    await saveState();
    refreshAllUI();
};

// Delegated so ledger ids never end up inside inline JS handlers.
function initSideGigLedgerActions() {
    document
        .getElementById('btn-sg-bulk-tag')
        ?.addEventListener('click', async () => {
            const basis = document.getElementById('sg-bulk-basis')?.value;
            const { ledger, tagged } = tagUntaggedSales(
                state.sideGigLedger,
                basis,
            );
            if (!tagged) {
                alert('Every sale already has a tax tag.');
                return;
            }
            state.sideGigLedger = ledger;
            await saveState();
            refreshAllUI();
        });
    document
        .getElementById('sg-filter-missing-cost')
        ?.addEventListener('change', () => renderSideGigLedgerTable());

    const table = document.getElementById('table-sidegig-history');
    if (!table) return;
    // Fast cost entry: Enter saves this item's cost and jumps to the next
    // row's cost box (the change handler below does the saving).
    table.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const input = e.target.closest('.sg-cost-input');
        if (!input) return;
        e.preventDefault();
        const inputs = [...table.querySelectorAll('.sg-cost-input')];
        const nextId = inputs[inputs.indexOf(input) + 1]?.dataset.sgId;
        input.blur(); // fires change → save → re-render
        if (nextId) {
            setTimeout(() => {
                const next = [...table.querySelectorAll('.sg-cost-input')].find(
                    (el) => el.dataset.sgId === nextId,
                );
                next?.focus();
                next?.select();
            }, 150);
        }
    });
    table.addEventListener('change', (e) => {
        const el = e.target.closest('[data-sg-field]');
        if (el) updateSideGigTax(el.dataset.sgId, el.dataset.sgField, el.value);
    });
    table.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sg-delete]');
        if (btn) deleteSideGigEntry(btn.dataset.sgDelete);
    });
}

window.deleteSideGigEntry = async function (id) {
    state.sideGigLedger = state.sideGigLedger.filter((sg) => sg.id !== id);
    await saveState();
    refreshAllUI();
};

// Import an eBay Seller Hub listings sales report into the Side Gig Ledger.
// Returns true when the text was an eBay report (even if nothing was new).
async function importEbayReportText(text, fileName) {
    const report = parseEbayListingsReport(parseCSVText(text));
    if (!report) return false;
    if (!report.range) {
        alert(
            'Could not read the report date range ("Report for … to …"), so it was not imported.',
        );
        return true;
    }
    if (report.items.length === 0) {
        alert('That eBay report has no sales rows to import.');
        return true;
    }
    const before = state.sideGigLedger;
    const merged = mergeEbayReport(before, report);
    state.sideGigLedger = merged.ledger;
    try {
        await saveState();
    } catch (err) {
        state.sideGigLedger = before;
        console.error('Failed to save eBay report import:', err);
        alert('Could not save the eBay import.');
        return true;
    }
    refreshAllUI();
    const parts = [`${merged.added} added`];
    if (merged.replaced)
        parts.push(`${merged.replaced} updated from a newer report`);
    if (merged.updated)
        parts.push(`${merged.updated} re-imported with corrected amounts`);
    if (merged.skipped) parts.push(`${merged.skipped} already imported`);
    alert(`eBay report ${fileName || ''}: ${parts.join(', ')}.`);
    return true;
}

// Import a Mercari / Poshmark / FB Marketplace export into the ledger.
// Returns true when the text was one of those reports.
async function importMarketplaceReportText(text, fileName) {
    const report = parseMarketplaceReport(parseCSVText(text));
    if (!report) return false;
    if (!report.entries.length) {
        alert(`That ${report.category} file has no sales rows to import.`);
        return true;
    }
    const before = state.sideGigLedger;
    const merged = mergeMarketplaceEntries(before, report.entries);
    state.sideGigLedger = merged.ledger;
    try {
        await saveState();
    } catch (err) {
        state.sideGigLedger = before;
        console.error(`Failed to save ${report.category} import:`, err);
        alert(`Could not save the ${report.category} import.`);
        return true;
    }
    refreshAllUI();
    const parts = [`${merged.added} added`];
    if (merged.skipped) parts.push(`${merged.skipped} already imported`);
    if (report.skipped)
        parts.push(`${report.skipped} canceled/returned or blank rows skipped`);
    alert(`${report.category} report ${fileName || ''}: ${parts.join(', ')}.`);
    return true;
}

function initEbayReportUpload() {
    const btn = document.getElementById('btn-ebay-report-upload');
    const input = document.getElementById('ebay-report-input');
    if (!btn || !input) return;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const ok =
                (await importEbayReportText(text, file.name)) ||
                (await importMarketplaceReportText(text, file.name));
            if (!ok)
                alert(
                    'That file is not a recognised sales report (eBay listings report, Mercari sales history, Poshmark sales report, or the FB Marketplace template).',
                );
        } catch (err) {
            console.error('Failed to read eBay report:', err);
            alert('Could not read that file.');
        } finally {
            input.value = '';
        }
    });
}

function initPlatformCalculators() {
    initEbayReportUpload();
    // Tab switching
    document.querySelectorAll('.platform-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document
                .querySelectorAll('.platform-tab-btn')
                .forEach((b) => b.classList.remove('active'));
            document
                .querySelectorAll('.platform-calc-panel')
                .forEach((p) => (p.style.display = 'none'));
            btn.classList.add('active');
            const panel = document.getElementById(
                `calc-panel-${btn.dataset.platform}`,
            );
            // 'block', not '': the non-eBay panels start hidden by a CSS
            // class (csp-i-001), which an empty inline style can't override.
            if (panel) panel.style.display = 'block';
        });
    });

    // Etsy live calculation
    [
        'etsy-price',
        'etsy-shipping-charged',
        'etsy-shipping-actual',
        'etsy-cost',
        'etsy-ads-rate',
    ].forEach((id) => {
        document
            .getElementById(id)
            ?.addEventListener('input', calculateEtsyProfit);
    });

    // FB live calculation
    ['fb-price', 'fb-shipping-actual', 'fb-cost', 'fb-is-shipped'].forEach(
        (id) => {
            document
                .getElementById(id)
                ?.addEventListener('input', calculateFBProfit);
            document
                .getElementById(id)
                ?.addEventListener('change', calculateFBProfit);
        },
    );

    // Log buttons
    document
        .getElementById('btn-save-etsy-sale')
        ?.addEventListener('click', async () => {
            const price =
                parseFloat(document.getElementById('etsy-price').value) || 0;
            const shipping =
                parseFloat(
                    document.getElementById('etsy-shipping-charged').value,
                ) || 0;
            const shippingActual =
                parseFloat(
                    document.getElementById('etsy-shipping-actual').value,
                ) || 0;
            const cost =
                parseFloat(document.getElementById('etsy-cost').value) || 0;
            const adsRate =
                parseFloat(document.getElementById('etsy-ads-rate').value) || 0;
            const fees = calculateEtsyFeesTotal(price, shipping, adsRate);
            const net = price + shipping - fees - shippingActual - cost;
            state.sideGigLedger.push({
                id: Date.now().toString(),
                desc: `Etsy Sale: $${price} Item`,
                category: 'Etsy',
                revenue: price + shipping,
                expenses: fees + shippingActual + cost,
                net,
            });
            await saveState();
            refreshAllUI();
            alert('Etsy sale logged to Side Income history!');
        });

    document
        .getElementById('btn-save-fb-sale')
        ?.addEventListener('click', async () => {
            const price =
                parseFloat(document.getElementById('fb-price').value) || 0;
            const shippingActual =
                parseFloat(
                    document.getElementById('fb-shipping-actual').value,
                ) || 0;
            const cost =
                parseFloat(document.getElementById('fb-cost').value) || 0;
            const isShipped = document.getElementById('fb-is-shipped')?.checked;
            const fees = calculateFBFeesTotal(price, isShipped);
            const net = price - fees - shippingActual - cost;
            state.sideGigLedger.push({
                id: Date.now().toString(),
                desc: `FB Marketplace Sale: $${price} Item`,
                category: 'FB Marketplace',
                revenue: price,
                expenses: fees + shippingActual + cost,
                net,
            });
            await saveState();
            refreshAllUI();
            alert('FB Marketplace sale logged to Side Income history!');
        });

    // Mercari / Poshmark live calculation
    [
        'mercari-price',
        'mercari-cost',
        'mercari-shipping-buyer',
        'mercari-shipping-actual',
        'mercari-processing',
    ].forEach((id) => {
        const el = document.getElementById(id);
        el?.addEventListener('input', calculateMercariProfit);
        el?.addEventListener('change', calculateMercariProfit);
    });
    ['poshmark-price', 'poshmark-cost', 'poshmark-shipping-discount'].forEach(
        (id) => {
            document
                .getElementById(id)
                ?.addEventListener('input', calculatePoshmarkProfit);
        },
    );
    document
        .getElementById('btn-save-mercari-sale')
        ?.addEventListener('click', () =>
            logCalculatorSale('Mercari', readMercariInputs()),
        );
    document
        .getElementById('btn-save-poshmark-sale')
        ?.addEventListener('click', () =>
            logCalculatorSale('Poshmark', readPoshmarkInputs()),
        );

    calculateEtsyProfit();
    calculateFBProfit();
    calculateMercariProfit();
    calculatePoshmarkProfit();
}

const calcNum = (id) => parseFloat(document.getElementById(id)?.value) || 0;

// Calculator rows keep the item cost in costBasis (not expenses), so the
// tax summary and the "missing cost" totals treat them like synced sales.
async function logCalculatorSale(platform, r) {
    const sale = {
        id: Date.now().toString(),
        date: localIsoDate(),
        desc: `${platform} Sale: $${r.price} Item`,
        category: platform,
        revenue: Math.round(r.gross * 100) / 100,
        expenses: Math.round((r.fees + r.shipping) * 100) / 100,
        costBasis: r.cost,
        net: Math.round(r.net * 100) / 100,
    };
    state.sideGigLedger = [...state.sideGigLedger, sale];
    try {
        await saveState();
    } catch (err) {
        // Remove only this sale: another one may have been logged while
        // this save was in flight.
        state.sideGigLedger = state.sideGigLedger.filter((e) => e !== sale);
        console.error(`Failed to save ${platform} sale:`, err);
        showSideGigToast(`Could not save the ${platform} sale.`, 'error');
        return;
    }
    refreshAllUI();
    showSideGigToast(`${platform} sale logged to the Side Gig Ledger.`);
}

// Mercari: 10% of item price + buyer-paid shipping. The 2.9% + $0.50
// payment processing fee has been charged to sellers at some times and to
// buyers at others, so it's an opt-in checkbox.
function calculateMercariFeesTotal(price, buyerShipping, sellerPaysProcessing) {
    const base = (price || 0) + (buyerShipping || 0);
    if (base <= 0) return 0;
    const selling = base * 0.1;
    const processing = sellerPaysProcessing ? base * 0.029 + 0.5 : 0;
    return selling + processing;
}

function readMercariInputs() {
    const price = calcNum('mercari-price');
    const buyerShipping = calcNum('mercari-shipping-buyer');
    const shipping = calcNum('mercari-shipping-actual');
    const cost = calcNum('mercari-cost');
    const processing = Boolean(
        document.getElementById('mercari-processing')?.checked,
    );
    const gross = price + buyerShipping;
    const fees = calculateMercariFeesTotal(price, buyerShipping, processing);
    return {
        price,
        gross,
        fees,
        shipping,
        cost,
        net: gross - fees - shipping - cost,
    };
}

// Poshmark: $2.95 flat under $15, 20% at $15+; the buyer pays the label.
function calculatePoshmarkFeesTotal(price) {
    const p = price || 0;
    if (p <= 0) return 0;
    return p < 15 ? 2.95 : p * 0.2;
}

function readPoshmarkInputs() {
    const price = calcNum('poshmark-price');
    const shipping = calcNum('poshmark-shipping-discount');
    const cost = calcNum('poshmark-cost');
    const fees = calculatePoshmarkFeesTotal(price);
    return {
        price,
        gross: price,
        fees,
        shipping,
        cost,
        net: price - fees - shipping - cost,
    };
}

function renderCalcResults(prefix, r) {
    const roi = r.cost > 0 ? (r.net / r.cost) * 100 : 0;
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set(`${prefix}-res-gross`, formatCurrency(r.gross));
    set(`${prefix}-res-fees`, formatCurrency(r.fees));
    set(`${prefix}-res-profit`, formatCurrency(r.net));
    set(`${prefix}-res-roi`, `${roi.toFixed(1)}%`);
    const profitEl = document.getElementById(`${prefix}-res-profit`);
    if (profitEl)
        profitEl.className = `result-value ${r.net < 0 ? 'text-coral' : 'text-emerald'}`;
}

function calculateMercariProfit() {
    renderCalcResults('mercari', readMercariInputs());
}

function calculatePoshmarkProfit() {
    renderCalcResults('poshmark', readPoshmarkInputs());
}

function calculateEtsyFeesTotal(price, shipping, adsRate) {
    const p = price || 0;
    const s = shipping || 0;
    const listing = 0.2;
    const transaction = (p + s) * 0.065;
    const payment = (p + s) * 0.03 + 0.25;
    const ads = (p + s) * ((adsRate || 0) / 100);
    return listing + transaction + payment + ads;
}

function calculateEtsyProfit() {
    const price = parseFloat(document.getElementById('etsy-price')?.value) || 0;
    const shipping =
        parseFloat(document.getElementById('etsy-shipping-charged')?.value) ||
        0;
    const shippingActual =
        parseFloat(document.getElementById('etsy-shipping-actual')?.value) || 0;
    const cost = parseFloat(document.getElementById('etsy-cost')?.value) || 0;
    const adsRate =
        parseFloat(document.getElementById('etsy-ads-rate')?.value) || 0;

    const gross = price + shipping;
    const fees = calculateEtsyFeesTotal(price, shipping, adsRate);
    const net = gross - fees - shippingActual - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('etsy-res-gross', formatCurrency(gross));
    set('etsy-res-fees', formatCurrency(fees));
    set('etsy-res-profit', formatCurrency(net));
    set('etsy-res-roi', `${roi.toFixed(1)}%`);
    const profitEl = document.getElementById('etsy-res-profit');
    if (profitEl)
        profitEl.className = `result-value ${net < 0 ? 'text-coral' : 'text-emerald'}`;
}

function calculateFBFeesTotal(price, isShipped) {
    if (!isShipped) return 0;
    return Math.max((price || 0) * 0.05, 0.4);
}

function calculateFBProfit() {
    const price = parseFloat(document.getElementById('fb-price')?.value) || 0;
    const shippingActual =
        parseFloat(document.getElementById('fb-shipping-actual')?.value) || 0;
    const cost = parseFloat(document.getElementById('fb-cost')?.value) || 0;
    const isShipped =
        document.getElementById('fb-is-shipped')?.checked || false;

    const fees = calculateFBFeesTotal(price, isShipped);
    const net = price - fees - shippingActual - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('fb-res-gross', formatCurrency(price));
    set('fb-res-fees', formatCurrency(fees));
    set('fb-res-profit', formatCurrency(net));
    set('fb-res-roi', `${roi.toFixed(1)}%`);
    const profitEl = document.getElementById('fb-res-profit');
    if (profitEl)
        profitEl.className = `result-value ${net < 0 ? 'text-coral' : 'text-emerald'}`;

    const feeNote = document.getElementById('fb-fee-note');
    if (feeNote)
        feeNote.textContent = isShipped
            ? 'FB checkout fee: 5% (min $0.40)'
            : 'Local pickup — no selling fee';
}
