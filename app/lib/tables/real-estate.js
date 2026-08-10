/* ==========================================================================
   tables/real-estate.js — Real estate table and stats renderers
   ========================================================================== */

function _reEscHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderRealEstateTable() {
    const tbody = document.querySelector('#table-real-estate tbody');
    if (!tbody) return;
    const list = state.realEstate || [];

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No properties added yet. Use the form to add your first property.</td></tr>`;
        renderRealEstateStats();
        return;
    }

    let html = '';
    list.forEach((re) => {
        const equity = (re.marketValue || 0) - (re.mortgageBalance || 0);
        const gain = (re.marketValue || 0) - (re.purchasePrice || 0);
        const gainStyle =
            gain >= 0
                ? 'color:var(--color-success)'
                : 'color:var(--color-danger)';
        const gainStr =
            gain >= 0
                ? `+${formatCurrency(gain)}`
                : `-${formatCurrency(Math.abs(gain))}`;

        if (editingRealEstate.includes(re.id)) {
            html += `
            <tr class="position-row">
                <td><input class="inline-edit-input" id="re-edit-name-${re.id}" value="${escHtml(re.name)}" placeholder="Property Name"></td>
                <td>
                    <select class="inline-edit-input" id="re-edit-type-${re.id}">
                        ${['Primary Home', 'Investment', 'Rental', 'Land', 'Commercial'].map((t) => `<option${t === re.type ? ' selected' : ''}>${t}</option>`).join('')}
                    </select>
                </td>
                <td><input class="inline-edit-input" id="re-edit-address-${re.id}" value="${escHtml(re.address || '')}" placeholder="Address (optional)"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="re-edit-market-${re.id}" type="number" value="${re.marketValue}" step="1000"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="re-edit-mortgage-${re.id}" type="number" value="${re.mortgageBalance}" step="1000"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="re-edit-purchase-${re.id}" type="number" value="${re.purchasePrice}" step="1000"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="re-edit-payment-${re.id}" type="number" value="${re.monthlyPayment}" step="100"></td>
                <td class="text-right">
                    <button class="action-btn save-btn" onclick="saveEditRealEstate('${re.id}')">Save</button>
                    <button class="action-btn cancel-btn" onclick="cancelEditRealEstate('${re.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            html += `
            <tr class="position-row">
                <td class="font-bold">${_reEscHtml(re.name)}</td>
                <td><span class="tag-badge">${_reEscHtml(re.type)}</span></td>
                <td class="text-muted" style="font-size:11px;">${_reEscHtml(re.address) || '—'}</td>
                <td class="text-right font-bold">${formatCurrency(re.marketValue || 0)}</td>
                <td class="text-right" style="${equity >= 0 ? 'color:var(--color-success)' : 'color:var(--color-danger)'};">${formatCurrency(equity)}</td>
                <td class="text-right text-muted">${(re.purchasePrice || 0) > 0 ? formatCurrency(re.purchasePrice) : '—'}</td>
                <td class="text-right" style="${gainStyle}">${(re.purchasePrice || 0) > 0 ? gainStr : '—'}</td>
                <td class="text-right">
                    <button class="action-btn edit-btn" onclick="startEditRealEstate('${re.id}')">Edit</button>
                    <button class="action-btn delete-btn" onclick="deleteRealEstate('${re.id}')">Delete</button>
                </td>
            </tr>`;
        }
    });
    tbody.innerHTML = html;
    renderRealEstateStats();
}

function renderRealEstateStats() {
    const list = state.realEstate || [];
    const totalValue = list.reduce((s, re) => s + (re.marketValue || 0), 0);
    const totalMortgage = list.reduce(
        (s, re) => s + (re.mortgageBalance || 0),
        0,
    );
    const totalEquity = totalValue - totalMortgage;
    const totalGain = list.reduce(
        (s, re) => s + ((re.marketValue || 0) - (re.purchasePrice || 0)),
        0,
    );

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('re-stat-value', formatCurrency(totalValue));
    set('re-stat-equity', formatCurrency(totalEquity));
    set('re-stat-mortgage', formatCurrency(totalMortgage));
    set(
        're-stat-gain',
        (totalGain >= 0 ? '+' : '') + formatCurrency(totalGain),
    );
    const gainEl = document.getElementById('re-stat-gain');
    if (gainEl)
        gainEl.style.color =
            totalGain >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
}
