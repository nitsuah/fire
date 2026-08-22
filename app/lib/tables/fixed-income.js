/* ==========================================================================
   tables/fixed-income.js — Imported files, custom accounts, CDs, and
                             unified holdings table renderers
   ========================================================================== */

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

function renderCustomAccountsTable() {
    const tbody = document.querySelector('#table-custom-accounts tbody');
    if (!tbody) return;

    if (state.customAccounts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No manual accounts entered.</td></tr>`;
        return;
    }

    let html = '';
    state.customAccounts.forEach((acc) => {
        if (!acc || acc.value === undefined || acc.value === null) return;
        const isEditing = editingAccounts.includes(acc.id);

        if (isEditing) {
            const isCrypto = acc.type === 'Crypto';
            const hasYieldEdit =
                acc.type === 'Savings' || acc.type === 'Cash' || isCrypto;
            html += `
                <tr>
                    <td><input type="text" class="inline-edit-input" id="edit-acc-name-${acc.id}" value="${escHtml(acc.name)}"></td>
                    <td><span class="text-muted">${escHtml(acc.type)}</span></td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 80px;" id="edit-acc-apy-${acc.id}" step="0.01" value="${Number(acc.apy || 0).toFixed(2)}" ${hasYieldEdit ? '' : 'disabled'}>
                    </td>
                    <td class="text-right">
                        <input type="number" class="inline-edit-input text-right" style="width: 120px;" id="edit-acc-val-${acc.id}" step="0.01" value="${Number(acc.value).toFixed(2)}">
                        ${isCrypto ? `<br><input type="text" class="inline-edit-input" style="width:120px;font-size:11px;" id="edit-acc-identifier-${acc.id}" placeholder="ETH, 0x…, you.eth" value="${escHtml(acc.identifier || '')}"><br><input type="number" class="inline-edit-input text-right" style="width:80px;font-size:11px;" id="edit-acc-quantity-${acc.id}" placeholder="Qty" step="any" value="${acc.quantity != null ? acc.quantity : ''}">` : ''}
                    </td>
                    <td class="text-right">
                        <button class="save-btn" onclick="saveEditAccount('${acc.id}')">Save</button>
                        <button class="cancel-btn" onclick="cancelEditAccount('${acc.id}')">Cancel</button>
                    </td>
                </tr>
            `;
        } else {
            const hasYield =
                acc.type === 'Savings' ||
                acc.type === 'Cash' ||
                acc.type === 'Crypto';
            const isCrypto = acc.type === 'Crypto';
            html += `
                <tr>
                    <td class="font-bold">${escHtml(acc.name)}${isCrypto && acc.identifier ? `<br><span class="text-muted" style="font-size:11px;">${escHtml(acc.identifier)}${acc.quantity != null ? ` × ${acc.quantity}` : ''}</span>` : ''}</td>
                    <td><span class="text-muted">${escHtml(acc.type)}</span></td>
                    <td class="text-right text-amber font-bold">${hasYield && acc.apy ? `${Number(acc.apy).toFixed(2)}%` : '—'}</td>
                    <td class="text-right font-bold text-emerald">${formatCurrency(acc.value)}</td>
                    <td class="text-right">
                        ${isCrypto && acc.identifier ? `<button class="edit-btn" data-crypto-refresh-id="${acc.id}" onclick="refreshCryptoAccount('${acc.id}')">⟳ Refresh</button>` : ''}
                        <button class="edit-btn" onclick="startEditAccount('${acc.id}')">Edit</button>
                        <button class="delete-btn" onclick="deleteCustomAccount('${acc.id}')">Delete</button>
                    </td>
                </tr>
            `;
        }
    });
    tbody.innerHTML = html;
}

function renderCDTable() {
    const tbody = document.querySelector('#table-cd-list tbody');
    if (!tbody) return;

    let totalCDPrincipal = 0;
    let totalAnnualFixedYield = 0;
    let totalFixedAssets = 0;

    state.cds.forEach((cd) => {
        if (!cd || cd.principal === undefined) return;
        totalCDPrincipal += cd.principal || 0;
        totalAnnualFixedYield += (cd.principal || 0) * ((cd.rate || 0) / 100);
    });
    totalFixedAssets += totalCDPrincipal;

    state.customAccounts.forEach((acc) => {
        if ((acc.type === 'Savings' || acc.type === 'Cash') && acc.apy > 0) {
            totalAnnualFixedYield += (acc.value || 0) * ((acc.apy || 0) / 100);
            totalFixedAssets += acc.value || 0;
        }
    });

    const weightedApy =
        totalFixedAssets > 0
            ? (totalAnnualFixedYield / totalFixedAssets) * 100
            : 0;
    document.getElementById('cd-total-principal').textContent =
        formatCurrency(totalCDPrincipal);
    document.getElementById('cd-total-interest').textContent =
        `${formatCurrency(totalAnnualFixedYield)} (Annual)`;
    document.getElementById('cd-weighted-apy').textContent =
        `${weightedApy.toFixed(2)}%`;

    if (state.cds.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No CDs logged. Enter your CD details in the form.</td></tr>`;
        return;
    }

    let html = '';
    state.cds.forEach((cd) => {
        if (!cd || cd.principal === undefined) return;
        const isEditing = editingCDs.includes(cd.id);

        if (isEditing) {
            html += `
                <tr>
                    <td><input type="text" class="inline-edit-input" id="edit-cd-bank-${cd.id}" value="${escHtml(cd.bank)}"></td>
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
                    <td class="font-bold">${escHtml(cd.bank)}</td>
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

function renderUnifiedHoldingsTable() {
    const tbody = document.querySelector('#table-unified-holdings tbody');
    if (!tbody) return;

    const total = state.customAccounts.length + state.cds.length;
    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No accounts or CDs added yet.</td></tr>`;
        return;
    }

    let html = '';

    state.customAccounts.forEach((acc) => {
        if (!acc || acc.value === undefined) return;
        const isEditing = editingAccounts.includes(acc.id);
        const isCrypto = acc.type === 'Crypto';
        const hasYield =
            acc.type === 'Savings' || acc.type === 'Cash' || isCrypto;
        if (isEditing) {
            html += `<tr>
                <td><input type="text" class="inline-edit-input" id="edit-acc-name-${acc.id}" value="${escHtml(acc.name)}"></td>
                <td><span class="text-muted">${escHtml(acc.type)}</span></td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:110px;" id="edit-acc-val-${acc.id}" step="0.01" value="${Number(acc.value).toFixed(2)}">
                    ${isCrypto ? `<br><input type="text" class="inline-edit-input" style="width:110px;font-size:11px;" id="edit-acc-identifier-${acc.id}" placeholder="ETH, 0x…, you.eth" value="${escHtml(acc.identifier || '')}">` : ''}
                </td>
                <td class="text-right"><input type="number" class="inline-edit-input text-right" style="width:70px;" id="edit-acc-apy-${acc.id}" step="0.01" value="${Number(acc.apy || 0).toFixed(2)}" ${hasYield ? '' : 'disabled'}>
                    ${isCrypto ? `<br><input type="number" class="inline-edit-input text-right" style="width:70px;font-size:11px;" id="edit-acc-quantity-${acc.id}" placeholder="Qty" step="any" value="${acc.quantity != null ? acc.quantity : ''}">` : ''}
                </td>
                <td>—</td>
                <td class="text-right">
                    <button class="save-btn" onclick="saveEditAccount('${acc.id}')">Save</button>
                    <button class="cancel-btn" onclick="cancelEditAccount('${acc.id}')">Cancel</button>
                </td>
            </tr>`;
        } else {
            html += `<tr>
                <td class="font-bold">${escHtml(acc.name)}${isCrypto && acc.identifier ? `<br><span class="text-muted" style="font-size:11px;">${escHtml(acc.identifier)}${acc.quantity != null ? ` × ${acc.quantity}` : ''}</span>` : ''}</td>
                <td><span class="badge-type">${escHtml(acc.type)}</span></td>
                <td class="text-right font-bold text-emerald">${formatCurrency(acc.value)}</td>
                <td class="text-right text-amber">${hasYield && acc.apy ? `${Number(acc.apy).toFixed(2)}%` : '—'}</td>
                <td class="text-muted">${isCrypto && acc.identifier ? `<span title="${escHtml(acc.identifier)}">${escHtml(acc.identifier.length > 16 ? acc.identifier.slice(0, 8) + '…' + acc.identifier.slice(-6) : acc.identifier)}</span>` : '—'}</td>
                <td class="text-right">
                    ${isCrypto && acc.identifier ? `<button class="edit-btn" data-crypto-refresh-id="${acc.id}" aria-label="Refresh crypto balance" onclick="refreshCryptoAccount('${acc.id}')">⟳</button>` : ''}
                    <button class="edit-btn" onclick="startEditAccount('${acc.id}')">Edit</button>
                    <button class="delete-btn" onclick="deleteCustomAccount('${acc.id}')">Delete</button>
                </td>
            </tr>`;
        }
    });

    state.cds.forEach((cd) => {
        if (!cd || cd.principal === undefined) return;
        const isEditing = editingCDs.includes(cd.id);
        const isMatured = new Date(cd.maturity) < new Date();
        const interest = (cd.principal || 0) * ((cd.rate || 0) / 100);
        if (isEditing) {
            html += `<tr>
                <td><input type="text" class="inline-edit-input" id="edit-cd-bank-${cd.id}" value="${escHtml(cd.bank)}"></td>
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
                <td class="font-bold">${escHtml(cd.bank)} <span class="text-muted" style="font-size:10px;">+${formatCurrency(interest)}/yr</span></td>
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
