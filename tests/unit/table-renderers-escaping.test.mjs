import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// Table and projection renderers are classic browser scripts. They are loaded
// into a stubbed browser context (same approach as fixed-income-table-escaping
// .test.mjs) and the markup they assign to innerHTML is checked for inert output.
const APP_LIB = path.join(__dirname, '../../app/lib');

const MARKUP = '<img src=x onerror=alert(1)>"quoted"';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;&quot;quoted&quot;';

const formatCurrency = (val) => {
    const num = Number(val);
    if (isNaN(num)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
    }).format(num);
};

const makeNode = () => ({
    innerHTML: '',
    textContent: '',
    hidden: false,
    style: {},
    dataset: {},
    classList: {
        add() {},
        remove() {},
        toggle() {},
        contains: () => false,
    },
    querySelectorAll: () => [],
    addEventListener() {},
});

// Loads the given app/lib scripts (html-utils.js first, for escHtml) into one
// context. `extra` overrides or adds globals such as state and editing lists.
function load(files, extra = {}) {
    const nodes = new Map();
    const node = (key) => {
        if (!nodes.has(key)) nodes.set(key, makeNode());
        return nodes.get(key);
    };
    const ctx = {
        state: {},
        editingAccounts: [],
        editingCDs: [],
        editingVehicles: [],
        editingRealEstate: [],
        formatCurrency,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: {
            querySelector: (sel) => node(sel),
            querySelectorAll: () => [],
            getElementById: (id) => node(id),
            addEventListener() {},
        },
        window: {},
        ...extra,
    };
    vm.createContext(ctx);
    for (const f of files) {
        vm.runInContext(fs.readFileSync(path.join(APP_LIB, f), 'utf8'), ctx);
    }
    return {
        ctx,
        run: (code) => vm.runInContext(code, ctx),
        html: (key) => nodes.get(key)?.innerHTML ?? '',
    };
}

// Hostile text must reach the DOM only as escaped text or attribute values:
// no <img> element is created, and the quoted text is not left raw.
function expectInert(markup) {
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('"quoted"');
    expect(markup).toContain(ESCAPED);
}

const FI_FILES = ['html-utils.js', 'tables/fixed-income.js'];

