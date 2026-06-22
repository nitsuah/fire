/* ==========================================================================
   state.js — State persistence, backup export/import
   Depends on globals: state, sanitizeState, saveState, refreshAllUI
   ========================================================================== */

function sanitizeState(data) {
    if (!data) return {};

    data.importedPositions = data.importedPositions || [];
    data.customAccounts = data.customAccounts || [];
    data.cds = data.cds || [];
    data.realEstate = data.realEstate || [];
    data.vehicles = data.vehicles || [];
    data.sideGigLedger = data.sideGigLedger || [];
    data.importedFiles = data.importedFiles || [];

    data.vehicles.forEach(v => {
        if (!v.year) v.year = new Date().getFullYear();
        if (!v.make) v.make = '';
        if (!v.model) v.model = '';
        if (!v.trim) v.trim = '';
        if (!v.mileage) v.mileage = 0;
        if (!v.condition) v.condition = 'Good';
        if (!v.currentValue) v.currentValue = 0;
        if (!v.purchasePrice) v.purchasePrice = 0;
        if (!v.loanBalance) v.loanBalance = 0;
        if (!v.monthlyPayment) v.monthlyPayment = 0;
        if (!v.notes) v.notes = '';
    });

    data.realEstate.forEach(re => {
        if (!re.marketValue) re.marketValue = 0;
        if (!re.purchasePrice) re.purchasePrice = 0;
        if (!re.mortgageBalance) re.mortgageBalance = 0;
        if (!re.monthlyPayment) re.monthlyPayment = 0;
        if (!re.type) re.type = 'Primary Home';
        if (!re.address) re.address = '';
        if (!re.notes) re.notes = '';
    });

    data.customAccounts.forEach(acc => {
        if (acc.apy === undefined || acc.apy === null) acc.apy = 0;
        if (acc.value === undefined || acc.value === null) acc.value = 0;
    });

    data.cds.forEach(cd => {
        if (cd.startDate === undefined || cd.startDate === null) cd.startDate = '';
        if (cd.principal === undefined || cd.principal === null) cd.principal = 0;
        if (cd.rate === undefined || cd.rate === null) cd.rate = 0;
    });

    // Ensure projectionSettings has age fields
    if (data.projectionSettings) {
        if (!data.projectionSettings.currentAge) data.projectionSettings.currentAge = 30;
        if (!data.projectionSettings.retireAge) data.projectionSettings.retireAge = 60;
    }

    // Ensure insurance fields are always present
    if (!data.insurances) data.insurances = { car: { amt: 0, freq: '6month' }, home: { amt: 0, freq: 'monthly' } };
    if (!data.insurances.car) data.insurances.car = { amt: 0, freq: '6month' };
    if (!data.insurances.home) data.insurances.home = { amt: 0, freq: 'monthly' };

    return data;
}

async function loadStateFromServer() {
    try {
        const res = await fetch('/api/state');
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object' && Object.keys(data).length > 0) {
                state = sanitizeState({ ...state, ...data });
                console.log("State loaded successfully from backend DB.");
                return;
            }
        }
    } catch (e) {
        console.warn("Express backend unreachable. Falling back to localStorage.", e);
    }
    loadStateFromStorage();
}

function loadStateFromStorage() {
    const savedState = localStorage.getItem('fire_tracker_state');
    if (savedState) {
        try {
            const parsed = JSON.parse(savedState);
            state = sanitizeState({ ...state, ...parsed });
            state.expenses = { ...state.expenses, ...(parsed.expenses || {}) };
            state.projectionSettings = { ...state.projectionSettings, ...(parsed.projectionSettings || {}) };
        } catch (e) {
            console.error("Error parsing localstorage state", e);
        }
    }
}

async function saveState() {
    localStorage.setItem('fire_tracker_state', JSON.stringify(state));

    try {
        const res = await fetch('/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        if (!res.ok) {
            console.error("Server API returned status", res.status);
        }
    } catch (e) {
        console.warn("Could not save state to Express backend server.", e);
    }
}

// Backup Export & Import Utility
document.getElementById('btn-backup-export').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `fire_tracker_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
});

const backupFileTrigger = document.getElementById('btn-backup-import-trigger');
const backupFileInput = document.getElementById('backup-file-input');

backupFileTrigger.addEventListener('click', () => backupFileInput.click());
backupFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const importedState = JSON.parse(event.target.result);
            if (importedState && typeof importedState === 'object') {
                state = sanitizeState(importedState);
                await saveState();
                refreshAllUI();
                alert('Backup imported successfully!');
            } else {
                alert('Invalid backup structure.');
            }
        } catch (err) {
            alert('Failed to parse backup JSON file: ' + err.message);
        }
    };
    reader.readAsText(file);
});
