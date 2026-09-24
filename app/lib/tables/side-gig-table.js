/* ==========================================================================
   tables/side-gig-table.js — Side gig ledger table renderer
   ========================================================================== */

function sideGigBasisSelect(sg) {
    let opts = `<option value=""${sg.basisType ? '' : ' selected'}>— tag —</option>`;
    for (const [value, label] of Object.entries(SIDE_GIG_BASIS_TYPES)) {
        const sel = sg.basisType === value ? ' selected' : '';
        opts += `<option value="${value}"${sel}>${escHtml(label)}</option>`;
    }
    return `<select class="sg-basis-select" aria-label="How was this item acquired?" data-sg-id="${escHtml(String(sg.id))}" data-sg-field="basisType">${opts}</select>`;
}

function sideGigCostInput(sg) {
    const val = sg.costBasis ?? '';
    return `<input type="number" class="sg-cost-input" min="0" step="0.01" placeholder="?" aria-label="Item cost basis" value="${escHtml(String(val))}" data-sg-id="${escHtml(String(sg.id))}" data-sg-field="costBasis">`;
}

function renderSideGigTaxSummary() {
    const el = document.getElementById('sidegig-tax-summary');
    if (!el) return;
    const s = summarizeSideGigTax(state.sideGigLedger);
    const parts = [
        `Est. taxable: <strong>${formatCurrency(s.estimatedTaxableIncome)}</strong>`,
        `Business net ${formatCurrency(s.business.net)} (${s.business.count})`,
        `Personal-item gains ${formatCurrency(s.personalSales.taxableGains)}`,
        `Non-taxable personal losses ${formatCurrency(s.personalSales.nonDeductibleLosses)}`,
    ];
    if (s.needsCostBasis.count)
        parts.push(
            `<span class="text-coral">${s.needsCostBasis.count} need a cost</span>`,
        );
    if (s.untagged.count)
        parts.push(
            `<span class="text-coral">${s.untagged.count} untagged</span>`,
        );
    el.innerHTML = `${parts.join(' · ')}<br><span class="text-muted">${escHtml(s.note)}</span>`;
}

function renderSideGigLedgerTable() {
    const tbody = document.querySelector('#table-sidegig-history tbody');
    if (!tbody) return;
    renderSideGigTaxSummary();

    if (state.sideGigLedger.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No manual side hustle income logged yet. Use the eBay calculator or add below.</td></tr>`;
        return;
    }

    let html = '';
    state.sideGigLedger.forEach((sg) => {
        html += `
            <tr>
                <td class="font-bold">${escHtml(sg.desc || sg.description || '')}</td>
                <td><span class="text-muted">${escHtml(sg.category || sg.platform || '')}</span></td>
                <td>${sideGigBasisSelect(sg)}</td>
                <td class="text-right text-white">${formatCurrency(sg.revenue ?? sg.gross ?? 0)}</td>
                <td class="text-right text-coral">${formatCurrency(sg.expenses ?? sg.fees ?? 0)}</td>
                <td class="text-right">${sideGigCostInput(sg)}</td>
                <td class="text-right font-bold text-emerald">${formatCurrency(sg.net)}</td>
                <td class="text-right">
                    <button class="delete-btn" data-sg-delete="${escHtml(String(sg.id))}">Delete</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}