describe('fixed-income table renderers', () => {
    const fixedIncome = (state = {}, editing = {}) =>
        load(FI_FILES, {
            state: {
                importedFiles: [],
                customAccounts: [],
                cds: [],
                ...state,
            },
            editingAccounts: editing.accounts ?? [],
            editingCDs: editing.cds ?? [],
        });

    it('renderCustomAccountsTable escapes stored names, identifiers, quantities and ids', () => {
        const env = fixedIncome({
            customAccounts: [
                {
                    id: MARKUP,
                    name: MARKUP,
                    type: 'Crypto',
                    value: 100,
                    apy: 1,
                    identifier: MARKUP,
                    quantity: MARKUP,
                },
            ],
        });
        env.run('renderCustomAccountsTable()');
        expectInert(env.html('#table-custom-accounts tbody'));
    });

    it('renderCustomAccountsTable escapes values in edit mode', () => {
        const env = fixedIncome(
            {
                customAccounts: [
                    {
                        id: MARKUP,
                        name: MARKUP,
                        type: 'Crypto',
                        value: 100,
                        apy: 1,
                        identifier: MARKUP,
                        quantity: MARKUP,
                    },
                    {
                        id: 'metal-1',
                        name: 'Gold bar',
                        type: 'Metal',
                        metalType: 'gold',
                        value: 500,
                        weightOz: MARKUP,
                    },
                ],
            },
            { accounts: [MARKUP, 'metal-1'] },
        );
        env.run('renderCustomAccountsTable()');
        expectInert(env.html('#table-custom-accounts tbody'));
    });

    it('renderCustomAccountsTable still renders an ordinary account', () => {
        const env = fixedIncome({
            customAccounts: [
                {
                    id: 'acc-1',
                    name: 'Ally Savings',
                    type: 'Savings',
                    value: 1200,
                    apy: 4.5,
                },
            ],
        });
        env.run('renderCustomAccountsTable()');
        const markup = env.html('#table-custom-accounts tbody');
        expect(markup).toContain('Ally Savings');
        expect(markup).toContain('4.50%');
        expect(markup).toContain('$1,200.00');
        expect(markup).toContain('data-csp-click-value="acc-1"');
    });

    it('renderCDTable escapes bank, dates and ids in view mode', () => {
        const env = fixedIncome({
            cds: [
                {
                    id: MARKUP,
                    bank: MARKUP,
                    principal: 1000,
                    rate: 4,
                    startDate: MARKUP,
                    maturity: MARKUP,
                },
            ],
        });
        env.run('renderCDTable()');
        expectInert(env.html('#table-cd-list tbody'));
    });

    it('renderCDTable escapes bank, dates and ids in edit mode', () => {
        const env = fixedIncome(
            {
                cds: [
                    {
                        id: MARKUP,
                        bank: MARKUP,
                        principal: 1000,
                        rate: 4,
                        startDate: MARKUP,
                        maturity: MARKUP,
                    },
                ],
            },
            { cds: [MARKUP] },
        );
        env.run('renderCDTable()');
        expectInert(env.html('#table-cd-list tbody'));
    });

    it('renderCDTable still renders an ordinary CD', () => {
        const env = fixedIncome({
            cds: [
                {
                    id: 'cd-1',
                    bank: 'Capital One',
                    principal: 10000,
                    rate: 4.5,
                    startDate: '2025-01-01',
                    maturity: '2099-01-01',
                },
            ],
        });
        env.run('renderCDTable()');
        const markup = env.html('#table-cd-list tbody');
        expect(markup).toContain('Capital One');
        expect(markup).toContain('2099-01-01');
        expect(markup).toContain('4.50%');
        expect(markup).toContain('Active');
    });

    it('renderUnifiedHoldingsTable escapes stored text in view mode', () => {
        const env = fixedIncome({
            customAccounts: [
                {
                    id: MARKUP,
                    name: MARKUP,
                    type: 'Crypto',
                    value: 100,
                    apy: 1,
                    identifier: MARKUP,
                    quantity: MARKUP,
                },
            ],
            cds: [
                {
                    id: MARKUP,
                    bank: MARKUP,
                    principal: 1000,
                    rate: 4,
                    startDate: MARKUP,
                    maturity: MARKUP,
                },
            ],
        });
        env.run('renderUnifiedHoldingsTable()');
        expectInert(env.html('#table-unified-holdings tbody'));
    });

    it('renderUnifiedHoldingsTable escapes stored text in edit mode', () => {
        const env = fixedIncome(
            {
                customAccounts: [
                    {
                        id: MARKUP,
                        name: MARKUP,
                        type: 'Crypto',
                        value: 100,
                        apy: 1,
                        identifier: MARKUP,
                        quantity: MARKUP,
                    },
                ],
                cds: [
                    {
                        id: MARKUP,
                        bank: MARKUP,
                        principal: 1000,
                        rate: 4,
                        startDate: MARKUP,
                        maturity: MARKUP,
                    },
                ],
            },
            { accounts: [MARKUP], cds: [MARKUP] },
        );
        env.run('renderUnifiedHoldingsTable()');
        expectInert(env.html('#table-unified-holdings tbody'));
    });
});

describe('tax-harvest renderer', () => {
    it('renderTaxHarvestTable escapes symbol and description', () => {
        const env = load(['html-utils.js', 'tables/tax-harvest.js'], {
            state: {
                importedPositions: [
                    {
                        symbol: MARKUP,
                        description: MARKUP,
                        value: 50,
                        costBasis: 100,
                    },
                ],
                taxRate: 20,
            },
        });
        env.run('window.renderTaxHarvestTable()');
        expectInert(env.html('tbody-tax-harvest'));
        expect(env.html('tax-harvest-summary')).not.toContain('<img');
    });

    it('renderTaxHarvestTable still renders an ordinary loss', () => {
        const env = load(['html-utils.js', 'tables/tax-harvest.js'], {
            state: {
                importedPositions: [
                    {
                        symbol: 'VTI',
                        description: 'Total Market',
                        value: 50,
                        costBasis: 100,
                    },
                ],
                taxRate: 20,
            },
        });
        env.run('window.renderTaxHarvestTable()');
        const markup = env.html('tbody-tax-harvest');
        expect(markup).toContain('VTI');
        expect(markup).toContain('Total Market');
        expect(markup).toContain('-$50.00');
    });
});

