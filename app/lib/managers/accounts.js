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
            state.customAccounts.push({
                id: Date.now().toString(),
                name: name,
                type: type,
                value: val,
                apy: type === 'Savings' || type === 'Cash' ? apy : 0,
            });
            await saveState();
            refreshAllUI();
            form.reset();
            apyGroup.style.display = 'none';
        }
    });
}

window.deleteCustomAccount = async function (id) {
    state.customAccounts = state.customAccounts.filter((acc) => acc.id !== id);
    await saveState();
    refreshAllUI();
};

window.deleteImportedFile = async function (index) {
    state.importedFiles.splice(index, 1);
    if (state.importedFiles.length === 0) {
        state.importedPositions = [];
    }
    await saveState();
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
    const apy = parseFloat(apyInput.value) || 0;
    const value = parseFloat(valInput.value) || 0;

    const accIndex = state.customAccounts.findIndex((acc) => acc.id === id);
    if (accIndex !== -1) {
        state.customAccounts[accIndex].name = name;
        state.customAccounts[accIndex].apy = apy;
        state.customAccounts[accIndex].value = value;

        editingAccounts = editingAccounts.filter((x) => x !== id);
        await saveState();
        refreshAllUI();
    }
};
