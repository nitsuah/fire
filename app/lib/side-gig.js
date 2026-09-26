/* ==========================================================================
   side-gig.js — Side Hustle Hub Manager & Platform Fee Calculators
   Depends on globals: state, saveState, refreshAllUI, formatCurrency
   ========================================================================== */

function initSideGigManager() {
    const priceInput = document.getElementById('ebay-price');
    const costInput = document.getElementById('ebay-cost');
    const shippingCharged = document.getElementById('ebay-shipping-charged');
    const shippingActual = document.getElementById('ebay-shipping-actual');
    const catRateInput = document.getElementById('ebay-category-rate');
    const adRateInput = document.getElementById('ebay-ad-rate');

    const inputs = [
        priceInput,
        costInput,
        shippingCharged,
        shippingActual,
        catRateInput,
        adRateInput,
    ];

    inputs.forEach((input) => {
        input.addEventListener('input', calculateEbayProfit);
    });

    document
        .getElementById('btn-save-ebay-sale')
        .addEventListener('click', async () => {
            const gross =
                parseFloat(priceInput.value) +
                parseFloat(shippingCharged.value);
            const fees = calculateEbayFeesTotal();
            const shippingCost = parseFloat(shippingActual.value);
            const costBasis = parseFloat(costInput.value);
            const netProfit = gross - fees - shippingCost - costBasis;

            // Item cost is kept out of `expenses` so tax tagging can apply it
            // as cost basis (see side-gig-tax.js).
            state.sideGigLedger.push({
                id: Date.now().toString(),
                date: localIsoDate(),
                desc: `eBay Sale: $${priceInput.value} Item`,
                category: 'eBay',
                revenue: gross,
                expenses: fees + shippingCost,
                costBasis,
                basisType: 'business',
                net: netProfit,
            });
            await saveState();
            refreshAllUI();
            alert('eBay sale successfully logged to Side Income history!');
        });

    // eBay OAuth Integration
    const ebayOauthBtn = document.getElementById('btn-ebay-oauth');
    if (ebayOauthBtn) {
        ebayOauthBtn.addEventListener('click', () => {
            window.location.assign('/api/sync/ebay/authorize');
        });
    }

    // Check eBay connection status on load
    checkEbayConnection();

    // Check Plaid connection status on load
    checkPlaidConnection();

    // Initialize Plaid Link
    initPlaidLink();

    const manualForm = document.getElementById('form-sidegig-manual');
    manualForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const desc = document.getElementById('sg-desc').value;
        const cat = document.getElementById('sg-cat').value;
        const revenue = parseFloat(document.getElementById('sg-revenue').value);
        const expense =
            parseFloat(document.getElementById('sg-expense').value) || 0;
        const basisType = document.getElementById('sg-basis').value;
        const costRaw = document.getElementById('sg-cost').value;
        const costBasis = costRaw === '' ? null : parseFloat(costRaw);

        if (desc && !isNaN(revenue)) {
            state.sideGigLedger.push({
                id: Date.now().toString(),
                date: localIsoDate(),
                desc: desc,
                category: cat,
                revenue: revenue,
                expenses: expense,
                ...(basisType ? { basisType } : {}),
                ...(costBasis !== null && !isNaN(costBasis)
                    ? { costBasis }
                    : {}),
                net: revenue - expense - (costBasis || 0),
            });
            await saveState();
            refreshAllUI();
            manualForm.reset();
        }
    });

    initSideGigLedgerActions();
    calculateEbayProfit();
}

async function checkEbayConnection() {
    const statusEl = document.getElementById('ebay-sync-status');
    if (!statusEl) return;
    try {
        const res = await fetch('/api/sync/ebay/status');
        const data = await res.json();
        if (data.connected) {
            statusEl.textContent = `Status: Connected (Last sync: ${new Date(data.lastSync).toLocaleDateString()})`;
            statusEl.style.color = 'var(--color-success)';
        } else {
            statusEl.textContent = 'Status: Disconnected';
            statusEl.style.color = 'var(--text-muted)';
        }
    } catch (err) {
        statusEl.textContent = 'Status: Error checking connection';
        statusEl.style.color = 'var(--color-danger)';
    }
}

