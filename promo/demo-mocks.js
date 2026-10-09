// Mocked market data for the fictional demo portfolio (demo-seed.js).
// Shared by the promo captures (capture.js) and the nightly journeys
// (tests/journeys), so neither depends on Yahoo being up and both show
// the same numbers.
const SEED = require('./demo-seed.js');

const PRICES = Object.fromEntries(
    SEED.importedPositions
        .filter((p) => p.lastPrice)
        .map((p) => [p.symbol, p.lastPrice]),
);

// Routes the app's price/metals calls to fixed quotes. Pass fetchedAt to
// pin the "Live · <time>" stamp (journeys do; captures use real time).
async function mockPrices(pg, { fetchedAt } = {}) {
    await pg.route('**/api/prices?*', (route) =>
        route.fulfill({
            json: Object.fromEntries(
                Object.entries(PRICES).map(([k, p]) => [
                    k,
                    {
                        price: p,
                        changePercent: 0.8,
                        fetchedAt: fetchedAt ?? Date.now(),
                    },
                ]),
            ),
        }),
    );
    await pg.route('**/api/prices/stream*', (route) => route.abort());
    await pg.route('**/api/metals', (route) =>
        route.fulfill({
            json: {
                gold: { price: 3800, payoutPct: 0.95, meltPrice: 3610 },
                silver: { price: 44, payoutPct: 0.88, meltPrice: 39 },
            },
        }),
    );
}

module.exports = { PRICES, mockPrices };
