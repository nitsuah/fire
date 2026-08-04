/* ==========================================================================
   managers/cds.js — Certificate of Deposit CRUD manager
   ========================================================================== */

function initCDManager() {
    const form = document.getElementById('form-cd-entry');

    const _today = new Date();
    document.getElementById('cd-start').value = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, '0')}-${String(_today.getDate()).padStart(2, '0')}`;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const bank = document.getElementById('cd-bank').value;
        const principal = parseFloat(
            document.getElementById('cd-principal').value,
        );
        const rate = parseFloat(document.getElementById('cd-rate').value);
        const startDate = document.getElementById('cd-start').value;
        const maturity = document.getElementById('cd-maturity').value;

        if (
            bank &&
            !isNaN(principal) &&
            !isNaN(rate) &&
            startDate &&
            maturity
        ) {
            state.cds.push({
                id: Date.now().toString(),
                bank: bank,
                principal: principal,
                rate: rate,
                startDate: startDate,
                maturity: maturity,
            });
            await saveState();
            refreshAllUI();
            form.reset();
            const _d = new Date();
            document.getElementById('cd-start').value = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
        }
    });
}

window.deleteCD = async function (id) {
    state.cds = state.cds.filter((cd) => cd.id !== id);
    await saveState();
    refreshAllUI();
};

window.startEditCD = function (id) {
    editingCDs.push(id);
    renderUnifiedHoldingsTable();
};

window.cancelEditCD = function (id) {
    editingCDs = editingCDs.filter((x) => x !== id);
    renderUnifiedHoldingsTable();
};

window.saveEditCD = async function (id) {
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

    const cdIndex = state.cds.findIndex((cd) => cd.id === id);
    if (cdIndex !== -1) {
        state.cds[cdIndex].bank = bank;
        state.cds[cdIndex].principal = principal;
        state.cds[cdIndex].rate = rate;
        state.cds[cdIndex].startDate = startDate;
        state.cds[cdIndex].maturity = maturity;

        editingCDs = editingCDs.filter((x) => x !== id);
        await saveState();
        refreshAllUI();
    }
};
