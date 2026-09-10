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
    dragZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });
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

    // Delegated listeners on the container (rather than inline onchange/
    // onclick attributes rebuilt with every innerHTML render) — the keyword
    // is user-controlled free text, and interpolating it into an inline JS
    // handler string is an XSS vector even when HTML-entity-escaped, since
    // the browser HTML-decodes the attribute before evaluating the handler.
    const mapEditor = document.getElementById('merchant-map-editor');
    if (mapEditor) {
        mapEditor.addEventListener('change', (e) => {
            const keyword = e.target.dataset.keyword;
            if (keyword === undefined) return;
            if (e.target.classList.contains('merchant-map-rename')) {
                renameMerchantMapKeyword(keyword, e.target.value);
            } else if (e.target.classList.contains('merchant-map-category')) {
                setMerchantMapCategory(keyword, e.target.value);
            }
        });
        mapEditor.addEventListener('click', (e) => {
            const btn = e.target.closest('.merchant-map-delete');
            if (btn) deleteMerchantMapRow(btn.dataset.keyword);
        });
    }
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
        const previous = state.spendingTransactions.slice();
        state.spendingTransactions.push(...txns);
        try {
            await saveState();
        } catch (err) {
            state.spendingTransactions = previous;
            console.error('Failed to persist imported transactions:', err);
            alert('Import failed to save — please try again.');
            return;
        }
        refreshAllUI();
        alert(`Imported ${txns.length} transaction(s).`);
    };
    reader.onerror = () => {
        alert('Could not read the selected file. Please try again.');
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
    const previous = tx.category;
    tx.category = category;
    try {
        await saveState();
    } catch (err) {
        tx.category = previous;
        console.error('Failed to persist transaction category:', err);
    }
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
            <input type="text" value="${escHtml(keyword)}" placeholder="merchant keyword" data-keyword="${escHtml(keyword)}" class="merchant-map-rename">
            <select data-keyword="${escHtml(keyword)}" class="merchant-map-category">
                ${catOptions(cat)}
            </select>
            <button class="spending-tx-delete merchant-map-delete" data-keyword="${escHtml(keyword)}" aria-label="Remove mapping">✕</button>
        </div>
    `,
        )
        .join('');
}

async function addMerchantMapRow() {
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
    try {
        await saveState();
    } catch (err) {
        delete state.merchantCategoryOverrides[key];
        console.error('Failed to persist new merchant mapping:', err);
        return;
    }
    renderMerchantMapEditor();
}

async function renameMerchantMapKeyword(oldKey, newKey) {
    const trimmed = (newKey || '').trim().toLowerCase();
    if (!trimmed || !state.merchantCategoryOverrides) return;
    if (
        trimmed !== oldKey &&
        Object.prototype.hasOwnProperty.call(
            state.merchantCategoryOverrides,
            trimmed,
        )
    ) {
        alert(`A mapping for "${trimmed}" already exists.`);
        renderMerchantMapEditor();
        return;
    }
    const cat = state.merchantCategoryOverrides[oldKey];
    delete state.merchantCategoryOverrides[oldKey];
    state.merchantCategoryOverrides[trimmed] = cat;
    try {
        await saveState();
    } catch (err) {
        delete state.merchantCategoryOverrides[trimmed];
        state.merchantCategoryOverrides[oldKey] = cat;
        console.error('Failed to persist renamed merchant mapping:', err);
    }
    renderMerchantMapEditor();
}

async function setMerchantMapCategory(keyword, category) {
    if (!state.merchantCategoryOverrides) return;
    const previous = state.merchantCategoryOverrides[keyword];
    state.merchantCategoryOverrides[keyword] = category;
    try {
        await saveState();
    } catch (err) {
        state.merchantCategoryOverrides[keyword] = previous;
        console.error('Failed to persist merchant category:', err);
    }
}

async function deleteMerchantMapRow(keyword) {
    if (!state.merchantCategoryOverrides) return;
    const previous = state.merchantCategoryOverrides[keyword];
    delete state.merchantCategoryOverrides[keyword];
    try {
        await saveState();
    } catch (err) {
        state.merchantCategoryOverrides[keyword] = previous;
        console.error('Failed to persist merchant mapping deletion:', err);
        return;
    }
    renderMerchantMapEditor();
}

document.addEventListener('DOMContentLoaded', () => {
    initSpendingUpload();
});
