/* ==========================================================================
   tables-positions.js — Investment position, account, CD, and side-gig
                          ledger table renderers
   Depends on globals in app.js and finance-core helpers.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Investment Positions Table
   -------------------------------------------------------------------------- */

function renderDashboardTopPositionsTable() {
    const tbody = document.querySelector('#table-dashboard-positions tbody');
    if (!tbody) return;

    if (state.importedPositions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No investments imported yet. Upload a Fidelity CSV statement in the Accounts tab.</td></tr>`;
        updateSortHeaders();
        renderDiversificationSuggestions(0);
        return;
    }

    const maxAbsPct = state.importedPositions.reduce((m, p) => Math.max(m, Math.abs(p.pnlPercent || 0)), 0);
    const totalPortfolioValue = state.importedPositions.reduce((s, p) => s + (p.value || 0), 0);

    const grouped = {};
    state.importedPositions.forEach(pos => {
        const acc = pos.account || 'Brokerage';
        if (!grouped[acc]) grouped[acc] = [];
        grouped[acc].push(pos);
    });

    let html = '';
    Object.keys(grouped).forEach(accName => {
        const positions = sortPositions(grouped[accName]);
        const accTotalVal = positions.reduce((sum, p) => sum + (p.value || 0), 0);
        const nonCash = positions.filter(p => !isSettledCash(p));
        const accCostBasis = nonCash.reduce((sum, p) => sum + (p.costBasis || 0), 0);
        const accPnL = accCostBasis > 0
            ? nonCash.reduce((sum, p) => sum + (p.value || 0), 0) - accCostBasis
            : nonCash.reduce((sum, p) => sum + (p.pnlDollar || 0), 0);
        const accPnLPct = accCostBasis > 0 ? (accPnL / accCostBasis) * 100 : 0;
        const accPnLStyle = pnlColorStyle(accPnLPct, maxAbsPct || Math.abs(accPnLPct));
        const accValStyle = pnlColorStyle(accPnLPct, maxAbsPct || Math.abs(accPnLPct));
        const accPnLStr = accPnL >= 0
            ? `+${formatCurrency(accPnL)} (+${Math.abs(accPnLPct).toFixed(2)}%)`
            : `-${formatCurrency(Math.abs(accPnL))} (${accPnLPct.toFixed(2)}%)`;

        const isCollapsed = !!collapsedAccounts[accName];
        const chevronClass = isCollapsed ? 'chevron-icon collapsed' : 'chevron-icon';
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
            positions.forEach(pos => {
                const pnlVal = pos.pnlDollar || 0;
                const pnlPct = pos.pnlPercent || 0;
                const pnlStyle = pnlColorStyle(pnlPct, maxAbsPct);
                const valStyle = pnlColorStyle(pnlPct, maxAbsPct);
                const settled = isSettledCash(pos);

                let pnlText = '—';
                if (!settled && Math.abs(pnlVal) > 0.01) {
                    pnlText = pnlVal > 0
                        ? `+${formatCurrency(pnlVal)} (+${Math.abs(pnlPct).toFixed(2)}%)`
                        : `-${formatCurrency(Math.abs(pnlVal))} (${pnlPct.toFixed(2)}%)`;
                }

                const weight = totalPortfolioValue > 0 ? (pos.value || 0) / totalPortfolioValue * 100 : 0;
                let riskBadge = '';
                if (!settled && weight >= 20) riskBadge = `<span class="risk-badge risk-high" title="${weight.toFixed(1)}% of portfolio">⚠</span>`;
                else if (!settled && weight >= 15) riskBadge = `<span class="risk-badge risk-med" title="${weight.toFixed(1)}% of portfolio">⚡</span>`;

                const MKTBENCH = 10;
                let mktBadge = '';
                if (!settled && Math.abs(pnlPct) > 0.01) {
                    mktBadge = pnlPct >= MKTBENCH
                        ? `<span class="mkt-badge mkt-up" title="${(pnlPct - MKTBENCH).toFixed(1)}% above ~10% market avg">▲ mkt</span>`
                        : `<span class="mkt-badge mkt-dn" title="${(pnlPct - MKTBENCH).toFixed(1)}% below ~10% market avg">▼ mkt</span>`;
                }

                const sym = pos.symbol || '';
                html += `
                    <tr class="position-row" data-account="${accName.replace(/"/g, '&quot;')}" data-symbol="${sym}">
                        <td class="font-bold text-purple">${sym} ${riskBadge}</td>
                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${pos.description || ''}</td>
                        <td class="text-right">${(pos.quantity || 0).toLocaleString(undefined, {maximumFractionDigits: 3})}</td>
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
    cols.forEach(col => {
        const th = document.querySelector(`#table-dashboard-positions thead th[data-sort="${col}"]`);
        if (!th) return;
        th.classList.remove('sort-asc', 'sort-desc');
        if (col === tableSortColumn) th.classList.add(`sort-${tableSortDir}`);
    });
}

