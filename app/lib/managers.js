/* ==========================================================================
   managers.js — Navigation, Accounts, CDs, Real Estate, Vehicles,
                 Unified Asset Form
   ========================================================================== */

/* --------------------------------------------------------------------------
   Navigation Controller
   -------------------------------------------------------------------------- */

function initNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');

            navButtons.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));

            btn.classList.add('active');
            const activePane = document.getElementById(`tab-${targetTab}`);
            if (activePane) activePane.classList.add('active');

            if (targetTab === 'dashboard') {
                renderAssetAllocationChart();
                renderDashboardProjectionsChart();
            } else if (targetTab === 'projections') {
                calculateAndRenderProjections();
            }
        });
    });
}

/* --------------------------------------------------------------------------
   Accounts & Assets Manager
   -------------------------------------------------------------------------- */

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
                apy: (type === 'Savings' || type === 'Cash') ? apy : 0
            });
            await saveState();
            refreshAllUI();
            form.reset();
            apyGroup.style.display = 'none';
        }
    });
}

window.deleteCustomAccount = async function(id) {
    state.customAccounts = state.customAccounts.filter(acc => acc.id !== id);
    await saveState();
    refreshAllUI();
};

window.deleteImportedFile = async function(index) {
    state.importedFiles.splice(index, 1);
    if (state.importedFiles.length === 0) {
        state.importedPositions = [];
    }
    await saveState();
    refreshAllUI();
};

window.startEditAccount = function(id) {
    editingAccounts.push(id);
    renderUnifiedHoldingsTable();
};

window.cancelEditAccount = function(id) {
    editingAccounts = editingAccounts.filter(x => x !== id);
    renderUnifiedHoldingsTable();
};

window.saveEditAccount = async function(id) {
    const nameInput = document.getElementById(`edit-acc-name-${id}`);
    const apyInput = document.getElementById(`edit-acc-apy-${id}`);
    const valInput = document.getElementById(`edit-acc-val-${id}`);

    const name = nameInput.value;
    const apy = parseFloat(apyInput.value) || 0;
    const value = parseFloat(valInput.value) || 0;

    const accIndex = state.customAccounts.findIndex(acc => acc.id === id);
    if (accIndex !== -1) {
        state.customAccounts[accIndex].name = name;
        state.customAccounts[accIndex].apy = apy;
        state.customAccounts[accIndex].value = value;

        editingAccounts = editingAccounts.filter(x => x !== id);
        await saveState();
        refreshAllUI();
    }
};

/* --------------------------------------------------------------------------
   Certificates of Deposit (CDs) Manager
   -------------------------------------------------------------------------- */

function initCDManager() {
    const form = document.getElementById('form-cd-entry');

    document.getElementById('cd-start').value = new Date().toISOString().slice(0, 10);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const bank = document.getElementById('cd-bank').value;
        const principal = parseFloat(document.getElementById('cd-principal').value);
        const rate = parseFloat(document.getElementById('cd-rate').value);
        const startDate = document.getElementById('cd-start').value;
        const maturity = document.getElementById('cd-maturity').value;

        if (bank && !isNaN(principal) && !isNaN(rate) && startDate && maturity) {
            state.cds.push({
                id: Date.now().toString(),
                bank: bank,
                principal: principal,
                rate: rate,
                startDate: startDate,
                maturity: maturity
            });
            await saveState();
            refreshAllUI();
            form.reset();
            document.getElementById('cd-start').value = new Date().toISOString().slice(0, 10);
        }
    });
}

window.deleteCD = async function(id) {
    state.cds = state.cds.filter(cd => cd.id !== id);
    await saveState();
    refreshAllUI();
};

window.startEditCD = function(id) {
    editingCDs.push(id);
    renderUnifiedHoldingsTable();
};

window.cancelEditCD = function(id) {
    editingCDs = editingCDs.filter(x => x !== id);
    renderUnifiedHoldingsTable();
};

window.saveEditCD = async function(id) {
    const bankInput = document.getElementById(`edit-cd-bank-${id}`);
    const principalInput = document.getElementById(`edit-cd-principal-${id}`);
    const rateInput = document.getElementById(`edit-cd-rate-${id}`);
    const startInput = document.getElementById(`edit-cd-start-${id}`);
    const matInput = document.getElementById(`edit-cd-maturity-${id}`);

    const bank = bankInput.value;
    const principal = parseFloat(principalInput.value) || 0;
    const rate = parseFloat(rateInput.value) || 0;
    const startDate = startInput.value;
    const maturity = matInput.value;

    const cdIndex = state.cds.findIndex(cd => cd.id === id);
    if (cdIndex !== -1) {
        state.cds[cdIndex].bank = bank;
        state.cds[cdIndex].principal = principal;
        state.cds[cdIndex].rate = rate;
        state.cds[cdIndex].startDate = startDate;
        state.cds[cdIndex].maturity = maturity;

        editingCDs = editingCDs.filter(x => x !== id);
        await saveState();
        refreshAllUI();
    }
};

