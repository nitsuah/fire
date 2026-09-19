/* ==========================================================================
   tables/positions.js — Investment positions table renderer
   ========================================================================== */

// Positions whose hidden-at-narrow-width details are expanded (keyed
// "account|symbol"); kept outside the render so re-renders preserve it.
const expandedPositions = new Set();

document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.pos-expand-btn');
    if (!btn) return;
    e.stopPropagation();
    const key = btn.dataset.key;
    const open = !expandedPositions.has(key);
    if (open) expandedPositions.add(key);
    else expandedPositions.delete(key);
    btn.textContent = open ? '−' : '+';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    const detail = btn.closest('tr')?.nextElementSibling;
    if (detail?.classList.contains('position-detail-row')) {
        detail.hidden = !open;
    }
});

// Below 768px the description/qty/price/cost columns are display:none, so a
// colspan sized for all eight columns would make the table create phantom
// columns and scroll sideways. Span only the visible ones.
const narrowPositionsMq = window.matchMedia('(max-width: 768px)');
narrowPositionsMq.addEventListener('change', () => {
    if (typeof renderDashboardTopPositionsTable === 'function')
        renderDashboardTopPositionsTable();
});

function renderDashboardTopPositionsTable() {
    const totalCols = narrowPositionsMq.matches ? 4 : 8;
    const groupSpan = narrowPositionsMq.matches ? 1 : 4;
    const tbody = document.querySelector('#table-dashboard-positions tbody');
    if (!tbody) return;

    if (state.importedPositions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${totalCols}" class="text-center text-muted">No investments imported yet. Upload a Fidelity CSV statement in the Accounts tab.</td></tr>`;
        updateSortHeaders();
        updateCollapseAllButtonLabel();
        renderDiversificationSuggestions(0);
        return;
    }

    const maxAbsPct = state.importedPositions.reduce(
        (m, p) => Math.max(m, Math.abs(p.pnlPercent || 0)),
        0,
    );
    const totalPortfolioValue = state.importedPositions.reduce(
        (s, p) => s + (p.value || 0),
        0,
    );

    const grouped = {};
    state.importedPositions.forEach((pos) => {
        const acc = pos.account || 'Brokerage';
        if (!grouped[acc]) grouped[acc] = [];
        grouped[acc].push(pos);
    });

    let html = '';
    Object.keys(grouped).forEach((accName) => {
        const positions = sortPositions(grouped[accName]);
        const accTotalVal = positions.reduce(
            (sum, p) => sum + (p.value || 0),
            0,
        );
        const nonCash = positions.filter((p) => !isSettledCash(p));
        const accCostBasis = nonCash.reduce(
            (sum, p) => sum + (p.costBasis || 0),
            0,
        );
        const accPnL =
            accCostBasis > 0
                ? nonCash.reduce((sum, p) => sum + (p.value || 0), 0) -
                  accCostBasis
                : nonCash.reduce((sum, p) => sum + (p.pnlDollar || 0), 0);
        const accPnLPct = accCostBasis > 0 ? (accPnL / accCostBasis) * 100 : 0;
        const accStyle = pnlColorStyle(
            accPnLPct,
            maxAbsPct || Math.abs(accPnLPct),
        );
        const accPnLStr =
            accPnL >= 0
                ? `+${formatCurrency(accPnL)} (+${Math.abs(accPnLPct).toFixed(2)}%)`
                : `-${formatCurrency(Math.abs(accPnL))} (${accPnLPct.toFixed(2)}%)`;

        const isCollapsed = !!collapsedAccounts[accName];
        const chevronClass = isCollapsed
            ? 'chevron-icon collapsed'
            : 'chevron-icon';

        // Roll up per-position risk warnings onto the group header so they're
        // still visible when the account is collapsed — expand to see which
        // individual positions triggered them.
        let rollupBadge = '';
        if (isCollapsed) {
            let highCount = 0,
                medCount = 0;
            positions.forEach((p) => {
                if (isSettledCash(p)) return;
                const w =
                    totalPortfolioValue > 0
                        ? ((p.value || 0) / totalPortfolioValue) * 100
                        : 0;
                if (w >= 20) highCount++;
                else if (w >= 15) medCount++;
            });
            if (highCount > 0)
                rollupBadge += `<span class="acct-warn-badge acct-warn-high" title="${highCount} position(s) ≥20% of portfolio">⚠ ${highCount}</span>`;
            if (medCount > 0)
                rollupBadge += `<span class="acct-warn-badge acct-warn-med" title="${medCount} position(s) ≥15% of portfolio">⚡ ${medCount}</span>`;
        }

        html += `
            <tr class="table-group-header" data-acc-name="${escHtml(accName)}" onclick="toggleAccountGroup(this.dataset.accName)">
                <td colspan="${groupSpan}"><span class="${chevronClass}">▼</span> <strong>${escHtml(accName)}</strong>${rollupBadge}</td>
                <td class="text-right font-bold text-muted pos-col-cost">${accCostBasis > 0 ? formatCurrency(accCostBasis) : '—'}</td>
                <td class="text-right font-bold" style="${accStyle}">${formatCurrency(accTotalVal)}</td>
                <td class="text-right font-bold" style="${accStyle}">${accPnLStr}</td>
                <td class="pos-expand-cell"></td>
            </tr>
        `;

        if (!isCollapsed) {
            positions.forEach((pos) => {
                const pnlVal = pos.pnlDollar || 0;
                const pnlPct = pos.pnlPercent || 0;
                const posStyle = pnlColorStyle(pnlPct, maxAbsPct);
                const settled = isSettledCash(pos);

                let pnlText = '—';
                if (!settled && Math.abs(pnlVal) > 0.01) {
                    pnlText =
                        pnlVal > 0
                            ? `+${formatCurrency(pnlVal)} (+${Math.abs(pnlPct).toFixed(2)}%)`
                            : `-${formatCurrency(Math.abs(pnlVal))} (${pnlPct.toFixed(2)}%)`;
                }

                const weight =
                    totalPortfolioValue > 0
                        ? ((pos.value || 0) / totalPortfolioValue) * 100
                        : 0;
                let riskBadge = '';
                if (!settled && weight >= 20)
                    riskBadge = `<span class="risk-badge risk-high" title="${weight.toFixed(1)}% of portfolio">⚠</span>`;
                else if (!settled && weight >= 15)
                    riskBadge = `<span class="risk-badge risk-med" title="${weight.toFixed(1)}% of portfolio">⚡</span>`;

                const MKTBENCH = 10;
                let mktBadge = '';
                if (!settled && Math.abs(pnlPct) > 0.01) {
                    mktBadge =
                        pnlPct >= MKTBENCH
                            ? `<span class="mkt-badge mkt-up" title="${(pnlPct - MKTBENCH).toFixed(1)}% above ~10% market avg">▲ mkt</span>`
                            : `<span class="mkt-badge mkt-dn" title="${(pnlPct - MKTBENCH).toFixed(1)}% below ~10% market avg">▼ mkt</span>`;
                }

                const sym = pos.symbol || '';
                const posKey = `${accName}|${sym}`;
                const isOpen = expandedPositions.has(posKey);
                const qtyStr = (pos.quantity || 0).toLocaleString(undefined, {
                    maximumFractionDigits: 3,
                });
                const costStr =
                    (pos.costBasis || 0) > 0
                        ? formatCurrency(pos.costBasis)
                        : '—';
                html += `
                    <tr class="position-row" data-account="${escHtml(accName)}" data-symbol="${escHtml(sym)}">
                        <td class="font-bold text-purple">${escHtml(sym)} ${riskBadge}</td>
                        <td class="pos-col-desc" style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(pos.description || '')}</td>
                        <td class="text-right pos-col-qty">${qtyStr}</td>
                        <td class="text-right pos-col-price">${formatCurrency(pos.lastPrice || 0)}</td>
                        <td class="text-right text-muted pos-col-cost">${costStr}</td>
                        <td class="text-right font-bold" style="${posStyle}">${formatCurrency(pos.value || 0)}</td>
                        <td class="text-right font-bold" style="${posStyle}">${pnlText} ${mktBadge}</td>
                        <td class="pos-expand-cell"><button type="button" class="pos-expand-btn" data-key="${escHtml(posKey)}" aria-expanded="${isOpen}" aria-label="Show details for ${escHtml(sym)}">${isOpen ? '−' : '+'}</button></td>
                    </tr>
                    <tr class="position-detail-row" ${isOpen ? '' : 'hidden'}>
                        <td colspan="${totalCols}">
                            <dl class="pos-detail-list">
                                <div><dt>Description</dt><dd>${escHtml(pos.description || '—')}</dd></div>
                                <div><dt>Quantity</dt><dd>${qtyStr}</dd></div>
                                <div><dt>Last Price</dt><dd>${formatCurrency(pos.lastPrice || 0)}</dd></div>
                                <div><dt>Cost Basis</dt><dd>${costStr}</dd></div>
                            </dl>
                        </td>
                    </tr>
                `;
            });
        }
    });
    tbody.innerHTML = html;
    updateSortHeaders();
    updateCollapseAllButtonLabel();
    renderDiversificationSuggestions(totalPortfolioValue);
}

function updateSortHeaders() {
    const cols = ['symbol', 'desc', 'qty', 'price', 'cost', 'value', 'pnl'];
    cols.forEach((col) => {
        const th = document.querySelector(
            `#table-dashboard-positions thead th[data-sort="${col}"]`,
        );
        if (!th) return;
        th.classList.remove('sort-asc', 'sort-desc');
        if (col === tableSortColumn) th.classList.add(`sort-${tableSortDir}`);
    });
}