describe('vehicles table renderer', () => {
    const vehicle = (over = {}) => ({
        id: 'veh-1',
        year: 2019,
        make: 'Honda',
        model: 'Civic',
        trim: '',
        condition: 'Good',
        mileage: 42000,
        currentValue: 12000,
        loanBalance: 0,
        purchasePrice: 20000,
        vin: '',
        ...over,
    });

    it('renderVehiclesTable escapes stored text and numeric fields in view mode', () => {
        const env = load(['html-utils.js', 'tables/vehicles.js'], {
            state: {
                vehicles: [
                    vehicle({
                        id: MARKUP,
                        make: MARKUP,
                        model: MARKUP,
                        condition: MARKUP,
                        mileage: MARKUP,
                    }),
                ],
            },
        });
        env.run('renderVehiclesTable()');
        expectInert(env.html('#table-vehicles tbody'));
    });

    it('renderVehiclesTable escapes values in edit mode', () => {
        const env = load(['html-utils.js', 'tables/vehicles.js'], {
            state: {
                vehicles: [
                    vehicle({
                        id: MARKUP,
                        year: MARKUP,
                        make: MARKUP,
                        model: MARKUP,
                        vin: MARKUP,
                        mileage: MARKUP,
                        currentValue: MARKUP,
                        loanBalance: MARKUP,
                        purchasePrice: MARKUP,
                    }),
                ],
            },
            editingVehicles: [MARKUP],
        });
        env.run('renderVehiclesTable()');
        expectInert(env.html('#table-vehicles tbody'));
    });

    it('renderVehiclesTable still renders an ordinary vehicle', () => {
        const env = load(['html-utils.js', 'tables/vehicles.js'], {
            state: { vehicles: [vehicle()] },
        });
        env.run('renderVehiclesTable()');
        const markup = env.html('#table-vehicles tbody');
        expect(markup).toContain('Honda Civic');
        expect(markup).toContain('42,000 mi');
        expect(markup).toContain('Paid Off');
        expect(markup).toContain('id="veh-est-btn-veh-1"');
    });
});

describe('real-estate table renderer', () => {
    const property = (over = {}) => ({
        id: 'home-1',
        name: 'Duplex',
        type: 'Rental',
        address: '12 Elm St',
        marketValue: 300000,
        mortgageBalance: 200000,
        purchasePrice: 250000,
        monthlyPayment: 1500,
        ...over,
    });

    it('renderRealEstateTable escapes stored text in view mode', () => {
        const env = load(['html-utils.js', 'tables/real-estate.js'], {
            state: {
                realEstate: [
                    property({
                        id: MARKUP,
                        name: MARKUP,
                        type: MARKUP,
                        address: MARKUP,
                    }),
                ],
            },
        });
        env.run('renderRealEstateTable()');
        expectInert(env.html('#table-real-estate tbody'));
    });

    it('renderRealEstateTable escapes ids and numeric fields in edit mode', () => {
        const env = load(['html-utils.js', 'tables/real-estate.js'], {
            state: {
                realEstate: [
                    property({
                        id: MARKUP,
                        name: MARKUP,
                        address: MARKUP,
                        marketValue: MARKUP,
                        mortgageBalance: MARKUP,
                        purchasePrice: MARKUP,
                        monthlyPayment: MARKUP,
                    }),
                ],
            },
            editingRealEstate: [MARKUP],
        });
        env.run('renderRealEstateTable()');
        expectInert(env.html('#table-real-estate tbody'));
    });

    it('renderRealEstateTable still renders an ordinary property', () => {
        const env = load(['html-utils.js', 'tables/real-estate.js'], {
            state: { realEstate: [property()] },
        });
        env.run('renderRealEstateTable()');
        const markup = env.html('#table-real-estate tbody');
        expect(markup).toContain('Duplex');
        expect(markup).toContain('12 Elm St');
        expect(markup).toContain('+$50,000.00');
    });
});

describe('positions table renderer', () => {
    const positionsEnv = (positions) =>
        load(['html-utils.js', 'tables/positions.js'], {
            state: { importedPositions: positions },
            collapsedAccounts: {},
            tableSortColumn: 'value',
            tableSortDir: 'desc',
            getPortfolioDayChange: () => 0,
            sortPositions: (list) => list,
            isSettledCash: () => false,
            pnlColorStyle: () => 'color:var(--color-success)',
            updateSortHeaders() {},
            updateCollapseAllButtonLabel() {},
            renderDiversificationSuggestions() {},
            window: {
                matchMedia: () => ({ matches: false, addEventListener() {} }),
            },
        });

    it('renderDashboardTopPositionsTable escapes stored text and quantities', () => {
        const env = positionsEnv([
            {
                account: MARKUP,
                symbol: MARKUP,
                description: MARKUP,
                quantity: MARKUP,
                lastPrice: 10,
                value: 1000,
                costBasis: 900,
                pnlDollar: 100,
                pnlPercent: 11.1,
                id: MARKUP,
            },
        ]);
        env.run('renderDashboardTopPositionsTable()');
        expectInert(env.html('#table-dashboard-positions tbody'));
    });

    it('renderDashboardTopPositionsTable still renders an ordinary position', () => {
        const env = positionsEnv([
            {
                account: 'Fidelity',
                symbol: 'VTI',
                description: 'Total Market ETF',
                quantity: 12.5,
                lastPrice: 100,
                value: 1250,
                costBasis: 1000,
                pnlDollar: 250,
                pnlPercent: 25,
                id: 'pos-1',
            },
        ]);
        env.run('renderDashboardTopPositionsTable()');
        const markup = env.html('#table-dashboard-positions tbody');
        expect(markup).toContain('VTI');
        expect(markup).toContain('Fidelity');
        expect(markup).toContain('12.5');
    });
});

