/* ==========================================================================
   prices.js — Real-Time Stock Price Engine
   Depends on globals: state, priceRefreshTimer, saveState, refreshAllUI
   ========================================================================== */

function schedulePriceRefresh() {
    fetchAndApplyPrices();
    if (priceRefreshTimer) clearInterval(priceRefreshTimer);
    priceRefreshTimer = setInterval(fetchAndApplyPrices, 5 * 60 * 1000);
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