// Settings tab — eBay Sync card. Reads/writes the server-side
// `ebaySyncEnabled` gate via /api/sync/ebay/*; the OAuth connect flow itself
// stays on the Financial Overview card (checkEbayConnection above).
async function loadEbaySettingsPanel() {
    const toggle = document.getElementById('setting-ebay-sync-enabled');
    const statusEl = document.getElementById('settings-ebay-status');
    const syncBtn = document.getElementById('btn-ebay-sync-now');
    if (!toggle || !statusEl) return;
    try {
        const res = await fetch('/api/sync/ebay/status');
        const data = await res.json();
        toggle.checked = data.syncEnabled !== false;
        const lastSyncText = data.lastSync
            ? new Date(data.lastSync).toLocaleString()
            : 'never';
        if (!data.connected) {
            statusEl.textContent =
                'Not connected — use the eBay Seller API card in Financial Overview to connect your account first.';
            statusEl.style.color = 'var(--text-muted)';
        } else {
            statusEl.textContent = `Connected · Last sync: ${lastSyncText}`;
            statusEl.style.color = 'var(--color-success)';
        }
        if (syncBtn) syncBtn.disabled = !data.connected || !toggle.checked;
    } catch (err) {
        statusEl.textContent = 'Unable to check eBay sync status.';
        statusEl.style.color = 'var(--color-danger)';
    }
}

async function toggleEbaySyncSetting() {
    const toggle = document.getElementById('setting-ebay-sync-enabled');
    if (!toggle) return;
    const enabled = toggle.checked;
    try {
        const res = await fetch('/api/sync/ebay/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            alert(d.error || 'Failed to update eBay sync setting.');
            toggle.checked = !enabled;
            return;
        }
    } catch (err) {
        alert('Failed to update eBay sync setting: ' + err.message);
        toggle.checked = !enabled;
        return;
    }
    loadEbaySettingsPanel();
}

async function runEbaySyncNow() {
    const btn = document.getElementById('btn-ebay-sync-now');
    const statusEl = document.getElementById('settings-ebay-status');
    if (!btn) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Syncing…';
    try {
        const res = await fetch('/api/sync/ebay/sync', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sync failed');
        if (statusEl) {
            statusEl.textContent = `Synced ${data.added} new order${data.added === 1 ? '' : 's'} of ${data.fetched} fetched.`;
            statusEl.style.color = 'var(--color-success)';
        }
        if (typeof refreshAllUI === 'function') refreshAllUI();
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `Sync failed: ${err.message}`;
            statusEl.style.color = 'var(--color-danger)';
        }
    } finally {
        btn.textContent = original;
        loadEbaySettingsPanel();
    }
}

async function checkPlaidConnection() {
    const statusEl = document.getElementById('plaid-sync-status');
    if (!statusEl) return;
    try {
        const res = await fetch('/api/sync/plaid/status');
        const data = await res.json();
        if (data.connected) {
            statusEl.textContent = `Status: Linked (${data.itemCount} account${data.itemCount !== 1 ? 's' : ''})`;
            statusEl.style.color = 'var(--color-success)';
        } else {
            statusEl.textContent = 'Status: Not Linked';
            statusEl.style.color = 'var(--text-muted)';
        }
        // Plaid "active" = linked AND not manually paused in Settings.
        // Disables the Fidelity CSV importer while true to prevent
        // duplicate expense entries from both sources.
        if (typeof setFidelityImportDisabled === 'function') {
            setFidelityImportDisabled(
                data.connected && data.syncEnabled !== false,
            );
        }
    } catch (err) {
        statusEl.textContent = 'Status: Error checking connection';
        statusEl.style.color = 'var(--color-danger)';
    }
}

let plaidLinkHandler = null;

