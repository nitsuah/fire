/* ==========================================================================
   tables/vehicles.js — Vehicle table and stats renderers
   ========================================================================== */

function renderVehiclesTable() {
    const tbody = document.querySelector('#table-vehicles tbody');
    if (!tbody) return;
    const list = state.vehicles || [];

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No vehicles added yet. Use the form to add your first vehicle.</td></tr>`;
        renderVehicleStats();
        return;
    }

    let html = '';
    list.forEach((v) => {
        const equity = (v.currentValue || 0) - (v.loanBalance || 0);
        const dep = (v.purchasePrice || 0) - (v.currentValue || 0);
        const depStyle =
            dep <= 0
                ? 'color:var(--color-success)'
                : 'color:var(--color-danger)';
        const depStr =
            dep <= 0
                ? `+${formatCurrency(Math.abs(dep))}`
                : `-${formatCurrency(dep)}`;
        const equityStyle =
            equity >= 0
                ? 'color:var(--color-success)'
                : 'color:var(--color-danger)';
        const displayName = escHtml(`${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}`);

        if (editingVehicles.includes(v.id)) {
            html += `
            <tr class="position-row">
                <td><input class="inline-edit-input" id="veh-edit-year-${v.id}" type="number" value="${v.year}" style="width:70px;"></td>
                <td><input class="inline-edit-input" id="veh-edit-make-${v.id}" value="${escHtml(v.make || '')}"></td>
                <td><input class="inline-edit-input" id="veh-edit-model-${v.id}" value="${escHtml(v.model || '')}"></td>
                <td><input class="inline-edit-input" id="veh-edit-mileage-${v.id}" type="number" value="${v.mileage || 0}"></td>
                <td>
                    <select class="inline-edit-input" id="veh-edit-condition-${v.id}">
                        ${['Excellent', 'Good', 'Fair', 'Poor'].map((c) => `<option${c === v.condition ? ' selected' : ''}>${c}</option>`).join('')}
                    </select>
                </td>
                <td class="text-right"><input class="inline-edit-input text-right" id="veh-edit-value-${v.id}" type="number" value="${v.currentValue || 0}" step="500"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="veh-edit-loan-${v.id}" type="number" value="${v.loanBalance || 0}" step="500"></td>
                <td class="text-right"><input class="inline-edit-input text-right" id="veh-edit-purchase-${v.id}" type="number" value="${v.purchasePrice || 0}" step="500"></td>
                <td class="text-right">
                    <button class="action-btn save-btn" onclick="saveEditVehicle('${v.id}')">Save</button>
                    <button class="action-btn cancel-btn" onclick="cancelEditVehicle('${v.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            html += `
            <tr class="position-row">
                <td class="font-bold">${displayName}</td>
                <td><span class="tag-badge">${escHtml(v.condition)}</span></td>
                <td class="text-right text-muted">${(v.mileage || 0).toLocaleString()} mi</td>
                <td class="text-right font-bold">${formatCurrency(v.currentValue || 0)}</td>
                <td class="text-right" style="${equityStyle}">${formatCurrency(equity)}</td>
                <td class="text-right text-muted">${(v.loanBalance || 0) > 0 ? formatCurrency(v.loanBalance) : 'Paid Off'}</td>
                <td class="text-right text-muted">${(v.purchasePrice || 0) > 0 ? formatCurrency(v.purchasePrice) : '—'}</td>
                <td class="text-right" style="${depStyle}">${(v.purchasePrice || 0) > 0 ? depStr : '—'}</td>
                <td class="text-right">
                    <button class="action-btn edit-btn" onclick="startEditVehicle('${v.id}')">Edit</button>
                    <button class="action-btn delete-btn" onclick="deleteVehicle('${v.id}')">Delete</button>
                </td>
            </tr>`;
        }
    });
    tbody.innerHTML = html;
    renderVehicleStats();
}

function renderVehicleStats() {
    const list = state.vehicles || [];
    const totalValue = list.reduce((s, v) => s + (v.currentValue || 0), 0);
    const totalLoan = list.reduce((s, v) => s + (v.loanBalance || 0), 0);
    const totalEquity = totalValue - totalLoan;
    const totalDep = list.reduce(
        (s, v) => s + ((v.purchasePrice || 0) - (v.currentValue || 0)),
        0,
    );

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('veh-stat-value', formatCurrency(totalValue));
    set('veh-stat-equity', formatCurrency(totalEquity));
    set('veh-stat-loan', formatCurrency(totalLoan));
    set(
        'veh-stat-dep',
        (totalDep > 0 ? '-' : '+') + formatCurrency(Math.abs(totalDep)),
    );
    const depEl = document.getElementById('veh-stat-dep');
    if (depEl)
        depEl.style.color =
            totalDep > 0 ? 'var(--color-danger)' : 'var(--color-success)';
}