/* --------------------------------------------------------------------------
   Real Estate Manager
   -------------------------------------------------------------------------- */

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
            marketValue: parseFloat(document.getElementById('re-market-value').value) || 0,
            purchasePrice: parseFloat(document.getElementById('re-purchase-price').value) || 0,
            mortgageBalance: parseFloat(document.getElementById('re-mortgage-balance').value) || 0,
            monthlyPayment: parseFloat(document.getElementById('re-monthly-payment').value) || 0,
            notes: document.getElementById('re-notes').value.trim()
        };
        if (!entry.name || entry.marketValue <= 0) return;
        state.realEstate.push(entry);
        await saveState();
        refreshAllUI();
        form.reset();
    });
}

window.deleteRealEstate = async function(id) {
    state.realEstate = state.realEstate.filter(re => re.id !== id);
    await saveState();
    refreshAllUI();
};

window.startEditRealEstate = function(id) {
    editingRealEstate.push(id);
    renderRealEstateTable();
};

window.cancelEditRealEstate = function(id) {
    editingRealEstate = editingRealEstate.filter(x => x !== id);
    renderRealEstateTable();
};

window.saveEditRealEstate = async function(id) {
    const idx = state.realEstate.findIndex(re => re.id === id);
    if (idx === -1) return;
    state.realEstate[idx] = {
        ...state.realEstate[idx],
        name: document.getElementById(`re-edit-name-${id}`)?.value.trim() || state.realEstate[idx].name,
        type: document.getElementById(`re-edit-type-${id}`)?.value || state.realEstate[idx].type,
        address: document.getElementById(`re-edit-address-${id}`)?.value.trim() || '',
        marketValue: parseFloat(document.getElementById(`re-edit-market-${id}`)?.value) || 0,
        purchasePrice: parseFloat(document.getElementById(`re-edit-purchase-${id}`)?.value) || 0,
        mortgageBalance: parseFloat(document.getElementById(`re-edit-mortgage-${id}`)?.value) || 0,
        monthlyPayment: parseFloat(document.getElementById(`re-edit-payment-${id}`)?.value) || 0,
        notes: document.getElementById(`re-edit-notes-${id}`)?.value.trim() || ''
    };
    editingRealEstate = editingRealEstate.filter(x => x !== id);
    await saveState();
    refreshAllUI();
};

/* --------------------------------------------------------------------------
   Vehicles Manager
   -------------------------------------------------------------------------- */

function initVehiclesManager() {
    const form = document.getElementById('form-vehicles');
    if (!form) return;

    const yearInput = document.getElementById('veh-year');
    if (yearInput && !yearInput.value) yearInput.value = new Date().getFullYear();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const entry = {
            id: Date.now().toString(),
            year: parseInt(document.getElementById('veh-year').value) || new Date().getFullYear(),
            make: document.getElementById('veh-make').value.trim(),
            model: document.getElementById('veh-model').value.trim(),
            trim: document.getElementById('veh-trim').value.trim(),
            color: document.getElementById('veh-color').value.trim(),
            mileage: parseInt(document.getElementById('veh-mileage').value) || 0,
            condition: document.getElementById('veh-condition').value,
            currentValue: parseFloat(document.getElementById('veh-current-value').value) || 0,
            purchasePrice: parseFloat(document.getElementById('veh-purchase-price').value) || 0,
            loanBalance: parseFloat(document.getElementById('veh-loan-balance').value) || 0,
            monthlyPayment: parseFloat(document.getElementById('veh-monthly-payment').value) || 0,
            notes: document.getElementById('veh-notes').value.trim()
        };
        if (!entry.make || !entry.model || entry.currentValue <= 0) return;
        state.vehicles.push(entry);
        await saveState();
        refreshAllUI();
        form.reset();
        document.getElementById('veh-year').value = new Date().getFullYear();
    });
}

window.deleteVehicle = async function(id) {
    state.vehicles = state.vehicles.filter(v => v.id !== id);
    await saveState();
    refreshAllUI();
};

window.startEditVehicle = function(id) {
    editingVehicles.push(id);
    renderVehiclesTable();
};

window.cancelEditVehicle = function(id) {
    editingVehicles = editingVehicles.filter(x => x !== id);
    renderVehiclesTable();
};

window.saveEditVehicle = async function(id) {
    const idx = state.vehicles.findIndex(v => v.id === id);
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
        notes: g('notes')?.value.trim() || ''
    };
    editingVehicles = editingVehicles.filter(x => x !== id);
    await saveState();
    refreshAllUI();
};

/* --------------------------------------------------------------------------
   Unified Asset Form (tab switcher)
   -------------------------------------------------------------------------- */

function initUnifiedAssetForm() {
    const tabs = document.querySelectorAll('.ua-tab-btn');
    const panels = ['account', 'cd', 'realestate', 'vehicle'];
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.dataset.uaTab;
            panels.forEach(p => {
                const el = document.getElementById(`ua-panel-${p}`);
                if (el) el.style.display = target === p ? '' : 'none';
            });
        });
    });
}