/* --------------------------------------------------------------------------
   Cash & Fixed Income Panel
   -------------------------------------------------------------------------- */

function renderDashboardLiquidPanel() {
    const panel = document.getElementById('dashboard-liquid-panel');
    if (!panel) return;

    const today = new Date();
    let html = '';

    const cashAccounts = state.customAccounts.filter(a => a.type === 'Cash' || a.type === 'Savings');
    const mmPositions = state.importedPositions.filter(p => isSettledCash(p));

    if (cashAccounts.length > 0 || mmPositions.length > 0) {
        html += `<div class="liquid-section-label">Cash &amp; Savings</div>`;
        cashAccounts.forEach(acc => {
            const apyStr = acc.apy > 0 ? `<span class="liquid-rate">${Number(acc.apy).toFixed(2)}% APY</span>` : '';
            html += `<div class="liquid-row">
                <div class="liquid-name">${acc.name} <span class="liquid-type">${acc.type}</span></div>
                <div class="liquid-val">${formatCurrency(acc.value)} ${apyStr}</div>
            </div>`;
        });
        mmPositions.forEach(pos => {
            html += `<div class="liquid-row">
                <div class="liquid-name">${pos.symbol} <span class="liquid-type">Money Market</span></div>
                <div class="liquid-val">${formatCurrency(pos.value)}</div>
            </div>`;
        });
    }

    if (state.cds.length > 0) {
        html += `<div class="liquid-section-label mt-2">Certificates of Deposit</div>`;
        state.cds.forEach(cd => {
            if (!cd || cd.principal === undefined) return;
            const matDate = new Date(cd.maturity);
            const daysLeft = Math.ceil((matDate - today) / 86400000);
            const isMatured = daysLeft < 0;
            const isSoon = !isMatured && daysLeft <= 30;
            const annualYield = (cd.principal || 0) * ((cd.rate || 0) / 100);
            const statusColor = isMatured ? 'var(--color-danger)' : isSoon ? '#f59e0b' : 'rgba(255,255,255,0.4)';
            const statusText = isMatured
                ? `Matured ${Math.abs(daysLeft)}d ago`
                : isSoon ? `Matures in ${daysLeft}d`
                : `${daysLeft}d left`;
            html += `<div class="liquid-row">
                <div class="liquid-name">
                    ${cd.bank} <span class="liquid-type">CD · ${Number(cd.rate).toFixed(2)}%</span>
                    <span class="liquid-maturity" style="color:${statusColor};">${statusText}</span>
                </div>
                <div class="liquid-val">
                    ${formatCurrency(cd.principal)}
                    <span class="cd-yield-badge">${formatCurrency(annualYield)}<span class="cd-yield-unit">/yr</span></span>
                </div>
            </div>`;
        });
    }

    if (!html) {
        panel.innerHTML = `<p class="text-muted text-center" style="padding:12px 0;">No cash accounts or CDs recorded yet.</p>`;
        return;
    }
    panel.innerHTML = html;
}

