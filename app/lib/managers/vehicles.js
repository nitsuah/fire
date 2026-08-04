/* ==========================================================================
   managers/vehicles.js — Vehicle CRUD manager
   ========================================================================== */

function initVehiclesManager() {
    const form = document.getElementById('form-vehicles');
    if (!form) return;

    const yearInput = document.getElementById('veh-year');
    if (yearInput && !yearInput.value)
        yearInput.value = new Date().getFullYear();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const entry = {
            id: Date.now().toString(),
            year:
                parseInt(document.getElementById('veh-year').value) ||
                new Date().getFullYear(),
            make: document.getElementById('veh-make').value.trim(),
            model: document.getElementById('veh-model').value.trim(),
            trim: document.getElementById('veh-trim').value.trim(),
            color: document.getElementById('veh-color').value.trim(),
            mileage:
                parseInt(document.getElementById('veh-mileage').value) || 0,
            condition: document.getElementById('veh-condition').value,
            currentValue:
                parseFloat(
                    document.getElementById('veh-current-value').value,
                ) || 0,
            purchasePrice:
                parseFloat(
                    document.getElementById('veh-purchase-price').value,
                ) || 0,
            loanBalance:
                parseFloat(document.getElementById('veh-loan-balance').value) ||
                0,
            monthlyPayment:
                parseFloat(
                    document.getElementById('veh-monthly-payment').value,
                ) || 0,
            notes: document.getElementById('veh-notes').value.trim(),
        };
        if (!entry.make || !entry.model || entry.currentValue <= 0) return;
        state.vehicles.push(entry);
        await saveState();
        refreshAllUI();
        form.reset();
        document.getElementById('veh-year').value = new Date().getFullYear();
    });
}

window.deleteVehicle = async function (id) {
    state.vehicles = state.vehicles.filter((v) => v.id !== id);
    await saveState();
    refreshAllUI();
};

window.startEditVehicle = function (id) {
    editingVehicles.push(id);
    renderVehiclesTable();
};

window.cancelEditVehicle = function (id) {
    editingVehicles = editingVehicles.filter((x) => x !== id);
    renderVehiclesTable();
};

window.saveEditVehicle = async function (id) {
    const idx = state.vehicles.findIndex((v) => v.id === id);
    if (idx === -1) return;
    const g = (fId) => document.getElementById(`veh-edit-${fId}-${id}`);
    state.vehicles[idx] = {
        ...state.vehicles[idx],
        year: parseInt(g('year')?.value) || state.vehicles[idx].year,
        make: g('make')?.value.trim() || state.vehicles[idx].make,
        model: g('model')?.value.trim() || state.vehicles[idx].model,
        trim: g('trim')?.value.trim() || '',
        color: g('color')?.value.trim() || '',
        mileage: parseInt(g('mileage')?.value) || 0,
        condition: g('condition')?.value || state.vehicles[idx].condition,
        currentValue: parseFloat(g('value')?.value) || 0,
        purchasePrice: parseFloat(g('purchase')?.value) || 0,
        loanBalance: parseFloat(g('loan')?.value) || 0,
        monthlyPayment: parseFloat(g('payment')?.value) || 0,
        notes: g('notes')?.value.trim() || '',
    };
    editingVehicles = editingVehicles.filter((x) => x !== id);
    await saveState();
    refreshAllUI();
};