function initPlaidLink() {
    const linkBtn = document.getElementById('btn-plaid-link');
    if (!linkBtn) return;

    linkBtn.addEventListener('click', async () => {
        const statusEl = document.getElementById('plaid-sync-status');
        statusEl.textContent = 'Status: Opening Plaid Link...';
        statusEl.style.color = 'var(--color-warning)';

        try {
            const res = await fetch('/api/sync/plaid/create-link-token');
            const data = await res.json();

            if (!data.linkToken) {
                throw new Error(data.error || 'Failed to create link token');
            }

            // Initialize Plaid Link
            if (plaidLinkHandler) {
                plaidLinkHandler.destroy();
            }

            plaidLinkHandler = Plaid.create({
                token: data.linkToken,
                onSuccess: async (public_token, metadata) => {
                    statusEl.textContent = 'Status: Exchanging token...';
                    statusEl.style.color = 'var(--color-warning)';

                    try {
                        const exchangeRes = await fetch(
                            '/api/sync/plaid/exchange',
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ public_token }),
                            },
                        );
                        const exchangeData = await exchangeRes.json();

                        if (exchangeData.status === 'success') {
                            const accountsRes = await fetch(
                                '/api/sync/plaid/accounts',
                                { method: 'POST' },
                            );
                            if (!accountsRes.ok)
                                throw new Error('Account sync failed');
                            const positionsRes = await fetch(
                                '/api/sync/plaid/positions',
                                { method: 'POST' },
                            );
                            if (!positionsRes.ok)
                                throw new Error('Position sync failed');
                            await checkPlaidConnection();
                            refreshAllUI();
                        } else {
                            throw new Error(
                                exchangeData.error || 'Token exchange failed',
                            );
                        }
                    } catch (err) {
                        statusEl.textContent = `Status: Error - ${err.message}`;
                        statusEl.style.color = 'var(--color-danger)';
                    }
                },
                onExit: (err, metadata) => {
                    if (err) {
                        statusEl.textContent = `Status: ${err.error_message || 'Cancelled'}`;
                        statusEl.style.color = 'var(--color-danger)';
                    } else {
                        statusEl.textContent = 'Status: Not Linked';
                        statusEl.style.color = 'var(--text-muted)';
                    }
                },
                onEvent: (eventName, metadata) => {
                    console.log('[Plaid Link Event]', eventName, metadata);
                },
            });

            plaidLinkHandler.open();
        } catch (err) {
            statusEl.textContent = `Status: Error - ${err.message}`;
            statusEl.style.color = 'var(--color-danger)';
        }
    });
}

// Settings tab — Plaid Sync card. Reads/writes the server-side
// `plaidSyncEnabled` gate via /api/sync/plaid/*; the Link/connect flow
// itself stays on the Financial Overview card (checkPlaidConnection above).
// Mirrors loadEbaySettingsPanel above.
async function loadPlaidSettingsPanel() {
    const toggle = document.getElementById('setting-plaid-sync-enabled');
    const statusEl = document.getElementById('settings-plaid-status');
    const syncBtn = document.getElementById('btn-plaid-sync-now');
    if (!toggle || !statusEl) return;
    try {
        const res = await fetch('/api/sync/plaid/status');
        const data = await res.json();
        toggle.checked = data.syncEnabled !== false;
        if (!data.connected) {
            statusEl.textContent =
                'Not connected — use the Plaid Investments card in Financial Overview to link an account first.';
            statusEl.style.color = 'var(--text-muted)';
        } else {
            const lastSyncText = data.lastTransactionsSync
                ? new Date(data.lastTransactionsSync).toLocaleString()
                : 'never';
            statusEl.textContent = `Linked (${data.itemCount} account${data.itemCount !== 1 ? 's' : ''}) · Last sync: ${lastSyncText}`;
            statusEl.style.color = 'var(--color-success)';
        }
        if (syncBtn) syncBtn.disabled = !data.connected || !toggle.checked;
        if (typeof setFidelityImportDisabled === 'function') {
            setFidelityImportDisabled(
                data.connected && data.syncEnabled !== false,
            );
        }
    } catch (err) {
        statusEl.textContent = 'Unable to check Plaid sync status.';
        statusEl.style.color = 'var(--color-danger)';
    }
}

async function togglePlaidSyncSetting() {
    const toggle = document.getElementById('setting-plaid-sync-enabled');
    if (!toggle) return;
    const enabled = toggle.checked;
    try {
        const res = await fetch('/api/sync/plaid/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            alert(d.error || 'Failed to update Plaid sync setting.');
            toggle.checked = !enabled;
            return;
        }
    } catch (err) {
        alert('Failed to update Plaid sync setting: ' + err.message);
        toggle.checked = !enabled;
        return;
    }
    loadPlaidSettingsPanel();
}