/* --------------------------------------------------------------------------
   Imported Files Table
   -------------------------------------------------------------------------- */

function renderImportedFilesTable() {
    const tbody = document.querySelector('#table-imported-files tbody');
    if (!tbody) return;

    if (state.importedFiles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No files imported yet.</td></tr>`;
        return;
    }

    let html = '';
    state.importedFiles.forEach((file, index) => {
        html += `
            <tr>
                <td class="font-bold" title="${file.date}">${file.name}</td>
                <td><span class="text-purple">${file.source}</span></td>
                <td>${file.records}</td>
                <td class="text-right">
                    <button class="delete-btn" onclick="deleteImportedFile(${index})">Remove</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

/* --------------------------------------------------------------------------
   Custom Accounts Table
   -------------------------------------------------------------------------- */

function renderCustomAccountsTable() {
    const tbody = document.querySelector('#table-custom-accounts tbody');
    if (!tbody) return;

    if (state.customAccounts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No manual accounts entered.</td></tr>`;
        return;
    }

    let html = '';
    state.customAccounts.forEach(acc => {
        if (!acc || acc.value === undefined || acc.value === null) return;
        const isEditing = editingAccounts.includes(acc.id);

        if (isEditing) {
            html += `
                <tr>
                    <td><input type="text" class="inline-edit-input" id="edit-acc-name-${acc.id}" value="${acc.name}"></td>
                    <td><span class="text-muted">${acc.type}</span></td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 80px;" id="edit-acc-apy-${acc.id}" step="0.01" value="${Number(acc.apy).toFixed(2)}" ${(acc.type === 'Savings' || acc.type === 'Cash') ? '' : 'disabled'}>
                    </td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 120px;" id="edit-acc-val-${acc.id}" step="0.01" value="${Number(acc.value).toFixed(2)}">
                    </td>
                    <td class="text-right">
                        <button class="save-btn" onclick="saveEditAccount('${acc.id}')">Save</button>
                        <button class="cancel-btn" onclick="cancelEditAccount('${acc.id}')">Cancel</button>
                    </td>
                </tr>
            `;
        } else {
            const hasYield = acc.type === 'Savings' || acc.type === 'Cash';
            html += `
                <tr>
                    <td class="font-bold">${acc.name}</td>
                    <td><span class="text-muted">${acc.type}</span></td>
                    <td class="text-right text-amber font-bold">${hasYield ? `${Number(acc.apy).toFixed(2)}%` : '—'}</td>
                    <td class="text-right font-bold text-emerald">${formatCurrency(acc.value)}</td>
                    <td class="text-right">
                        <button class="edit-btn" onclick="startEditAccount('${acc.id}')">Edit</button>
                        <button class="delete-btn" onclick="deleteCustomAccount('${acc.id}')">Delete</button>
                    </td>
                </tr>
            `;
        }
    });
    tbody.innerHTML = html;
}

/* --------------------------------------------------------------------------
   CD Table
   -------------------------------------------------------------------------- */

function renderCDTable() {
    const tbody = document.querySelector('#table-cd-list tbody');
    if (!tbody) return;

    let totalCDPrincipal = 0;
    let totalAnnualFixedYield = 0;
    let totalFixedAssets = 0;

    state.cds.forEach(cd => {
        if (!cd || cd.principal === undefined) return;
        totalCDPrincipal += cd.principal || 0;
        totalAnnualFixedYield += (cd.principal || 0) * ((cd.rate || 0) / 100);
    });
    totalFixedAssets += totalCDPrincipal;

    state.customAccounts.forEach(acc => {
        if ((acc.type === 'Savings' || acc.type === 'Cash') && acc.apy > 0) {
            totalAnnualFixedYield += (acc.value || 0) * ((acc.apy || 0) / 100);
            totalFixedAssets += acc.value || 0;
        }
    });

    const weightedApy = totalFixedAssets > 0 ? (totalAnnualFixedYield / totalFixedAssets) * 100 : 0;
    document.getElementById('cd-total-principal').textContent = formatCurrency(totalCDPrincipal);
    document.getElementById('cd-total-interest').textContent = `${formatCurrency(totalAnnualFixedYield)} (Annual)`;
    document.getElementById('cd-weighted-apy').textContent = `${weightedApy.toFixed(2)}%`;

    if (state.cds.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No CDs logged. Enter your CD details in the form.</td></tr>`;
        return;
    }

    let html = '';
    state.cds.forEach(cd => {
        if (!cd || cd.principal === undefined) return;
        const isEditing = editingCDs.includes(cd.id);

        if (isEditing) {
            html += `
                <tr>
                    <td><input type="text" class="inline-edit-input" id="edit-cd-bank-${cd.id}" value="${cd.bank}"></td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 100px;" id="edit-cd-principal-${cd.id}" step="0.01" value="${Number(cd.principal).toFixed(2)}">
                    </td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 70px;" id="edit-cd-rate-${cd.id}" step="0.01" value="${Number(cd.rate).toFixed(2)}">
                    </td>
                    <td><input type="date" class="inline-edit-input" id="edit-cd-start-${cd.id}" value="${cd.startDate || ''}"></td>
                    <td><input type="date" class="inline-edit-input" id="edit-cd-maturity-${cd.id}" value="${cd.maturity}"></td>
                    <td class="text-right">—</td>
                    <td class="text-right">—</td>
                    <td class="text-right">
                        <button class="save-btn" onclick="saveEditCD('${cd.id}')">Save</button>
                        <button class="cancel-btn" onclick="cancelEditCD('${cd.id}')">Cancel</button>
                    </td>
                </tr>
            `;
        } else {
            const interest = (cd.principal || 0) * ((cd.rate || 0) / 100);
            const isMatured = new Date(cd.maturity) < new Date();

            html += `
                <tr>
                    <td class="font-bold">${cd.bank}</td>
                    <td class="text-right font-bold">${formatCurrency(cd.principal)}</td>
                    <td class="text-right text-amber font-bold">${Number(cd.rate).toFixed(2)}%</td>
                    <td>${cd.startDate || '—'}</td>
                    <td>${cd.maturity}</td>
                    <td class="text-right text-emerald">${formatCurrency(interest)} (Annual)</td>
                    <td class="text-right">
                        <span style="color: ${isMatured ? 'var(--color-danger)' : 'var(--color-success)'}">
                            ${isMatured ? 'Matured' : 'Active'}
                        </span>
                    </td>
                    <td class="text-right">
                        <button class="edit-btn" onclick="startEditCD('${cd.id}')">Edit</button>
                        <button class="delete-btn" onclick="deleteCD('${cd.id}')">Delete</button>
                    </td>
                </tr>
            `;
        }
    });
    tbody.innerHTML = html;
}

/* --------------------------------------------------------------------------
   Unified Holdings Table (accounts + CDs merged)
   -------------------------------------------------------------------------- */

function renderUnifiedHoldingsTable() {
    const tbody = document.querySelector('#table-unified-holdings tbody');
    if (!tbody) return;

    const total = state.customAccounts.length + state.cds.length;
    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No accounts or CDs added yet.</td></tr>`;
        return;
    }

    let html = '';

    state.customAccounts.forEach(acc => {
        if (!acc || acc.value === undefined) return;
        const isEditing = editingAccounts.includes(acc.id);
        const hasYield = acc.type === 'Savings' || acc.type === 'Cash';
        if (isEditing) {
            html += `<tr>
                <td><input type="text" class="inline-edit-input" id="edit-acc-name-${acc.id}" value="${acc.name}"></td>
                <td><span class="text-muted">${acc.type}</span></td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:110px;" id="edit-acc-val-${acc.id}" step="0.01" value="${Number(acc.value).toFixed(2)}"></td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:70px;" id="edit-acc-apy-${acc.id}" step="0.01" value="${Number(acc.apy).toFixed(2)}" ${hasYield ? '' : 'disabled'}></td>
                <td>—</td>
                <td class="text-right">
                    <button class="save-btn" onclick="saveEditAccount('${acc.id}')">Save</button>
                    <button class="cancel-btn" onclick="cancelEditAccount('${acc.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            html += `<tr>
                <td class="font-bold">${acc.name}</td>
                <td><span class="badge-type">${acc.type}</span></td>
                <td class="text-right font-bold text-emerald">${formatCurrency(acc.value)}</td>
                <td class="text-right text-amber">${hasYield ? `${Number(acc.apy).toFixed(2)}%` : '—'}</td>
                <td class="text-muted">—</td>
                <td class="text-right">
                    <button class="edit-btn" onclick="startEditAccount('${acc.id}')">Edit</button>
                    <button class="delete-btn" onclick="deleteCustomAccount('${acc.id}')">Delete</button>
                </td>
            </tr>`;
        }
    });

    state.cds.forEach(cd => {
        if (!cd || cd.principal === undefined) return;
        const isEditing = editingCDs.includes(cd.id);
        const isMatured = new Date(cd.maturity) < new Date();
        const interest = (cd.principal || 0) * ((cd.rate || 0) / 100);
        if (isEditing) {
            html += `<tr>
                <td><input type="text" class="inline-edit-input" id="edit-cd-bank-${cd.id}" value="${cd.bank}"></td>
                <td><span class="badge-type badge-cd">CD</span></td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:110px;" id="edit-cd-principal-${cd.id}" step="0.01" value="${Number(cd.principal).toFixed(2)}"></td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:70px;" id="edit-cd-rate-${cd.id}" step="0.01" value="${Number(cd.rate).toFixed(2)}"></td>
                <td><input type="date" class="inline-edit-input" id="edit-cd-maturity-${cd.id}" value="${cd.maturity}"><input type="date" class="inline-edit-input" id="edit-cd-start-${cd.id}" value="${cd.startDate || ''}" style="display:none;"></td>
                <td class="text-right">
                    <button class="save-btn" onclick="saveEditCD('${cd.id}')">Save</button>
                    <button class="cancel-btn" onclick="cancelEditCD('${cd.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            html += `<tr>
                <td class="font-bold">${cd.bank} <span class="text-muted" style="font-size:10px;">+${formatCurrency(interest)}/yr</span></td>
                <td><span class="badge-type badge-cd">CD</span></td>
                <td class="text-right font-bold">${formatCurrency(cd.principal)}</td>
                <td class="text-right text-amber">${Number(cd.rate).toFixed(2)}%</td>
                <td style="color:${isMatured ? 'var(--color-danger)' : 'rgba(255,255,255,0.6)'};">${cd.maturity}${isMatured ? ' ⚠' : ''}</td>
                <td class="text-right">
                    <button class="edit-btn" onclick="startEditCD('${cd.id}')">Edit</button>
                    <button class="delete-btn" onclick="deleteCD('${cd.id}')">Delete</button>
                </td>
            </tr>`;
        }
    });

    tbody.innerHTML = html;
}

/* --------------------------------------------------------------------------
   Side Gig Ledger Table
   -------------------------------------------------------------------------- */

function renderSideGigLedgerTable() {
    const tbody = document.querySelector('#table-sidegig-history tbody');
    if (!tbody) return;

    if (state.sideGigLedger.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No manual side hustle income logged yet. Use the eBay calculator or add below.</td></tr>`;
        return;
    }

    let html = '';
    state.sideGigLedger.forEach(sg => {
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
