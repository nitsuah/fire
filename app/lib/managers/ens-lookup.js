/* ==========================================================================
   managers/ens-lookup.js — ENS (.eth) wallet lookup widget
   Resolves a name via GET /api/wallets/ens/:name and renders the total USD
   value held across every EVM chain the server has an explorer key for.
   ========================================================================== */

function initEnsLookup() {
    const form = document.getElementById('form-ens-lookup');
    const input = document.getElementById('ens-lookup-input');
    const resultEl = document.getElementById('ens-lookup-result');
    if (!form || !input || !resultEl) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Looking up…';
        resultEl.innerHTML = '';

        try {
            const { ok, data } = await fetchJson(
                `/api/wallets/ens/${encodeURIComponent(name)}`,
            );
            if (!ok) {
                resultEl.innerHTML = `<div class="veh-est-error">${escHtml(data.error || 'Lookup failed.')}</div>`;
                return;
            }
            renderEnsLookupResult(data);
        } catch (err) {
            resultEl.innerHTML = `<div class="veh-est-error">${escHtml(err.message)}</div>`;
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Look Up';
        }
    });
}

function renderEnsLookupResult(data) {
    const resultEl = document.getElementById('ens-lookup-result');
    if (!resultEl) return;

    const chainRows = data.chains
        .map((c) => {
            if (!c.ok) {
                return `<div class="chain-balance-row">
                    <span class="chain-name">${escHtml(c.name)}</span>
                    <span class="wallet-warning-badge" title="${escHtml(c.warning || '')}">⚠ ${escHtml(c.warning || 'Unavailable')}</span>
                </div>`;
            }
            const tokens = (c.tokens || [])
                .slice(0, 5)
                .map((t) => `${t.symbol} ${formatCurrency(t.usdValue)}`)
                .join(' · ');
            return `<div class="chain-balance-row">
                <span class="chain-name">${escHtml(c.name)}${tokens ? `<span class="text-muted csp-block csp-text-10">${escHtml(tokens)}</span>` : ''}</span>
                <span class="chain-val">${(c.native || 0).toLocaleString(undefined, { maximumFractionDigits: 5 })} ${escHtml(c.nativeSymbol)} · ${formatCurrency(c.usdValue || 0)}</span>
            </div>`;
        })
        .join('');

    resultEl.innerHTML = `
        <div class="ens-lookup-total">
            <span>${escHtml(data.name)} <span class="text-muted csp-text-11">(${escHtml(data.address)})</span></span>
            <span class="val">${formatCurrency(data.totalUsdValue || 0)}${data.partial ? ' <span class="wallet-warning-badge" title="Some chains could not be read; the total is a lower bound.">⚠ partial</span>' : ''}</span>
        </div>
        ${chainRows}
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    initEnsLookup();
});
