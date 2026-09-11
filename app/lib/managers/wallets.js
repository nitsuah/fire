/* ==========================================================================
   managers/wallets.js — Crypto wallet manager (add / remove / refresh)
   Backed by /api/wallets/*. The server never returns a full address (only
   the last 8 characters), so nothing here handles a raw address once it's
   been submitted.

   Action buttons use delegated addEventListener + data-* attributes rather
   than inline onclick="...('${label}')" strings — a wallet label is
   arbitrary user text, and an inline handler built from it is an XSS vector
   even when HTML-entity-escaped (the browser decodes the attribute before
   evaluating it as JS). Only the server-issued hex wallet id travels through
   data-wallet-id.
   ========================================================================== */

const WALLET_CHAIN_LABELS = {
    ethereum: 'Ethereum',
    bnb: 'BNB Smart Chain',
    polygon: 'Polygon',
    arbitrum: 'Arbitrum One',
    base: 'Base',
    avalanche: 'Avalanche',
    bitcoin: 'Bitcoin',
    solana: 'Solana',
};

let _walletCache = [];

function initWalletManager() {
    const form = document.getElementById('form-add-wallet');
    const listEl = document.getElementById('wallet-manager-list');
    if (!form || !listEl) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const addressInput = document.getElementById('wallet-address-input');
        const chainInput = document.getElementById('wallet-chain-select');
        const labelInput = document.getElementById('wallet-label-input');
        const errEl = document.getElementById('wallet-manager-error');
        if (errEl) errEl.style.display = 'none';

        const address = addressInput.value.trim();
        const chain = chainInput.value;
        const label = labelInput.value.trim();
        if (!address || !chain || !label) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        try {
            const res = await fetch('/api/wallets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, chain, label }),
            });
            const data = await res.json();
            if (!res.ok) {
                if (errEl) {
                    errEl.textContent = data.error || 'Failed to add wallet.';
                    errEl.style.display = 'block';
                }
                return;
            }
            form.reset();
            await loadWallets();
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message;
                errEl.style.display = 'block';
            }
        } finally {
            submitBtn.disabled = false;
        }
    });

    listEl.addEventListener('click', (e) => {
        const refreshBtn = e.target.closest('[data-action="refresh-wallet"]');
        if (refreshBtn) {
            refreshWallet(refreshBtn.dataset.walletId, refreshBtn);
            return;
        }
        const removeBtn = e.target.closest('[data-action="remove-wallet"]');
        if (removeBtn) {
            removeWallet(removeBtn.dataset.walletId);
        }
    });

    loadWallets();
}

async function loadWallets() {
    const listEl = document.getElementById('wallet-manager-list');
    if (!listEl) return;
    try {
        const res = await fetch('/api/wallets');
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to load wallets.');
        }
        _walletCache = Array.isArray(data.wallets) ? data.wallets : [];
        renderWalletList();
    } catch (err) {
        listEl.innerHTML = `<p class="text-muted" style="font-size:12px;">Unable to load wallets: ${escHtml(err.message)}</p>`;
    }
}

function renderWalletList() {
    const listEl = document.getElementById('wallet-manager-list');
    const totalRow = document.getElementById('wallet-total-row');
    const totalEl = document.getElementById('wallet-total-value');
    if (!listEl) return;

    if (_walletCache.length === 0) {
        listEl.innerHTML =
            '<p class="text-muted" style="font-size:12px;">No wallets tracked yet. Add one above.</p>';
        if (totalRow) totalRow.style.display = 'none';
        return;
    }

    listEl.innerHTML = _walletCache
        .map((w) => {
            const chainLabel = WALLET_CHAIN_LABELS[w.chain] || w.chain;
            const lastFetched = w.lastFetched
                ? new Date(w.lastFetched).toLocaleString()
                : 'never';
            const balanceText =
                w.lastUsdValue != null ? formatCurrency(w.lastUsdValue) : '—';
            const warning = w.warning
                ? `<span class="wallet-warning-badge" title="${escHtml(w.warning)}">⚠ ${escHtml(w.warning)}</span>`
                : '';
            return `
            <div class="chain-balance-row wallet-row">
                <span class="chain-name">
                    <strong>${escHtml(w.label)}</strong>
                    <span class="tag-badge" style="margin-left:6px;">${escHtml(chainLabel)}</span>
                    <span class="text-muted" style="display:block;font-size:10px;">${escHtml(w.address)} · updated ${escHtml(lastFetched)}</span>
                </span>
                <span class="chain-val wallet-row-actions">
                    <span>${balanceText}</span>
                    ${warning}
                    <span class="wallet-row-btns">
                        <button type="button" class="action-btn" data-action="refresh-wallet" data-wallet-id="${escHtml(w.id)}">Refresh</button>
                        <button type="button" class="action-btn delete-btn" data-action="remove-wallet" data-wallet-id="${escHtml(w.id)}">Remove</button>
                    </span>
                </span>
            </div>`;
        })
        .join('');

    const total = _walletCache.reduce((s, w) => s + (w.lastUsdValue || 0), 0);
    if (totalRow && totalEl) {
        totalRow.style.display = 'flex';
        totalEl.textContent = formatCurrency(total);
    }
}

async function refreshWallet(id, btn) {
    if (!id) return;
    const originalText = btn ? btn.textContent : null;
    if (btn) {
        btn.disabled = true;
        btn.textContent = '…';
    }
    try {
        const res = await fetch(
            `/api/wallets/${encodeURIComponent(id)}/refresh`,
            { method: 'POST' },
        );
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Failed to refresh wallet.');
            return;
        }
        const idx = _walletCache.findIndex((w) => w.id === id);
        if (idx !== -1) _walletCache[idx] = data;
        else _walletCache.push(data);
        renderWalletList();
    } catch (err) {
        alert(err.message);
    } finally {
        if (btn && document.body.contains(btn)) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

async function removeWallet(id) {
    if (!id) return;
    if (!confirm('Remove this wallet from tracking?')) return;
    try {
        const res = await fetch(`/api/wallets/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Failed to remove wallet.');
            return;
        }
        _walletCache = _walletCache.filter((w) => w.id !== id);
        renderWalletList();
    } catch (err) {
        alert(err.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initWalletManager();
});