describe('projections mitigations renderer', () => {
    const mitigationsEnv = (mitigations) =>
        load(['html-utils.js', 'projections.js'], {
            chaosMitigations: [],
            window: {
                FireChaos: {
                    CATALOG: [{ id: 'ev-1', icon: '🔥', label: MARKUP }],
                    MITIGATIONS: mitigations,
                },
            },
        });

    it('renderMitigations escapes mitigation ids, labels and tips', () => {
        const env = mitigationsEnv([
            {
                id: MARKUP,
                label: MARKUP,
                icon: '🛡️',
                tip: MARKUP,
                covers: ['ev-1'],
                part: 'bill',
            },
        ]);
        env.run('renderMitigations({ labels: ["2030"] })');
        expectInert(env.html('chaos-mitigations'));
    });

    it('renderMitigations still renders an ordinary mitigation', () => {
        const env = mitigationsEnv([
            {
                id: 'ins-health',
                label: 'Health insurance',
                icon: '🩺',
                tip: 'Covers medical bills',
                covers: ['ev-1'],
                part: 'bill',
                premium: 1200,
            },
        ]);
        env.run('renderMitigations({ labels: ["2030"] })');
        const markup = env.html('chaos-mitigations');
        expect(markup).toContain('Health insurance');
        expect(markup).toContain('Covers medical bills');
        expect(markup).toContain('~$100/mo');
        expect(markup).toContain('data-mitigation="ins-health"');
    });
});

describe('projections table renderers', () => {
    const projectionsEnv = (settings, networth = 1e9) =>
        load(
            ['html-utils.js', 'projections.js', 'tables/projections-table.js'],
            {
                state: { projectionSettings: settings },
                getAggregateNetWorth: () => networth,
                getAnnualExpensesTotal: () => 40000,
            },
        );

    const baseSettings = (over = {}) => ({
        currentAge: 30,
        retireAge: 60,
        annualSavings: 0,
        expectedReturn: 5,
        inflationRate: 2,
        swr: 4,
        ...over,
    });

    it('renderScenarioComparison escapes the FIRE age', () => {
        const env = projectionsEnv(baseSettings({ currentAge: MARKUP }));
        env.run('renderScenarioComparison()');
        expectInert(env.html('scenario-comparison-container'));
    });

    it('renderScenarioComparison still renders ordinary ages', () => {
        const env = projectionsEnv(baseSettings());
        env.run('renderScenarioComparison()');
        const markup = env.html('scenario-comparison-container');
        expect(markup).toContain('Age 30');
        expect(markup).toContain('0 yrs');
    });

    const milestoneRaw = (chaos) => ({
        fireNumber: 1e6,
        realReturn: 0.04,
        networth: 1000,
        annualExpenses: 40000,
        savings: 10000,
        nwData: chaos ? [1000, 2e6] : [1000],
        chaos,
    });

    it('renderMilestones escapes the estimated age', () => {
        const env = projectionsEnv(baseSettings({ currentAge: MARKUP }));
        env.ctx.buildProjectionData = () => milestoneRaw(false);
        env.run('renderMilestones(1000, 1e6, 0.04, 10000, null)');
        expectInert(env.html('projection-milestones-container'));
    });

    it('renderMilestones escapes the chaos-mode age', () => {
        const env = projectionsEnv(baseSettings({ currentAge: MARKUP }));
        env.ctx.buildProjectionData = () => milestoneRaw(true);
        env.run('renderMilestones(1000, 1e6, 0.04, 10000, null)');
        expectInert(env.html('projection-milestones-container'));
    });

    it('renderMilestones still renders an ordinary estimate', () => {
        const env = projectionsEnv(baseSettings());
        env.ctx.buildProjectionData = () => milestoneRaw(false);
        env.run('renderMilestones(1000, 1e6, 0.04, 10000, null)');
        expect(env.html('projection-milestones-container')).toContain(
            '(Age 32)',
        );
    });
});
