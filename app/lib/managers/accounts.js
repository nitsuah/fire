/* ==========================================================================
   managers/accounts.js — Custom account and imported file CRUD manager
   ========================================================================== */

function initAccountsManager() {
    const form = document.getElementById('form-custom-account');
    const accType = document.getElementById('acc-type');
    const apyGroup = document.getElementById('group-acc-apy');
    const cryptoGroup = document.getElementById('group-crypto-fields');

    function updateTypeFields() {
        const t = accType.value;
        // APY shown for yield-bearing types
        apyGroup.style.display =
            t === 'Savings' || t === 'Cash' || t === 'Crypto'
                ? 'block'
                : 'none';
        const apyLabel = document.getElementById('label-acc-apy');
        if (apyLabel)
            apyLabel.textContent =
                t === 'Crypto'
                    ? 'Staking / Lending APY (%)'
                    : 'APY / Yield (%)';
        // Crypto-specific fields
        if (cryptoGroup)
            cryptoGroup.style.display = t === 'Crypto' ? '' : 'none';
    }

    updateTypeFields();
    accType.addEventListener('change', updateTypeFields);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('acc-name').value;
        const type = accType.value;
        const val = parseFloat(document.getElementById('acc-val').value);
        const apyRaw = document.getElementById('acc-apy').value;
        const apy =
            type === 'Savings' || type === 'Cash' || type === 'Crypto'
                ? parseFloat(apyRaw) || 0
                : 0;
        const identifier =
            type === 'Crypto'
                ? (
                      document.getElementById('acc-identifier')?.value || ''
                  ).trim()
                : '';
        const quantityRaw = document.getElementById('acc-quantity')?.value;
        const quantity =
            type === 'Crypto' && quantityRaw
                ? parseFloat(quantityRaw) || null
                : null;

        if (!name || isNaN(val)) return;

        const entry = {
            id: Date.now().toString(),
            name,
            type,
            value: val,
            apy,
            ...(type === 'Crypto' && identifier ? { identifier } : {}),
            ...(type === 'Crypto' && quantity !== null ? { quantity } : {}),
        };
        state.customAccounts.push(entry);
        try {
            await saveState();
        } catch (err) {
            state.customAccounts = state.customAccounts.filter(
                (a) => a.id !== entry.id,
            );
            console.error('Failed to save account:', err);
            return;
        }
        refreshAllUI();
        form.reset();
        updateTypeFields();
    });
}

window.deleteCustomAccount = async function (id) {
    const prev = state.customAccounts.slice();
    state.customAccounts = state.customAccounts.filter((acc) => acc.id !== id);
    try {
        await saveState();
    } catch (err) {
        state.customAccounts = prev;
        console.error('Failed to delete account:', err);
        return;
    }
    refreshAllUI();
};

window.deleteImportedFile = async function (index) {
    const prevFiles = state.importedFiles.slice();
    const prevPositions = state.importedPositions.slice();
    state.importedFiles.splice(index, 1);
    if (state.importedFiles.length === 0) {
        state.importedPositions = [];
    }
    try {
        await saveState();
    } catch (err) {
        state.importedFiles = prevFiles;
        state.importedPositions = prevPositions;
        console.error('Failed to delete imported file:', err);
        return;
    }
    refreshAllUI();
};

window.startEditAccount = function (id) {
    editingAccounts.push(id);
    renderUnifiedHoldingsTable();
};

window.cancelEditAccount = function (id) {
    editingAccounts = editingAccounts.filter((x) => x !== id);
    renderUnifiedHoldingsTable();
};

window.saveEditAccount = async function (id) {
    const nameInput = document.getElementById(`edit-acc-name-${id}`);
    const apyInput = document.getElementById(`edit-acc-apy-${id}`);
    const valInput = document.getElementById(`edit-acc-val-${id}`);
    const identifierInput = document.getElementById(
        `edit-acc-identifier-${id}`,
    );
    const quantityInput = document.getElementById(`edit-acc-quantity-${id}`);

    const name = nameInput?.value?.trim();
    if (!name) return;
    const apyRaw = apyInput?.value.trim();
    const apy = apyRaw === '' ? 0 : parseFloat(apyRaw);
    if (!Number.isFinite(apy)) return;
    const value = parseFloat(valInput?.value);
    if (!Number.isFinite(value)) return;

    const accIndex = state.customAccounts.findIndex((acc) => acc.id === id);
    if (accIndex === -1) return;

    const cur = state.customAccounts[accIndex];
    const prev = { ...cur };

    state.customAccounts[accIndex] = {
        ...cur,
        name,
        apy,
        value,
        ...(cur.type === 'Crypto' && identifierInput
            ? { identifier: identifierInput.value.trim() }
            : {}),
        ...(cur.type === 'Crypto' && quantityInput
            ? { quantity: parseFloat(quantityInput.value) || null }
            : {}),
    };

    editingAccounts = editingAccounts.filter((x) => x !== id);
    try {
        await saveState();
    } catch (err) {
        state.customAccounts[accIndex] = prev;
        editingAccounts.push(id);
        console.error('Failed to save account edit:', err);
        return;
    }
    refreshAllUI();
};

window.refreshCryptoAccount = async function (id) {
    const btns = document.querySelectorAll(`[data-crypto-refresh-id="${id}"]`);
    btns.forEach((b) => {
        b.disabled = true;
        b.textContent = 'Refreshing…';
    });
    try {
        const res = await fetch(
            `/api/accounts/${encodeURIComponent(id)}/refresh-crypto`,
            {
                method: 'POST',
            },
        );
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Refresh failed');
            return;
        }

        const { cryptoResult: _cr, ...accountFields } = data;
        const idx = state.customAccounts.findIndex((a) => a.id === id);
        if (idx !== -1) {
            state.customAccounts[idx] = {
                ...state.customAccounts[idx],
                ...accountFields,
            };
        }
        refreshAllUI();
    } catch (err) {
        alert(err.message);
    } finally {
        btns.forEach((b) => {
            b.disabled = false;
            b.textContent = '⟳ Refresh';
        });
    }
};
