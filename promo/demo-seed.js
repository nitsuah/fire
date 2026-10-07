// Demo portfolio used for every promo capture. Fictional numbers: never
// point the promo pipeline at data/db.json. Edit here to change what the
// dashboard, tables, charts and MCP output show.
const pos = (symbol, description, quantity, lastPrice, costBasis) => ({
    id: 'p-' + symbol,
    account: 'Fidelity Brokerage',
    symbol,
    description,
    quantity,
    lastPrice,
    value: +(quantity * lastPrice).toFixed(2),
    costBasis,
    pnlDollar: +(quantity * lastPrice - costBasis).toFixed(2),
    pnlPercent: +(
        ((quantity * lastPrice - costBasis) / costBasis) *
        100
    ).toFixed(2),
});
const history = [];
for (let i = 364; i >= 0; i--) {
    const d = new Date(Date.UTC(2026, 8, 27) - i * 864e5);
    const t = (364 - i) / 364;
    const total =
        214000 + t * 64000 + Math.sin(i / 11) * 3500 + Math.sin(i / 37) * 6000;
    history.push({
        date: d.toISOString().slice(0, 10),
        total: Math.round(total),
    });
}
const SEED = {
    importedPositions: [
        pos('VTI', 'VANGUARD TOTAL STOCK MKT ETF', 310, 312.4, 71200),
        pos('VXUS', 'VANGUARD TOTAL INTL STOCK ETF', 420, 68.1, 25100),
        pos('NVDA', 'NVIDIA CORP', 60, 181.2, 4300),
        pos('AAPL', 'APPLE INC', 45, 241.5, 8200),
        // Bought high: the one losing position, for the Tax-Loss Harvesting card.
        pos('SCHD', 'SCHWAB US DIVIDEND EQUITY ETF', 380, 28.4, 12900),
        {
            id: 'p-spaxx',
            account: 'Fidelity Brokerage',
            symbol: 'SPAXX**',
            description: 'HELD IN MONEY MARKET',
            quantity: 0,
            lastPrice: 0,
            value: 6200,
            costBasis: 0,
        },
    ],
    customAccounts: [
        {
            id: 'hysa',
            name: 'High-Yield Savings',
            type: 'Savings',
            value: 24000,
            apy: 4.2,
        },
        { id: 'chk', name: 'Checking', type: 'Cash', value: 4800, apy: 0 },
        {
            id: 'roth',
            name: 'Roth IRA',
            type: 'Brokerage',
            value: 41500,
            apy: 0,
        },
        { id: 'eth', name: 'vitalik.eth', type: 'Crypto', value: 5200, apy: 0 },
        {
            id: 'gold',
            name: 'Gold Eagles',
            type: 'Metal',
            metalType: 'gold',
            weightOz: 2,
            value: 7600,
            apy: 0,
        },
    ],
    cds: [
        {
            id: 'cd1',
            bank: 'Ally',
            principal: 15000,
            rate: 4.35,
            startDate: '2026-02-01',
            maturity: '2026-11-01',
        },
        {
            id: 'cd2',
            bank: 'Marcus',
            principal: 10000,
            rate: 4.1,
            startDate: '2026-04-15',
            maturity: '2027-04-15',
        },
        {
            id: 'cd3',
            bank: 'Discover',
            principal: 10000,
            rate: 3.9,
            startDate: '2026-06-01',
            maturity: '2027-12-01',
        },
    ],
    realEstate: [],
    vehicles: [
        {
            id: 'car',
            year: 2014,
            make: 'Chevy',
            model: 'Malibu',
            currentValue: 6000,
            loanBalance: 0,
            condition: 'Good',
            mileage: 128000,
        },
    ],
    sideGigLedger: [
        {
            id: 'sg1',
            date: '2026-09-02',
            desc: 'Nintendo Switch OLED',
            category: 'eBay',
            revenue: 265,
            expenses: 38,
            net: 227,
        },
        {
            id: 'sg2',
            date: '2026-09-09',
            desc: "Vintage Levi's 501",
            category: 'eBay',
            revenue: 72,
            expenses: 11,
            net: 61,
        },
        {
            id: 'sg3',
            date: '2026-09-15',
            desc: 'Mechanical keyboard',
            category: 'Facebook',
            revenue: 90,
            expenses: 0,
            net: 90,
        },
        {
            id: 'sg4',
            date: '2026-09-21',
            desc: 'Pokémon card lot',
            category: 'eBay',
            revenue: 140,
            expenses: 21,
            net: 119,
        },
    ],
    expenses: {
        housing: 1650,
        utilities: 210,
        food: 520,
        transport: 180,
        healthcare: 140,
        discretionary: 400,
    },
    projectionSettings: {
        annualSavings: 38000,
        expectedReturn: 8,
        inflationRate: 2.5,
        swr: 4,
        spanYears: 30,
        currentAge: 32,
        retireAge: 45,
    },
    notificationSettings: { enabled: false },
    netWorthHistory: history,
};

module.exports = SEED;
