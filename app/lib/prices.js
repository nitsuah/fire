/* ==========================================================================
   prices.js — Real-Time Stock Price Engine (+ Gold/Silver)
   Depends on globals: state, priceRefreshTimer, metalsRefreshTimer, refreshAllUI
   ========================================================================== */

// Persist only the price-derived fields of these items. Deliberately not
// saveState(): that posts this tab's whole state, so an older open tab
// would overwrite newer edits made elsewhere every refresh.
async function saveLiveValues({ positions = [], metals = [] }) {
    try {
        const res = await fetch('/api/state/live-values', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positions, metals }),
        });
        if (!res.ok)
            console.warn('[Prices] live-values save failed', res.status);
    } catch (err) {
        console.warn('[Prices] Could not save live values:', err);
    }
}

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

        const changed = [];
        const now = new Date().toISOString();
        state.importedPositions.forEach((pos) => {
            const cleanSym = pos.symbol.trim().replace(/\*+$/, '');
            if (prices[cleanSym]) {
                const newPrice = prices[cleanSym].price;
                if (newPrice && newPrice > 0) {
                    pos.lastPrice = newPrice;
                    pos.priceUpdatedAt = now;
                    // Recalculate current value based on quantity × new price
                    if (pos.quantity > 0) {
                        pos.value = pos.quantity * newPrice;
                    }
                    // Recalculate PnL from cost basis
                    if (pos.costBasis > 0) {
                        pos.pnlDollar = pos.value - pos.costBasis;
                        pos.pnlPercent = (pos.pnlDollar / pos.costBasis) * 100;
                    }
                    changed.push(pos);
                }
            }
        });

        if (changed.length) {
            await saveLiveValues({
                positions: changed.map((p) => ({
                    id: p.id,
                    lastPrice: p.lastPrice,
                    value: p.value,
                    pnlDollar: p.pnlDollar,
                    pnlPercent: p.pnlPercent,
                    priceUpdatedAt: p.priceUpdatedAt,
                })),
            });
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
    const metalAccounts = (state.customAccounts || []).filter(
        (a) => a.type === 'Metal',
    );
    if (metalAccounts.length === 0) return;

    try {
        const res = await fetch('/api/metals');
        if (!res.ok) return;
        const metals = await res.json();

        const changed = [];
        metalAccounts.forEach((acc) => {
            const quote = metals[acc.metalType?.toLowerCase()];
            if (!quote?.price || !(acc.weightOz > 0)) return;
            // Value at what a dealer pays (95% of spot for gold, 88% for
            // silver — set server-side), not full spot.
            const payoutPct = quote.payoutPct || 1;
            const newValue = quote.price * payoutPct * acc.weightOz;
            if (
                newValue !== acc.value ||
                acc.spotPricePerOz !== quote.price ||
                acc.payoutPct !== payoutPct
            ) {
                acc.value = newValue;
                acc.spotPricePerOz = quote.price;
                acc.payoutPct = payoutPct;
                acc.valueLastRefreshed = new Date().toISOString();
                changed.push(acc);
            }
        });

        if (changed.length) {
            await saveLiveValues({
                metals: changed.map((a) => ({
                    id: a.id,
                    value: a.value,
                    spotPricePerOz: a.spotPricePerOz,
                    payoutPct: a.payoutPct,
                    valueLastRefreshed: a.valueLastRefreshed,
                })),
            });
            refreshAllUI();
            console.log(
                '[Metals] Updated metal account values from spot prices.',
            );
        }
    } catch (err) {
        console.warn('[Metals] Could not fetch spot prices:', err);
    }
}
