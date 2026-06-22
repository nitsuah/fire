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

    const inputs = [priceInput, costInput, shippingCharged, shippingActual, catRateInput, adRateInput];

    inputs.forEach(input => {
        input.addEventListener('input', calculateEbayProfit);
    });

    document.getElementById('btn-save-ebay-sale').addEventListener('click', async () => {
        const gross = parseFloat(priceInput.value) + parseFloat(shippingCharged.value);
        const fees = calculateEbayFeesTotal();
        const shippingCost = parseFloat(shippingActual.value);
        const costBasis = parseFloat(costInput.value);
        const netProfit = gross - fees - shippingCost - costBasis;

        state.sideGigLedger.push({
            id: Date.now().toString(),
            desc: `eBay Sale: $${priceInput.value} Item`,
            category: 'eBay',
            revenue: gross,
            expenses: fees + shippingCost + costBasis,
            net: netProfit
        });
        await saveState();
        refreshAllUI();
        alert('eBay sale successfully logged to Side Income history!');
    });

    const manualForm = document.getElementById('form-sidegig-manual');
    manualForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const desc = document.getElementById('sg-desc').value;
        const cat = document.getElementById('sg-cat').value;
        const revenue = parseFloat(document.getElementById('sg-revenue').value);
        const expense = parseFloat(document.getElementById('sg-expense').value) || 0;

        if (desc && !isNaN(revenue)) {
            state.sideGigLedger.push({
                id: Date.now().toString(),
                desc: desc,
                category: cat,
                revenue: revenue,
                expenses: expense,
                net: revenue - expense
            });
            await saveState();
            refreshAllUI();
            manualForm.reset();
        }
    });

    calculateEbayProfit();
}

function calculateEbayFeesTotal() {
    const price = parseFloat(document.getElementById('ebay-price').value) || 0;
    const shippingCharged = parseFloat(document.getElementById('ebay-shipping-charged').value) || 0;
    const categoryRate = parseFloat(document.getElementById('ebay-category-rate').value) / 100;
    const adRate = parseFloat(document.getElementById('ebay-ad-rate').value) / 100;

    const totalTransactionVal = price + shippingCharged;
    const standardFee = (totalTransactionVal * categoryRate) + 0.30;
    const adFee = totalTransactionVal * adRate;

    return standardFee + adFee;
}

function calculateEbayProfit() {
    const price = parseFloat(document.getElementById('ebay-price').value) || 0;
    const cost = parseFloat(document.getElementById('ebay-cost').value) || 0;
    const shippingCharged = parseFloat(document.getElementById('ebay-shipping-charged').value) || 0;
    const shippingActual = parseFloat(document.getElementById('ebay-shipping-actual').value) || 0;

    const gross = price + shippingCharged;
    const fees = calculateEbayFeesTotal();
    const netProfit = gross - fees - shippingActual - cost;
    const roi = cost > 0 ? (netProfit / cost) * 100 : 0;

    document.getElementById('ebay-res-gross').textContent = formatCurrency(gross);
    document.getElementById('ebay-res-fees').textContent = formatCurrency(fees);
    document.getElementById('ebay-res-profit').textContent = formatCurrency(netProfit);
    document.getElementById('ebay-res-roi').textContent = `${roi.toFixed(1)}%`;

    const profitBox = document.getElementById('ebay-res-profit');
    if (netProfit < 0) {
        profitBox.className = "result-value text-coral";
    } else {
        profitBox.className = "result-value text-emerald";
    }
}

window.deleteSideGigEntry = async function(id) {
    state.sideGigLedger = state.sideGigLedger.filter(sg => sg.id !== id);
    await saveState();
    refreshAllUI();
};

