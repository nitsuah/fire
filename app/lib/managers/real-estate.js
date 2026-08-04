/* ==========================================================================
   managers/real-estate.js — Real estate CRUD manager
   ========================================================================== */

function initRealEstateManager() {
    const form = document.getElementById('form-real-estate');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const entry = {
            id: Date.now().toString(),
            name: document.getElementById('re-name').value.trim(),
            type: document.getElementById('re-type').value,
            address: document.getElementById('re-address').value.trim(),
            marketValue:
                parseFloat(document.getElementById('re-market-value').value) ||
                0,
            purchasePrice:
                parseFloat(
                    document.getElementById('re-purchase-price').value,
                ) || 0,
            mortgageBalance:
                parseFloat(
                    document.getElementById('re-mortgage-balance').value,
                ) || 0,
            monthlyPayment:
                parseFloat(
                    document.getElementById('re-monthly-payment').value,
                ) || 0,
            notes: document.getElementById('re-notes').value.trim(),
        };
        if (!entry.name || entry.marketValue <= 0) return;
        state.realEstate.push(entry);
        await saveState();
        refreshAllUI();
        form.reset();
    });
}

window.deleteRealEstate = async function (id) {
    state.realEstate = state.realEstate.filter((re) => re.id !== id);
    await saveState();
    refreshAllUI();
};

window.startEditRealEstate = function (id) {
    editingRealEstate.push(id);
    renderRealEstateTable();
};

window.cancelEditRealEstate = function (id) {
    editingRealEstate = editingRealEstate.filter((x) => x !== id);
    renderRealEstateTable();
};

window.saveEditRealEstate = async function (id) {
    const idx = state.realEstate.findIndex((re) => re.id === id);
    if (idx === -1) return;
    state.realEstate[idx] = {
        ...state.realEstate[idx],
        name:
            document.getElementById(`re-edit-name-${id}`)?.value.trim() ||
            state.realEstate[idx].name,
        type:
            document.getElementById(`re-edit-type-${id}`)?.value ||
            state.realEstate[idx].type,
        address:
            document.getElementById(`re-edit-address-${id}`)?.value.trim() ||
            '',
        marketValue:
            parseFloat(
                document.getElementById(`re-edit-market-${id}`)?.value,
            ) || 0,
        purchasePrice:
            parseFloat(
                document.getElementById(`re-edit-purchase-${id}`)?.value,
            ) || 0,
        mortgageBalance:
            parseFloat(
                document.getElementById(`re-edit-mortgage-${id}`)?.value,
            ) || 0,
        monthlyPayment:
            parseFloat(
                document.getElementById(`re-edit-payment-${id}`)?.value,
            ) || 0,
        notes:
            document.getElementById(`re-edit-notes-${id}`)?.value.trim() || '',
    };
    editingRealEstate = editingRealEstate.filter((x) => x !== id);
    await saveState();
    refreshAllUI();
};
