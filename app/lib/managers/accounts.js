/* ==========================================================================
   managers/accounts.js — Custom account and imported file CRUD manager
   ========================================================================== */

function initAccountsManager() {
    const form = document.getElementById('form-custom-account');
    const accType = document.getElementById('acc-type');
    const apyGroup = document.getElementById('group-acc-apy');

    if (accType.value === 'Savings' || accType.value === 'Cash') {
        apyGroup.style.display = 'block';
    } else {
        apyGroup.style.display = 'none';
    }

    accType.addEventListener('change', () => {
        if (accType.value === 'Savings' || accType.value === 'Cash') {
            apyGroup.style.display = 'block';
        } else {
            apyGroup.style.display = 'none';
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('acc-name').value;
        const type = accType.value;
        const val = parseFloat(document.getElementById('acc-val').value);
        const apy = parseFloat(document.getElementById('acc-apy').value) || 0;

        if (name && !isNaN(val)) {
            const entry = {
                id: Date.now().toString(),
                name: name,
                type: type,
                value: val,
                apy: type === 'Savings' || type === 'Cash' ? apy : 0,
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
            apyGroup.style.display = 'none';
        }
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

    const name = nameInput.value;
    const apyRaw = apyInput.value.trim();
    const apy = apyRaw === '' ? 0 : parseFloat(apyRaw);
    if (!Number.isFinite(apy)) return;
    const value = parseFloat(valInput.value);
    if (!Number.isFinite(value)) return;

    const accIndex = state.customAccounts.findIndex((acc) => acc.id === id);
    if (accIndex !== -1) {
        const prev = { ...state.customAccounts[accIndex] };
        state.customAccounts[accIndex].name = name;
        state.customAccounts[accIndex].apy = apy;
        state.customAccounts[accIndex].value = value;

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
    }
};