function initPlatformCalculators() {
    // Tab switching
    document.querySelectorAll('.platform-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.platform-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.platform-calc-panel').forEach(p => p.style.display = 'none');
            btn.classList.add('active');
            const panel = document.getElementById(`calc-panel-${btn.dataset.platform}`);
            if (panel) panel.style.display = '';
        });
    });

    // Etsy live calculation
    ['etsy-price', 'etsy-shipping-charged', 'etsy-shipping-actual', 'etsy-cost', 'etsy-ads-rate'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateEtsyProfit);
    });

    // FB live calculation
    ['fb-price', 'fb-shipping-actual', 'fb-cost', 'fb-is-shipped'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateFBProfit);
        document.getElementById(id)?.addEventListener('change', calculateFBProfit);
    });

    // Log buttons
    document.getElementById('btn-save-etsy-sale')?.addEventListener('click', async () => {
        const price = parseFloat(document.getElementById('etsy-price').value) || 0;
        const shipping = parseFloat(document.getElementById('etsy-shipping-charged').value) || 0;
        const shippingActual = parseFloat(document.getElementById('etsy-shipping-actual').value) || 0;
        const cost = parseFloat(document.getElementById('etsy-cost').value) || 0;
        const adsRate = parseFloat(document.getElementById('etsy-ads-rate').value) || 0;
        const fees = calculateEtsyFeesTotal(price, shipping, adsRate);
        const net = (price + shipping) - fees - shippingActual - cost;
        state.sideGigLedger.push({ id: Date.now().toString(), desc: `Etsy Sale: $${price} Item`, category: 'Etsy', revenue: price + shipping, expenses: fees + shippingActual + cost, net });
        await saveState();
        refreshAllUI();
        alert('Etsy sale logged to Side Income history!');
    });

    document.getElementById('btn-save-fb-sale')?.addEventListener('click', async () => {
        const price = parseFloat(document.getElementById('fb-price').value) || 0;
        const shippingActual = parseFloat(document.getElementById('fb-shipping-actual').value) || 0;
        const cost = parseFloat(document.getElementById('fb-cost').value) || 0;
        const isShipped = document.getElementById('fb-is-shipped')?.checked;
        const fees = calculateFBFeesTotal(price, isShipped);
        const net = price - fees - shippingActual - cost;
        state.sideGigLedger.push({ id: Date.now().toString(), desc: `FB Marketplace Sale: $${price} Item`, category: 'FB Marketplace', revenue: price, expenses: fees + shippingActual + cost, net });
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
    const listing = 0.20;
    const transaction = (p + s) * 0.065;
    const payment = (p + s) * 0.03 + 0.25;
    const ads = (p + s) * ((adsRate || 0) / 100);
    return listing + transaction + payment + ads;
}

function calculateEtsyProfit() {
    const price = parseFloat(document.getElementById('etsy-price')?.value) || 0;
    const shipping = parseFloat(document.getElementById('etsy-shipping-charged')?.value) || 0;
    const shippingActual = parseFloat(document.getElementById('etsy-shipping-actual')?.value) || 0;
    const cost = parseFloat(document.getElementById('etsy-cost')?.value) || 0;
    const adsRate = parseFloat(document.getElementById('etsy-ads-rate')?.value) || 0;

    const gross = price + shipping;
    const fees = calculateEtsyFeesTotal(price, shipping, adsRate);
    const net = gross - fees - shippingActual - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('etsy-res-gross', formatCurrency(gross));
    set('etsy-res-fees', formatCurrency(fees));
    set('etsy-res-profit', formatCurrency(net));
    set('etsy-res-roi', `${roi.toFixed(1)}%`);
    const profitEl = document.getElementById('etsy-res-profit');
    if (profitEl) profitEl.className = `result-value ${net < 0 ? 'text-coral' : 'text-emerald'}`;
}

function calculateFBFeesTotal(price, isShipped) {
    if (!isShipped) return 0;
    return Math.max((price || 0) * 0.05, 0.40);
}

function calculateFBProfit() {
    const price = parseFloat(document.getElementById('fb-price')?.value) || 0;
    const shippingActual = parseFloat(document.getElementById('fb-shipping-actual')?.value) || 0;
    const cost = parseFloat(document.getElementById('fb-cost')?.value) || 0;
    const isShipped = document.getElementById('fb-is-shipped')?.checked || false;

    const fees = calculateFBFeesTotal(price, isShipped);
    const net = price - fees - shippingActual - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('fb-res-gross', formatCurrency(price));
    set('fb-res-fees', formatCurrency(fees));
    set('fb-res-profit', formatCurrency(net));
    set('fb-res-roi', `${roi.toFixed(1)}%`);
    const profitEl = document.getElementById('fb-res-profit');
    if (profitEl) profitEl.className = `result-value ${net < 0 ? 'text-coral' : 'text-emerald'}`;

    const feeNote = document.getElementById('fb-fee-note');
    if (feeNote) feeNote.textContent = isShipped ? 'FB checkout fee: 5% (min $0.40)' : 'Local pickup — no selling fee';
}