async function runPlaidTransactionsSyncNow() {
    const btn = document.getElementById('btn-plaid-sync-now');
    const statusEl = document.getElementById('settings-plaid-status');
    if (!btn) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Syncing…';
    try {
        const res = await fetch('/api/sync/plaid/transactions', {
            method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sync failed');
        if (statusEl) {
            statusEl.textContent = `Synced ${data.added} new transaction${data.added === 1 ? '' : 's'} of ${data.fetched} fetched.`;
            statusEl.style.color = 'var(--color-success)';
        }
        if (typeof refreshAllUI === 'function') refreshAllUI();
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = `Sync failed: ${err.message}`;
            statusEl.style.color = 'var(--color-danger)';
        }
    } finally {
        btn.textContent = original;
        loadPlaidSettingsPanel();
    }
}

function calculateEbayFeesTotal() {
    const price = parseFloat(document.getElementById('ebay-price').value) || 0;
    const shippingCharged =
        parseFloat(document.getElementById('ebay-shipping-charged').value) || 0;
    const categoryRate =
        parseFloat(document.getElementById('ebay-category-rate').value) / 100;
    const adRate =
        parseFloat(document.getElementById('ebay-ad-rate').value) / 100;

    const totalTransactionVal = price + shippingCharged;
    // eBay's per-order fee is $0.30 for orders of $10.00 or less, $0.40 above
    // that — not a flat $0.30 regardless of order size.
    const orderFee = totalTransactionVal > 10 ? 0.4 : 0.3;
    const standardFee = totalTransactionVal * categoryRate + orderFee;
    const adFee = totalTransactionVal * adRate;

    return standardFee + adFee;
}

function calculateEbayProfit() {
    const price = parseFloat(document.getElementById('ebay-price').value) || 0;
    const cost = parseFloat(document.getElementById('ebay-cost').value) || 0;
    const shippingCharged =
        parseFloat(document.getElementById('ebay-shipping-charged').value) || 0;
    const shippingActual =
        parseFloat(document.getElementById('ebay-shipping-actual').value) || 0;

    const gross = price + shippingCharged;
    const fees = calculateEbayFeesTotal();
    const netProfit = gross - fees - shippingActual - cost;
    const roi = cost > 0 ? (netProfit / cost) * 100 : 0;

    document.getElementById('ebay-res-gross').textContent =
        formatCurrency(gross);
    document.getElementById('ebay-res-fees').textContent = formatCurrency(fees);
    document.getElementById('ebay-res-profit').textContent =
        formatCurrency(netProfit);
    document.getElementById('ebay-res-roi').textContent = `${roi.toFixed(1)}%`;

    const profitBox = document.getElementById('ebay-res-profit');
    if (netProfit < 0) {
        profitBox.className = 'result-value text-coral';
    } else {
        profitBox.className = 'result-value text-emerald';
    }
}

// Inline edits from the ledger table: tag how an item was acquired, and its
// cost basis (blank = unknown).
window.updateSideGigTax = async function (id, field, value) {
    const idx = state.sideGigLedger.findIndex((sg) => sg.id === id);
    if (idx < 0) return;
    const entry = state.sideGigLedger[idx];
    if (field === 'basisType') {
        if (value) entry.basisType = value;
        else delete entry.basisType;
    } else if (field === 'costBasis') {
        state.sideGigLedger[idx] = applyCostBasis(entry, value);
    }
    await saveState();
    refreshAllUI();
};

// Delegated so ledger ids never end up inside inline JS handlers.
function initSideGigLedgerActions() {
    document
        .getElementById('btn-sg-bulk-tag')
        ?.addEventListener('click', async () => {
            const basis = document.getElementById('sg-bulk-basis')?.value;
            const { ledger, tagged } = tagUntaggedSales(
                state.sideGigLedger,
                basis,
            );
            if (!tagged) {
                alert('Every sale already has a tax tag.');
                return;
            }
            state.sideGigLedger = ledger;
            await saveState();
            refreshAllUI();
        });
    document
        .getElementById('sg-filter-missing-cost')
        ?.addEventListener('change', () => renderSideGigLedgerTable());

    const table = document.getElementById('table-sidegig-history');
    if (!table) return;
    // Fast cost entry: Enter saves this item's cost and jumps to the next
    // row's cost box (the change handler below does the saving).
    table.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const input = e.target.closest('.sg-cost-input');
        if (!input) return;
        e.preventDefault();
        const inputs = [...table.querySelectorAll('.sg-cost-input')];
        const nextId = inputs[inputs.indexOf(input) + 1]?.dataset.sgId;
        input.blur(); // fires change → save → re-render
        if (nextId) {
            setTimeout(() => {
                const next = [...table.querySelectorAll('.sg-cost-input')].find(
                    (el) => el.dataset.sgId === nextId,
                );
                next?.focus();
                next?.select();
            }, 150);
        }
    });
    table.addEventListener('change', (e) => {
        const el = e.target.closest('[data-sg-field]');
        if (el) updateSideGigTax(el.dataset.sgId, el.dataset.sgField, el.value);
    });
    table.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sg-delete]');
        if (btn) deleteSideGigEntry(btn.dataset.sgDelete);
    });
}

