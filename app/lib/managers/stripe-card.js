/* ==========================================================================
   managers/stripe-card.js — Stripe connection card (Settings)
   Loaded via index.html alongside stripe-status.js.
   Self-hosted only: GET /api/sync/stripe/status, DELETE /api/sync/stripe/disconnect
   ========================================================================== */

let lastStripeData = null;
let loadCounter = 0;

function renderStripeCard(data) {
    const statusEl = document.getElementById('stripe-status');
    const hintEl = document.getElementById('stripe-hint');
    const lastSyncEl = document.getElementById('stripe-last-sync');
    const disconnectBtn = document.getElementById('btn-stripe-disconnect');
    if (!statusEl) return;

    // Not configured on this deployment (hosted Netlify, etc.)
    if (data.configured === false) {
        statusEl.textContent =
            'Stripe sync is available on self-hosted deployments only';
        statusEl.style.color = 'var(--color-warning, var(--color-danger))';
        // Setup steps are for whoever runs the server, never hosted visitors.
        if (hintEl) {
            hintEl.textContent =
                data.hosted === true
                    ? ''
                    : 'Set SYNC_MASTER_KEY (64 hex characters) on your self-hosted server to enable Stripe sync.';
            hintEl.hidden = data.hosted === true;
        }
        if (lastSyncEl) lastSyncEl.hidden = true;
        if (disconnectBtn) disconnectBtn.hidden = true;
        return;
    }

    // Use stripeStatusBadge and stripeRecoveryHint from stripe-status.js
    const badge = stripeStatusBadge(data);
    const hint = stripeRecoveryHint(data);

    statusEl.textContent = badge.label;
    statusEl.style.color = badge.color;

    if (hintEl) {
        if (hint) {
            hintEl.textContent = hint;
            hintEl.hidden = false;
        } else {
            hintEl.hidden = true;
        }
    }

    // Last sync line
    if (lastSyncEl) {
        const last = data.lastSyncOutcome;
        const lastSyncedAt = data.lastSyncedAt;
        if (last && last.at) {
            lastSyncEl.textContent = `Last sync: ${new Date(last.at).toLocaleString()}`;
            lastSyncEl.hidden = false;
        } else if (lastSyncedAt) {
            lastSyncEl.textContent = `Last sync: ${new Date(lastSyncedAt).toLocaleString()}`;
            lastSyncEl.hidden = false;
        } else {
            lastSyncEl.textContent = 'Never synced';
            lastSyncEl.hidden = false;
        }
    }

    // Disconnect button only when connected
    if (disconnectBtn) {
        disconnectBtn.hidden = data.connected !== true;
    }
}

async function loadStripeCard() {
    const statusEl = document.getElementById('stripe-status');
    if (!statusEl) return;

    const myLoadId = ++loadCounter;

    try {
        let hosted = null;
        try {
            hosted = globalThis.FireDeployMode
                ? await globalThis.FireDeployMode.whenKnown()
                : null;
        } catch {
            /* unknown deployment mode: retain the self-hosted status check */
        }
        if (hosted === true) {
            if (myLoadId !== loadCounter) return;
            lastStripeData = { configured: false, hosted: true };
            renderStripeCard(lastStripeData);
            return;
        }

        const res = await fetch('/api/sync/stripe/status', {
            cache: 'no-store',
        });
        const data = await res.json().catch(() => null);

        // A 404 means this deployment has no Stripe routes (hosted, not
        // self-hosted): that is the deployment limitation, not a load failure.
        if (res.status === 404) {
            if (myLoadId !== loadCounter) return;
            lastStripeData = { configured: false };
            renderStripeCard(lastStripeData);
            return;
        }

        if (!res.ok || !data || typeof data !== 'object') {
            throw new Error('Invalid response');
        }

        // Ignore stale responses (another load or disconnect started)
        if (myLoadId !== loadCounter) {
            return;
        }

        lastStripeData = data;
        renderStripeCard(data);
    } catch (err) {
        // Ignore stale errors
        if (myLoadId !== loadCounter) {
            return;
        }
        // Network error, non-OK HTTP, or invalid JSON
        const hintEl = document.getElementById('stripe-hint');
        const lastSyncEl = document.getElementById('stripe-last-sync');
        const disconnectBtn = document.getElementById('btn-stripe-disconnect');

        statusEl.textContent = 'Unable to load Stripe status';
        statusEl.style.color = 'var(--color-danger)';

        if (hintEl) {
            hintEl.textContent =
                'Check the server is running, then reopen Settings to retry.';
            hintEl.hidden = false;
        }
        if (lastSyncEl) lastSyncEl.hidden = true;
        if (disconnectBtn) disconnectBtn.hidden = true;
    }
}

async function disconnectStripe() {
    const statusEl = document.getElementById('stripe-status');
    const hintEl = document.getElementById('stripe-hint');
    if (!statusEl) return;

    if (
        !confirm(
            'Delete the stored Stripe key from this server? Synced transactions stay.',
        )
    ) {
        return;
    }

    // Invalidate any status load already in flight so it cannot repaint "Connected".
    loadCounter++;

    try {
        const res = await fetch('/api/sync/stripe/disconnect', {
            method: 'DELETE',
        });
        const data = await res.json().catch(() => null);

        if (!res.ok || !data) {
            throw new Error(data?.error || `HTTP ${res.status}`);
        }

        lastStripeData = data;
        renderStripeCard(data);
    } catch (err) {
        // Keep previous state (status, last-sync, button) exactly as they were
        // Show error only in the hint element
        if (hintEl) {
            hintEl.textContent = 'Disconnect failed: ' + err.message;
            hintEl.hidden = false;
        }
    }
}

// Load on DOMContentLoaded and whenever Settings tab is opened
document.addEventListener('DOMContentLoaded', loadStripeCard);

const settingsTabBtn = document.getElementById('btn-tab-settings');
if (settingsTabBtn) {
    settingsTabBtn.addEventListener('click', loadStripeCard);
}

// Delegated click handler for disconnect button
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-stripe-action="disconnect"]');
    if (btn) {
        await disconnectStripe();
    }
});
