/* ==========================================================================
   tables/side-gig-table.js — Side gig ledger table renderer
   ========================================================================== */

function renderSideGigLedgerTable() {
    const tbody = document.querySelector('#table-sidegig-history tbody');
    if (!tbody) return;

    if (state.sideGigLedger.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No manual side hustle income logged yet. Use the eBay calculator or add below.</td></tr>`;
        return;
    }

    let html = '';
    state.sideGigLedger.forEach((sg) => {
        html += `
            <tr>
                <td class="font-bold">${sg.desc}</td>
                <td><span class="text-muted">${sg.category}</span></td>
                <td class="text-right text-white">${formatCurrency(sg.revenue)}</td>
                <td class="text-right text-coral">${formatCurrency(sg.expenses)}</td>
                <td class="text-right font-bold text-emerald">${formatCurrency(sg.net)}</td>
                <td class="text-right">
                    <button class="delete-btn" onclick="deleteSideGigEntry('${sg.id}')">Delete</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}
