/* ==========================================================================
   prices.js — Real-Time Stock Price Engine (+ Gold/Silver)
   Depends on globals: state, priceRefreshTimer, metalsRefreshTimer, saveState, refreshAllUI
   ========================================================================== */

function schedulePriceRefresh() {
    fetchAndApplyPrices();
    if (priceRefreshTimer) clearInterval(priceRefreshTimer);
    priceRefreshTimer = setInterval(fetchAndApplyPrices, 5 * 60 * 1000);
}

function scheduleMetalsRefresh() {
    fetchAndApplyMetals();
    if (metalsRefreshTimer) clearInterval(metalsRefreshTimer);
    metalsRefreshTimer = setInterval(fetchAndApplyMetals, 5 * 60 * 1000);
}

async function fetchAndApplyPrices() {
    if (state.importedPositions.length === 0) return;

    // Collect unique non-cash equity symbols
    const symbols = [
        ...new Set(
            state.importedPositions
                .filter(
                    (p) =>
                        p.symbol &&
                        !p.symbol.includes('SPAXX') &&
                        !p.symbol.includes('FDRXX') &&
                        !p.description?.includes('MONEY MARKET'),
                )
                .map((p) => p.symbol.trim().replace(/\*+$/, ''))
                .filter((s) => s.length > 0 && !/^\d/.test(s)),
        ),
    ];

    if (symbols.length === 0) return;

    try {
        const res = await fetch(
            `/api/prices?symbols=${encodeURIComponent(symbols.join(','))}`,
        );
        if (!res.ok) return;
        const prices = await res.json();

        let updated = false;
        state.importedPositions.forEach((pos) => {
            const cleanSym = pos.symbol.trim().replace(/\*+$/, '');
            if (prices[cleanSym]) {
                const newPrice = prices[cleanSym].price;
                if (newPrice && newPrice > 0) {
                    pos.lastPrice = newPrice;
                    // Recalculate current value based on quantity × new price
                    if (pos.quantity > 0) {
                        pos.value = pos.quantity * newPrice;
                    }
                    // Recalculate PnL from cost basis
                    if (pos.costBasis > 0) {
                        pos.pnlDollar = pos.value - pos.costBasis;
                        pos.pnlPercent = (pos.pnlDollar / pos.costBasis) * 100;
                    }
                    updated = true;
                }
            }
        });

        if (updated) {
            // Silently save & re-render without full alert spam
            await saveState();
            refreshAllUI();
            console.log(
                `[Prices] Updated ${symbols.length} symbols from Yahoo Finance.`,
            );
        }
    } catch (err) {
        console.warn('[Prices] Could not fetch real-time quotes:', err);
    }
}

async function fetchAndApplyMetals() {
    const metalAccounts = (state.customAccounts || []).filter((a) => a.type === 'Metal');
    if (metalAccounts.length === 0) return;

    try {
        const res = await fetch('/api/metals');
        if (!res.ok) return;
        const metals = await res.json();

        let updated = false;
        metalAccounts.forEach((acc) => {
            const metal = acc.metalType?.toLowerCase();
            if (metals[metal] && metals[metal].price) {
                const pricePerOz = metals[metal].price;
                const weightOz = acc.weightOz || 0;
                const newValue = pricePerOz * weightOz;
                if (newValue !== acc.value) {
                    acc.value = newValue;
                    acc.valueLastRefreshed = new Date().toISOString();
                    updated = true;
                }
            }
        });

        if (updated) {
            await saveState();
            refreshAllUI();
            console.log('[Metals] Updated metal account values from spot prices.');
        }
    } catch (err) {
        console.warn('[Metals] Could not fetch spot prices:', err);
    }
}
