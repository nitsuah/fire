/* ==========================================================================
   tables/tax-harvest.js — Tax-Loss Harvesting Alerts
   Depends on globals: state, formatCurrency, escHtml
   ========================================================================== */

window.renderTaxHarvestTable = function () {
    const tbody = document.getElementById('tbody-tax-harvest');
    const summaryEl = document.getElementById('tax-harvest-summary');
    if (!tbody) return;

    const positions = (state.importedPositions || []).filter(
        (p) =>
            p.costBasis != null &&
            p.value != null &&
            p.value < p.costBasis &&
            p.costBasis > 0,
    );

    if (positions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No harvestable losses found in imported positions. Import a portfolio CSV to scan for opportunities.</td></tr>`;
        if (summaryEl) summaryEl.style.display = 'none';
        return;
    }

    const taxRate = (state.taxRate ?? 20) / 100;
    const now = new Date();
    const yearEnd = new Date(now.getFullYear(), 11, 31);
    const daysLeft = Math.round((yearEnd - now) / 86400000);
    const isUrgent = daysLeft <= 45;

    let totalLoss = 0;
    let html = '';

    // Sort by largest loss first
    const sorted = [...positions].sort(
        (a, b) => a.value - a.costBasis - (b.value - b.costBasis),
    );

    sorted.forEach((p) => {
        const loss = p.value - p.costBasis; // negative
        totalLoss += loss;

        const lossStr = formatCurrency(loss);
        // Show potential savings at the user's rate — actual benefit depends on
        // realized gains, holding period, and the $3k/yr ordinary-income cap.
        const potentialSavings = formatCurrency(Math.abs(loss) * taxRate);
        const urgencyClass = isUrgent ? 'text-amber' : 'text-coral';
        const alertLabel = isUrgent
            ? `⚠ ${daysLeft}d left`
            : `${daysLeft} days`;

        html += `
        <tr class="position-row">
            <td class="font-bold">${escHtml(p.symbol || '—')}</td>
            <td class="text-muted">${escHtml((p.description || '').slice(0, 40))}</td>
            <td class="text-right">${formatCurrency(p.value)}</td>
            <td class="text-right text-muted">${formatCurrency(p.costBasis)}</td>
            <td class="text-right" style="color:var(--color-danger)">${lossStr}</td>
            <td class="text-right" style="color:var(--color-success)">${potentialSavings}</td>
            <td class="${urgencyClass}" style="font-size:12px;font-weight:600;">${alertLabel}</td>
        </tr>`;
    });

    tbody.innerHTML = html;

    if (summaryEl) {
        const annualCap = Math.min(Math.abs(totalLoss), 3000);
        // Potential savings = full loss × rate. Actual savings depend on
        // realized gains, holding period (short vs long-term), and the
        // $3k/yr cap if no gains exist to offset. Consult a tax advisor.
        const potentialTotal = Math.abs(totalLoss) * taxRate;
        summaryEl.innerHTML = `
            <div class="tax-harvest-stat"><span>Total Harvestable Losses</span><strong style="color:var(--color-danger)">${formatCurrency(totalLoss)}</strong></div>
            <div class="tax-harvest-stat"><span>Potential Savings* (@ ${state.taxRate ?? 20}% rate)</span><strong style="color:var(--color-success)">${formatCurrency(potentialTotal)}</strong></div>
            <div class="tax-harvest-stat"><span>Ordinary Income Offset (max $3k/yr)</span><strong>${formatCurrency(annualCap)}</strong></div>
            <div class="tax-harvest-stat"><span>Days Until Year-End</span><strong class="${isUrgent ? 'text-amber' : ''}">${daysLeft} days${isUrgent ? ' ⚠' : ''}</strong></div>
        `;
        summaryEl.style.display = 'grid';
    }
};
