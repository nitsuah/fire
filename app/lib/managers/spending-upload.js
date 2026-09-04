/* ==========================================================================
   managers/spending-upload.js — Expenses tab: CSV spending upload,
   auto-categorization, editable/deletable transaction table, and the
   user-customizable merchant → category mapping editor.
   ========================================================================== */

const SPENDING_CATEGORIES = [
    { value: 'housing', label: 'Housing' },
    { value: 'utilities', label: 'Utilities' },
    { value: 'food', label: 'Food & Groceries' },
    { value: 'transport', label: 'Transportation' },
    { value: 'healthcare', label: 'Healthcare' },
    { value: 'discretionary', label: 'Discretionary' },
];

function initSpendingUpload() {
    const dragZone = document.getElementById('spending-drag-zone');
    const fileInput = document.getElementById('spending-file-input');
    const addRowBtn = document.getElementById('btn-add-merchant-map-row');
    if (!dragZone || !fileInput) return;

    dragZone.addEventListener('click', () => fileInput.click());
    dragZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dragZone.classList.add('dragover');
    });
    dragZone.addEventListener('dragleave', () =>
        dragZone.classList.remove('dragover'),
    );
    dragZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dragZone.classList.remove('dragover');
        if (e.dataTransfer.files.length)
            processSpendingCSVFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) processSpendingCSVFile(e.target.files[0]);
        fileInput.value = '';
    });

    if (addRowBtn) addRowBtn.addEventListener('click', addMerchantMapRow);
}

function processSpendingCSVFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        const rows = parseCSVText(e.target.result);
        if (rows.length < 2) {
            alert('File appears to be empty.');
            return;
        }
        const txns = parseSpendingTransactions(
            rows,
            state.merchantCategoryOverrides || {},
        );
        if (txns.length === 0) {
            alert(
                'No spending rows recognized. Expected a Chase, Capital One, or Date/Description/Amount CSV.',
            );
            return;
        }
        if (!state.spendingTransactions) state.spendingTransactions = [];
        state.spendingTransactions.push(...txns);
        await saveState();
        refreshAllUI();
        alert(`Imported ${txns.length} transaction(s).`);
    };
    reader.readAsText(file);
}

function renderSpendingTransactionsTable() {
    const tbody = document.getElementById('tbody-spending-transactions');
    if (!tbody) return;
    const txns = state.spendingTransactions || [];
    if (txns.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No transactions uploaded yet.</td></tr>`;
        return;
    }
    const catOptions = (selected) =>
        SPENDING_CATEGORIES.map(
            (c) =>
                `<option value="${c.value}" ${c.value === selected ? 'selected' : ''}>${c.label}</option>`,
        ).join('');

    tbody.innerHTML = txns
        .map(
            (t) => `
        <tr data-tx-id="${escHtml(t.id)}">
            <td>${escHtml(t.date || '—')}</td>
            <td>${escHtml(t.merchant)}</td>
            <td class="text-right text-coral">${formatCurrency(t.amount)}</td>
            <td>
                <select class="spending-cat-select" data-tx-id="${escHtml(t.id)}" onchange="updateSpendingTxCategory(this.dataset.txId, this.value)">
                    ${catOptions(t.category)}
                </select>
            </td>
            <td class="text-right">
                <button class="spending-tx-delete" onclick="deleteSpendingTx('${escHtml(t.id)}')" aria-label="Delete transaction">✕</button>
            </td>
        </tr>
    `,
        )
        .join('');
}

window.updateSpendingTxCategory = async function (id, category) {
    const tx = (state.spendingTransactions || []).find((t) => t.id === id);
    if (!tx) return;
    tx.category = category;
    await saveState();
};

window.deleteSpendingTx = async function (id) {
    const prev = state.spendingTransactions.slice();
    state.spendingTransactions = state.spendingTransactions.filter(
        (t) => t.id !== id,
    );
    try {
        await saveState();
    } catch (err) {
        state.spendingTransactions = prev;
        console.error('Failed to delete transaction:', err);
        return;
    }
    refreshAllUI();
};

function renderMerchantMapEditor() {
    const container = document.getElementById('merchant-map-editor');
    if (!container) return;
    const overrides = state.merchantCategoryOverrides || {};
    const entries = Object.entries(overrides);
    if (entries.length === 0) {
        container.innerHTML = `<p class="text-muted" style="font-size:12px;">No custom mappings yet — uploads use the built-in keyword categorization.</p>`;
        return;
    }
    const catOptions = (selected) =>
        SPENDING_CATEGORIES.map(
            (c) =>
                `<option value="${c.value}" ${c.value === selected ? 'selected' : ''}>${c.label}</option>`,
        ).join('');

    container.innerHTML = entries
        .map(
            ([keyword, cat], idx) => `
        <div class="merchant-map-row" data-idx="${idx}">
            <input type="text" value="${escHtml(keyword)}" placeholder="merchant keyword" onchange="renameMerchantMapKeyword('${escHtml(keyword)}', this.value)">
            <select onchange="setMerchantMapCategory('${escHtml(keyword)}', this.value)">
                ${catOptions(cat)}
            </select>
            <button class="spending-tx-delete" onclick="deleteMerchantMapRow('${escHtml(keyword)}')" aria-label="Remove mapping">✕</button>
        </div>
    `,
        )
        .join('');
}

function addMerchantMapRow() {
    if (!state.merchantCategoryOverrides) state.merchantCategoryOverrides = {};
    let key = 'new-merchant';
    let n = 1;
    while (
        Object.prototype.hasOwnProperty.call(
            state.merchantCategoryOverrides,
            key,
        )
    ) {
        key = `new-merchant-${n++}`;
    }
    state.merchantCategoryOverrides[key] = 'discretionary';
    saveState();
    renderMerchantMapEditor();
}

window.renameMerchantMapKeyword = async function (oldKey, newKey) {
    const trimmed = (newKey || '').trim().toLowerCase();
    if (!trimmed || !state.merchantCategoryOverrides) return;
    const cat = state.merchantCategoryOverrides[oldKey];
    delete state.merchantCategoryOverrides[oldKey];
    state.merchantCategoryOverrides[trimmed] = cat;
    await saveState();
    renderMerchantMapEditor();
};

window.setMerchantMapCategory = async function (keyword, category) {
    if (!state.merchantCategoryOverrides) return;
    state.merchantCategoryOverrides[keyword] = category;
    await saveState();
};

window.deleteMerchantMapRow = async function (keyword) {
    if (!state.merchantCategoryOverrides) return;
    delete state.merchantCategoryOverrides[keyword];
    await saveState();
    renderMerchantMapEditor();
};

document.addEventListener('DOMContentLoaded', () => {
    initSpendingUpload();
});
