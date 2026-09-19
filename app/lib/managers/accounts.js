/* ==========================================================================
   managers/accounts.js — Custom account and imported file CRUD manager
   ========================================================================== */

// A crypto identifier is an ENS name, a 0x address, or an uppercase ticker.
function looksLikeCryptoIdentifier(s) {
    const v = (s || '').trim();
    return (
        /^0x[0-9a-fA-F]{40}$/.test(v) ||
        /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(v) ||
        /^[A-Z0-9]{2,6}$/.test(v)
    );
}

// Name and Identifier are interchangeable for Crypto: an ENS/address/ticker
// typed into either field is used for lookup, and a blank Name falls back to
// the identifier.
function normalizeCryptoNameAndIdentifier(nameRaw, identifierRaw) {
    let name = (nameRaw || '').trim();
    let identifier = (identifierRaw || '').trim();
    if (!identifier && looksLikeCryptoIdentifier(name)) {
        identifier = name;
    } else if (
        identifier &&
        !looksLikeCryptoIdentifier(identifier) &&
        looksLikeCryptoIdentifier(name)
    ) {
        [name, identifier] = [identifier, name];
    }
    if (!name) name = identifier;
    return { name, identifier };
}

function initAccountsManager() {
    const form = document.getElementById('form-custom-account');
    const accType = document.getElementById('acc-type');
    const apyGroup = document.getElementById('group-acc-apy');
    const cryptoGroup = document.getElementById('group-crypto-fields');
    const metalGroup = document.getElementById('group-metal-fields');
    const walletsGroup = document.getElementById('group-crypto-wallets');
    const nameInput = document.getElementById('acc-name');

    function updateTypeFields() {
        const t = accType.value;
        if (nameInput) {
            nameInput.required = t !== 'Crypto';
            nameInput.placeholder =
                t === 'Crypto'
                    ? 'Name, or an ENS / 0x address / ticker'
                    : 'e.g. Chase Savings';
        }
        if (walletsGroup)
            walletsGroup.style.display = t === 'Crypto' ? '' : 'none';
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
        // Metal-specific fields (weight in oz — value still starts as a
        // manually-entered estimate, same as Crypto, refreshed live after
        // creation via the "Refresh" button)
        if (metalGroup) metalGroup.style.display = t === 'Metal' ? '' : 'none';
    }

    updateTypeFields();
    accType.addEventListener('change', updateTypeFields);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nameRaw = document.getElementById('acc-name').value;
        const type = accType.value;
        const val = parseFloat(document.getElementById('acc-val').value);
        const apyRaw = document.getElementById('acc-apy').value;
        const apy =
            type === 'Savings' || type === 'Cash' || type === 'Crypto'
                ? parseFloat(apyRaw) || 0
                : 0;
        const cryptoIds =
            type === 'Crypto'
                ? normalizeCryptoNameAndIdentifier(
                      nameRaw,
                      document.getElementById('acc-identifier')?.value,
                  )
                : null;
        const name = cryptoIds ? cryptoIds.name : nameRaw.trim();
        const identifier = cryptoIds ? cryptoIds.identifier : '';
        const quantityRaw = document.getElementById('acc-quantity')?.value;
        const quantity =
            type === 'Crypto' && quantityRaw
                ? parseFloat(quantityRaw) || null
                : null;
        const metalType =
            type === 'Metal'
                ? document.getElementById('acc-metal-type')?.value || 'gold'
                : null;
        const weightOzRaw = document.getElementById('acc-weight-oz')?.value;
        const weightOz =
            type === 'Metal' && weightOzRaw
                ? parseFloat(weightOzRaw) || null
                : null;

        if (!name || isNaN(val)) return;
        if (type === 'Metal' && (weightOz === null || weightOz <= 0)) return;

        const entry = {
            id: Date.now().toString(),
            name,
            type,
            value: val,
            apy,
            ...(type === 'Crypto' && identifier ? { identifier } : {}),
            ...(type === 'Crypto' && quantity !== null ? { quantity } : {}),
            ...(type === 'Metal' ? { metalType, weightOz } : {}),
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

window.saveEditAccount = async function (id, triggerEl) {
    const nameInput = document.getElementById(`edit-acc-name-${id}`);
    const apyInput = document.getElementById(`edit-acc-apy-${id}`);
    const valInput = document.getElementById(`edit-acc-val-${id}`);
    const identifierInput = document.getElementById(
        `edit-acc-identifier-${id}`,
    );
    const quantityInput = document.getElementById(`edit-acc-quantity-${id}`);
    // Custom-accounts and unified-holdings tables both render this row's
    // edit inputs with the same ids, so read the Metal fields from the row
    // whose Save button was clicked.
    const row = triggerEl?.closest('tr');
    const metalTypeInput =
        row?.querySelector(`[id="edit-acc-metaltype-${id}"]`) ||
        document.getElementById(`edit-acc-metaltype-${id}`);
    const weightOzInput =
        row?.querySelector(`[id="edit-acc-weightoz-${id}"]`) ||
        document.getElementById(`edit-acc-weightoz-${id}`);

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
    const newWeightOz = weightOzInput ? parseFloat(weightOzInput.value) : null;
    if (
        cur.type === 'Metal' &&
        weightOzInput &&
        !(Number.isFinite(newWeightOz) && newWeightOz > 0)
    )
        return;
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
        ...(cur.type === 'Metal' && metalTypeInput
            ? { metalType: metalTypeInput.value }
            : {}),
        ...(cur.type === 'Metal' && weightOzInput
            ? { weightOz: newWeightOz }
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

window.refreshMetalAccount = async function (id) {
    const btns = document.querySelectorAll(`[data-metal-refresh-id="${id}"]`);
    btns.forEach((b) => {
        b.disabled = true;
        b.textContent = 'Refreshing…';
    });
    try {
        const { ok, data } = await fetchJson(
            `/api/accounts/${encodeURIComponent(id)}/refresh-metal`,
            { method: 'POST' },
        );
        if (!ok) {
            alert(data.error || 'Refresh failed');
            return;
        }

        const { metalResult: _mr, ...accountFields } = data;
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
