/* ==========================================================================
   tables/positions.js — Investment positions table renderer
   ========================================================================== */

function renderDashboardTopPositionsTable() {
    const tbody = document.querySelector('#table-dashboard-positions tbody');
    if (!tbody) return;

    if (state.importedPositions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No investments imported yet. Upload a Fidelity CSV statement in the Accounts tab.</td></tr>`;
        updateSortHeaders();
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
        const accPnLStyle = pnlColorStyle(
            accPnLPct,
            maxAbsPct || Math.abs(accPnLPct),
        );
        const accValStyle = pnlColorStyle(
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
        const safeAccName = accName.replace(/'/g, "\\'");

        html += `
            <tr class="table-group-header" onclick="toggleAccountGroup('${safeAccName}')">
                <td colspan="4"><span class="${chevronClass}">▼</span> <strong>${accName}</strong></td>
                <td class="text-right font-bold text-muted">${accCostBasis > 0 ? formatCurrency(accCostBasis) : '—'}</td>
                <td class="text-right font-bold" style="${accValStyle}">${formatCurrency(accTotalVal)}</td>
                <td class="text-right font-bold" style="${accPnLStyle}">${accPnLStr}</td>
            </tr>
        `;

        if (!isCollapsed) {
            positions.forEach((pos) => {
                const pnlVal = pos.pnlDollar || 0;
                const pnlPct = pos.pnlPercent || 0;
                const pnlStyle = pnlColorStyle(pnlPct, maxAbsPct);
                const valStyle = pnlColorStyle(pnlPct, maxAbsPct);
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
                html += `
                    <tr class="position-row" data-account="${accName.replace(/"/g, '&quot;')}" data-symbol="${sym}">
                        <td class="font-bold text-purple">${sym} ${riskBadge}</td>
                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${pos.description || ''}</td>
                        <td class="text-right">${(pos.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                        <td class="text-right">${formatCurrency(pos.lastPrice || 0)}</td>
                        <td class="text-right text-muted">${(pos.costBasis || 0) > 0 ? formatCurrency(pos.costBasis) : '—'}</td>
                        <td class="text-right font-bold" style="${valStyle}">${formatCurrency(pos.value || 0)}</td>
                        <td class="text-right font-bold" style="${pnlStyle}">${pnlText} ${mktBadge}</td>
                    </tr>
                `;
            });
        }
    });
    tbody.innerHTML = html;
    updateSortHeaders();
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
