/* ==========================================================================
   tables/vehicles.js — Vehicle table and stats renderers
   ========================================================================== */

function renderVehiclesTable() {
    const tbody = document.querySelector('#table-vehicles tbody');
    if (!tbody) return;
    const list = state.vehicles || [];

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">No vehicles added yet. Use the form to add your first vehicle.</td></tr>`;
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
        const displayName = escHtml(
            `${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}`,
        );
        const canEstimate = v.purchasePrice > 0 || v.vin;

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
                <td>—</td>
                <td class="text-right">
                    <button class="action-btn save-btn" onclick="saveEditVehicle('${v.id}')">Save</button>
                    <button class="action-btn cancel-btn" onclick="cancelEditVehicle('${v.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            const lastRefreshed = v.valueLastRefreshed
                ? new Date(v.valueLastRefreshed).toLocaleDateString()
                : null;
            const estimateLabel = lastRefreshed
                ? `Est. (${lastRefreshed})`
                : 'Estimate';
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
                    ${canEstimate ? `<button class="action-btn" id="veh-est-btn-${v.id}" onclick="fetchVehicleEstimate('${v.id}')">${escHtml(estimateLabel)}</button>` : '<span class="text-muted" title="Add purchase price or VIN to enable estimates">—</span>'}
                    <div id="veh-est-tooltip-${v.id}" class="veh-estimate-tooltip" style="display:none;"></div>
                </td>
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

window.fetchVehicleEstimate = async function (id) {
    const btn = document.getElementById(`veh-est-btn-${id}`);
    const tooltip = document.getElementById(`veh-est-tooltip-${id}`);
    if (!btn || !tooltip) return;

    btn.disabled = true;
    btn.textContent = 'Loading…';
    tooltip.style.display = 'none';

    try {
        const res = await fetch(
            `/api/vehicles/${encodeURIComponent(id)}/estimate`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Estimate failed');

        const rows = [];

        if (data.depreciation) {
            const d = data.depreciation;
            rows.push(`
                <div class="veh-est-row">
                    <div class="veh-est-label">
                        📉 Depreciation model
                        <span class="veh-est-badge">free</span>
                    </div>
                    <div class="veh-est-value">${formatCurrency(d.value)}</div>
                    <div class="veh-est-range">range ${formatCurrency(d.low)} – ${formatCurrency(d.high)}</div>
                    <div class="veh-est-note">${escHtml(d.note)}</div>
                    <div class="veh-est-cite">Source: ${escHtml(d.citation)}</div>
                    <button class="action-btn save-btn veh-est-accept" onclick="acceptVehicleEstimate('${id}', ${d.value}, 'depreciation-model')">Accept ${formatCurrency(d.value)}</button>
                </div>`);
        }

        if (data.market) {
            const m = data.market;
            if (m.estimated) {
                rows.push(`
                <div class="veh-est-row">
                    <div class="veh-est-label">
                        🔍 Market data (${escHtml(m.source)})
                        <span class="veh-est-badge">live</span>
                    </div>
                    <div class="veh-est-value">${formatCurrency(m.value)}</div>
                    ${m.low != null ? `<div class="veh-est-range">range ${formatCurrency(m.low)} – ${formatCurrency(m.high)}</div>` : ''}
                    <div class="veh-est-note">${escHtml(m.note)}</div>
                    <div class="veh-est-cite">Source: ${escHtml(m.citation)}</div>
                    <button class="action-btn save-btn veh-est-accept" onclick="acceptVehicleEstimate('${id}', ${m.value}, '${escHtml(m.source)}')">Accept ${formatCurrency(m.value)}</button>
                </div>`);
            } else if (m.error) {
                rows.push(
                    `<div class="veh-est-row veh-est-error">Market lookup unavailable: ${escHtml(m.error)}</div>`,
                );
            }
        }

        if (data.suggestedValue && data.range) {
            rows.push(`
                <div class="veh-est-suggested">
                    Suggested: <strong>${formatCurrency(data.suggestedValue)}</strong>
                    &nbsp;(range ${formatCurrency(data.range.low)} – ${formatCurrency(data.range.high)})
                    <button class="action-btn save-btn veh-est-accept" style="margin-left:8px;" onclick="acceptVehicleEstimate('${id}', ${data.suggestedValue}, 'estimate')">Accept</button>
                </div>`);
        }

        tooltip.innerHTML = `<div class="veh-est-header">Value Estimates</div>${rows.join('')}<button class="action-btn cancel-btn veh-est-close" onclick="closeVehicleEstimate('${id}')">Close</button>`;
        tooltip.style.display = 'block';
        btn.textContent = 'Est. shown ▲';
        btn.disabled = false;
    } catch (err) {
        btn.textContent = 'Estimate';
        btn.disabled = false;
        tooltip.innerHTML = `<div class="veh-est-error">${escHtml(err.message)}</div><button class="action-btn cancel-btn veh-est-close" onclick="closeVehicleEstimate('${id}')">Close</button>`;
        tooltip.style.display = 'block';
    }
};

window.acceptVehicleEstimate = async function (id, value, source) {
    try {
        const res = await fetch(
            `/api/vehicles/${encodeURIComponent(id)}/accept-estimate`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value, source }),
            },
        );
        if (!res.ok) {
            const d = await res.json();
            alert(d.error || 'Failed to update value');
            return;
        }
        const updated = await res.json();
        const idx = state.vehicles.findIndex((v) => v.id === id);
        if (idx !== -1)
            state.vehicles[idx] = { ...state.vehicles[idx], ...updated };
        refreshAllUI();
    } catch (err) {
        alert(err.message);
    }
};

window.closeVehicleEstimate = function (id) {
    const tooltip = document.getElementById(`veh-est-tooltip-${id}`);
    const btn = document.getElementById(`veh-est-btn-${id}`);
    if (tooltip) tooltip.style.display = 'none';
    if (btn) btn.textContent = 'Estimate';
};