window.deleteSideGigEntry = async function (id) {
    state.sideGigLedger = state.sideGigLedger.filter((sg) => sg.id !== id);
    await saveState();
    refreshAllUI();
};

// Import an eBay Seller Hub listings sales report into the Side Gig Ledger.
// Returns true when the text was an eBay report (even if nothing was new).
async function importEbayReportText(text, fileName) {
    const report = parseEbayListingsReport(parseCSVText(text));
    if (!report) return false;
    if (!report.range) {
        alert(
            'Could not read the report date range ("Report for … to …"), so it was not imported.',
        );
        return true;
    }
    if (report.items.length === 0) {
        alert('That eBay report has no sales rows to import.');
        return true;
    }
    const before = state.sideGigLedger;
    const merged = mergeEbayReport(before, report);
    state.sideGigLedger = merged.ledger;
    try {
        await saveState();
    } catch (err) {
        state.sideGigLedger = before;
        console.error('Failed to save eBay report import:', err);
        alert('Could not save the eBay import.');
        return true;
    }
    refreshAllUI();
    const parts = [`${merged.added} added`];
    if (merged.replaced)
        parts.push(`${merged.replaced} updated from a newer report`);
    if (merged.updated)
        parts.push(`${merged.updated} re-imported with corrected amounts`);
    if (merged.skipped) parts.push(`${merged.skipped} already imported`);
    alert(`eBay report ${fileName || ''}: ${parts.join(', ')}.`);
    return true;
}

function initEbayReportUpload() {
    const btn = document.getElementById('btn-ebay-report-upload');
    const input = document.getElementById('ebay-report-input');
    if (!btn || !input) return;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            const ok = await importEbayReportText(await file.text(), file.name);
            if (!ok) alert('That file is not an eBay listings sales report.');
        } catch (err) {
            console.error('Failed to read eBay report:', err);
            alert('Could not read that file.');
        } finally {
            input.value = '';
        }
    });
}

function initPlatformCalculators() {
    initEbayReportUpload();
    // Tab switching
    document.querySelectorAll('.platform-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document
                .querySelectorAll('.platform-tab-btn')
                .forEach((b) => b.classList.remove('active'));
            document
                .querySelectorAll('.platform-calc-panel')
                .forEach((p) => (p.style.display = 'none'));
            btn.classList.add('active');
            const panel = document.getElementById(
                `calc-panel-${btn.dataset.platform}`,
            );
            if (panel) panel.style.display = '';
        });
    });

    // Etsy live calculation
    [
        'etsy-price',
        'etsy-shipping-charged',
        'etsy-shipping-actual',
        'etsy-cost',
        'etsy-ads-rate',
    ].forEach((id) => {
        document
            .getElementById(id)
            ?.addEventListener('input', calculateEtsyProfit);
    });

    // FB live calculation
    ['fb-price', 'fb-shipping-actual', 'fb-cost', 'fb-is-shipped'].forEach(
        (id) => {
            document
                .getElementById(id)
                ?.addEventListener('input', calculateFBProfit);
            document
                .getElementById(id)
                ?.addEventListener('change', calculateFBProfit);
        },
    );

    // Log buttons
    document
        .getElementById('btn-save-etsy-sale')
        ?.addEventListener('click', async () => {
            const price =
                parseFloat(document.getElementById('etsy-price').value) || 0;
            const shipping =
                parseFloat(
                    document.getElementById('etsy-shipping-charged').value,
                ) || 0;
            const shippingActual =
                parseFloat(
                    document.getElementById('etsy-shipping-actual').value,
                ) || 0;
            const cost =
                parseFloat(document.getElementById('etsy-cost').value) || 0;
            const adsRate =
                parseFloat(document.getElementById('etsy-ads-rate').value) || 0;
            const fees = calculateEtsyFeesTotal(price, shipping, adsRate);
            const net = price + shipping - fees - shippingActual - cost;
            state.sideGigLedger.push({
                id: Date.now().toString(),
                desc: `Etsy Sale: $${price} Item`,
                category: 'Etsy',
                revenue: price + shipping,
                expenses: fees + shippingActual + cost,
                net,
            });
            await saveState();
            refreshAllUI();
            alert('Etsy sale logged to Side Income history!');
        });

    document
        .getElementById('btn-save-fb-sale')
        ?.addEventListener('click', async () => {
            const price =
                parseFloat(document.getElementById('fb-price').value) || 0;
            const shippingActual =
                parseFloat(
                    document.getElementById('fb-shipping-actual').value,
                ) || 0;
            const cost =
                parseFloat(document.getElementById('fb-cost').value) || 0;
            const isShipped = document.getElementById('fb-is-shipped')?.checked;
            const fees = calculateFBFeesTotal(price, isShipped);
            const net = price - fees - shippingActual - cost;
            state.sideGigLedger.push({
                id: Date.now().toString(),
                desc: `FB Marketplace Sale: $${price} Item`,
                category: 'FB Marketplace',
                revenue: price,
                expenses: fees + shippingActual + cost,
                net,
            });
            await saveState();
            refreshAllUI();
            alert('FB Marketplace sale logged to Side Income history!');
        });

    calculateEtsyProfit();
    calculateFBProfit();
}

