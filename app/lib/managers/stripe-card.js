/* ==========================================================================
   managers/stripe-card.js — Stripe connection card (Settings)
   Loaded via index.html alongside stripe-status.js.
   Self-hosted only: GET /api/sync/stripe/status, DELETE /api/sync/stripe/disconnect
   ========================================================================== */

async function loadStripeCard() {
    const statusEl = document.getElementById('stripe-status');
    const hintEl = document.getElementById('stripe-hint');
    const lastSyncEl = document.getElementById('stripe-last-sync');
    const disconnectBtn = document.getElementById('btn-stripe-disconnect');
    if (!statusEl) return;

    try {
        const res = await fetch('/api/sync/stripe/status', {
            cache: 'no-store',
        });
        const data = await res.json().catch(() => null);

        if (!res.ok || !data || typeof data !== 'object') {
            throw new Error('Invalid response');
        }

        // Not configured on this deployment (hosted Netlify, etc.)
        if (data.configured === false) {
            statusEl.textContent =
                'Stripe sync is available on self-hosted deployments only';
            statusEl.style.color = 'var(--color-warning, var(--color-danger))';
            if (hintEl) {
                hintEl.textContent =
                    'Set STRIPE_SECRET_KEY in the Netlify environment to enable Stripe sync.';
                hintEl.hidden = false;
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
    } catch (err) {
        statusEl.textContent =
            'Stripe sync is available on self-hosted deployments only';
        statusEl.style.color = 'var(--color-warning, var(--color-danger))';
        if (hintEl) {
            hintEl.textContent =
                'Set STRIPE_SECRET_KEY in the Netlify environment to enable Stripe sync.';
            hintEl.hidden = false;
        }
        if (lastSyncEl) lastSyncEl.hidden = true;
        if (disconnectBtn) disconnectBtn.hidden = true;
    }
}

async function disconnectStripe() {
    const statusEl = document.getElementById('stripe-status');
    const hintEl = document.getElementById('stripe-hint');
    const lastSyncEl = document.getElementById('stripe-last-sync');
    const disconnectBtn = document.getElementById('btn-stripe-disconnect');
    if (!statusEl) return;

    if (
        !confirm(
            'Delete the stored Stripe key from this server? Synced transactions stay.',
        )
    ) {
        return;
    }

    try {
        const res = await fetch('/api/sync/stripe/disconnect', {
            method: 'DELETE',
        });
        const data = await res.json().catch(() => null);

        if (!res.ok || !data) {
            throw new Error(data?.error || `HTTP ${res.status}`);
        }

        // Re-render from returned JSON (same logic as loadStripeCard)
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

        if (disconnectBtn) {
            disconnectBtn.hidden = data.connected !== true;
        }
    } catch (err) {
        statusEl.textContent = 'Disconnect failed: ' + err.message;
        statusEl.style.color = 'var(--color-danger)';
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