function calculateEtsyFeesTotal(price, shipping, adsRate) {
    const p = price || 0;
    const s = shipping || 0;
    const listing = 0.2;
    const transaction = (p + s) * 0.065;
    const payment = (p + s) * 0.03 + 0.25;
    const ads = (p + s) * ((adsRate || 0) / 100);
    return listing + transaction + payment + ads;
}

function calculateEtsyProfit() {
    const price = parseFloat(document.getElementById('etsy-price')?.value) || 0;
    const shipping =
        parseFloat(document.getElementById('etsy-shipping-charged')?.value) ||
        0;
    const shippingActual =
        parseFloat(document.getElementById('etsy-shipping-actual')?.value) || 0;
    const cost = parseFloat(document.getElementById('etsy-cost')?.value) || 0;
    const adsRate =
        parseFloat(document.getElementById('etsy-ads-rate')?.value) || 0;

    const gross = price + shipping;
    const fees = calculateEtsyFeesTotal(price, shipping, adsRate);
    const net = gross - fees - shippingActual - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('etsy-res-gross', formatCurrency(gross));
    set('etsy-res-fees', formatCurrency(fees));
    set('etsy-res-profit', formatCurrency(net));
    set('etsy-res-roi', `${roi.toFixed(1)}%`);
    const profitEl = document.getElementById('etsy-res-profit');
    if (profitEl)
        profitEl.className = `result-value ${net < 0 ? 'text-coral' : 'text-emerald'}`;
}

function calculateFBFeesTotal(price, isShipped) {
    if (!isShipped) return 0;
    return Math.max((price || 0) * 0.05, 0.4);
}

function calculateFBProfit() {
    const price = parseFloat(document.getElementById('fb-price')?.value) || 0;
    const shippingActual =
        parseFloat(document.getElementById('fb-shipping-actual')?.value) || 0;
    const cost = parseFloat(document.getElementById('fb-cost')?.value) || 0;
    const isShipped =
        document.getElementById('fb-is-shipped')?.checked || false;

    const fees = calculateFBFeesTotal(price, isShipped);
    const net = price - fees - shippingActual - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('fb-res-gross', formatCurrency(price));
    set('fb-res-fees', formatCurrency(fees));
    set('fb-res-profit', formatCurrency(net));
    set('fb-res-roi', `${roi.toFixed(1)}%`);
    const profitEl = document.getElementById('fb-res-profit');
    if (profitEl)
        profitEl.className = `result-value ${net < 0 ? 'text-coral' : 'text-emerald'}`;

    const feeNote = document.getElementById('fb-fee-note');
    if (feeNote)
        feeNote.textContent = isShipped
            ? 'FB checkout fee: 5% (min $0.40)'
            : 'Local pickup — no selling fee';
}
