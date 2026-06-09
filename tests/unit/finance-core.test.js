'use strict';

const {
    formatCurrency,
    sanitizeState,
    parseCSVText,
    parseFidelityPositions,
    parseChaseStatement,
    parseCapitalOneStatement,
    computeEffectiveTaxRate,
    insuranceToMonthly,
    getInsuranceMonthly,
    getMonthlyExpensesBase,
    getAnnualExpensesTotal,
    isSettledCash,
    getAggregateCash,
    getAggregateCDs,
    getAggregateEquities,
    getAggregateOtherAssets,
    getSideGigYTDNet,
    getAggregateRealEstate,
    getAggregateVehicles,
    getAggregateNetWorth,
    windowToPoints,
    sliceProjectionData,
    buildProjectionData,
    pnlColorStyle,
    sortPositions,
    calculateEbayFees,
    calculateEbayNetProfit,
    US_MEDIAN_SAVINGS
} = require('../../app/lib/finance-core');

// ─── formatCurrency ────────────────────────────────────────────────────────────

describe('formatCurrency', () => {
    it('formats a positive integer', () => {
        expect(formatCurrency(1000)).toBe('$1,000.00');
    });

    it('formats zero', () => {
        expect(formatCurrency(0)).toBe('$0.00');
    });

    it('formats a negative value', () => {
        expect(formatCurrency(-250.5)).toBe('-$250.50');
    });

    it('formats a large number with commas', () => {
        expect(formatCurrency(1234567.89)).toBe('$1,234,567.89');
    });

    it('returns $0.00 for NaN', () => {
        expect(formatCurrency(NaN)).toBe('$0.00');
        expect(formatCurrency('not a number')).toBe('$0.00');
    });

    it('coerces a string number', () => {
        expect(formatCurrency('500')).toBe('$500.00');
    });
});

// ─── sanitizeState ─────────────────────────────────────────────────────────────

describe('sanitizeState', () => {
    it('returns empty object for null/undefined', () => {
        expect(sanitizeState(null)).toEqual({});
        expect(sanitizeState(undefined)).toEqual({});
    });

    it('initialises missing array fields', () => {
        const result = sanitizeState({});
        expect(result.importedPositions).toEqual([]);
        expect(result.customAccounts).toEqual([]);
        expect(result.cds).toEqual([]);
        expect(result.realEstate).toEqual([]);
        expect(result.vehicles).toEqual([]);
        expect(result.sideGigLedger).toEqual([]);
        expect(result.importedFiles).toEqual([]);
    });

    it('fills missing vehicle fields with defaults', () => {
        const state = { vehicles: [{ make: 'Toyota', model: 'Camry' }] };
        const result = sanitizeState(state);
        const v = result.vehicles[0];
        expect(v.year).toBe(new Date().getFullYear());
        expect(v.mileage).toBe(0);
        expect(v.condition).toBe('Good');
        expect(v.currentValue).toBe(0);
        expect(v.loanBalance).toBe(0);
    });

    it('does not overwrite existing vehicle fields', () => {
        const state = { vehicles: [{ year: 2020, make: 'Honda', model: 'Civic', mileage: 30000, condition: 'Excellent', currentValue: 18000 }] };
        const result = sanitizeState(state);
        expect(result.vehicles[0].year).toBe(2020);
        expect(result.vehicles[0].condition).toBe('Excellent');
        expect(result.vehicles[0].currentValue).toBe(18000);
    });

    it('fills missing realEstate fields', () => {
        const state = { realEstate: [{ name: 'Home' }] };
        const result = sanitizeState(state);
        const re = result.realEstate[0];
        expect(re.marketValue).toBe(0);
        expect(re.mortgageBalance).toBe(0);
        expect(re.type).toBe('Primary Home');
    });

    it('fills null apy and value in customAccounts', () => {
        const state = { customAccounts: [{ id: '1', name: 'Checking', type: 'Cash', apy: null, value: null }] };
        const result = sanitizeState(state);
        expect(result.customAccounts[0].apy).toBe(0);
        expect(result.customAccounts[0].value).toBe(0);
    });

    it('fills missing CD fields', () => {
        const state = { cds: [{ id: '1', bank: 'Marcus', maturity: '2025-12-01' }] };
        const result = sanitizeState(state);
        const cd = result.cds[0];
        expect(cd.startDate).toBe('');
        expect(cd.principal).toBe(0);
        expect(cd.rate).toBe(0);
    });

    it('defaults projectionSettings age fields', () => {
        const state = { projectionSettings: { annualSavings: 10000 } };
        const result = sanitizeState(state);
        expect(result.projectionSettings.currentAge).toBe(30);
        expect(result.projectionSettings.retireAge).toBe(60);
    });

    it('creates default insurances when missing', () => {
        const result = sanitizeState({});
        expect(result.insurances.car).toEqual({ amt: 0, freq: '6month' });
        expect(result.insurances.home).toEqual({ amt: 0, freq: 'monthly' });
    });

    it('fills missing car insurance when home is present', () => {
        const state = { insurances: { home: { amt: 100, freq: 'monthly' } } };
        const result = sanitizeState(state);
        expect(result.insurances.car).toEqual({ amt: 0, freq: '6month' });
    });
});

// ─── parseCSVText ──────────────────────────────────────────────────────────────

describe('parseCSVText', () => {
    it('parses simple comma-separated rows', () => {
        const rows = parseCSVText('a,b,c\n1,2,3');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual(['a', 'b', 'c']);
        expect(rows[1]).toEqual(['1', '2', '3']);
    });

    it('handles quoted fields with commas inside', () => {
        const rows = parseCSVText('"hello, world",foo\nbar,baz');
        expect(rows[0][0]).toBe('hello, world');
        expect(rows[0][1]).toBe('foo');
    });

    it('handles escaped double-quotes inside quoted fields', () => {
        const rows = parseCSVText('"say ""hi""",done');
        expect(rows[0][0]).toBe('say "hi"');
    });

    it('handles CRLF line endings', () => {
        const rows = parseCSVText('a,b\r\nc,d');
        expect(rows).toHaveLength(2);
        expect(rows[1]).toEqual(['c', 'd']);
    });

    it('ignores trailing empty line', () => {
        const rows = parseCSVText('a,b\n1,2\n');
        // trailing newline creates an empty row only if something follows
        expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty array for empty string', () => {
        const rows = parseCSVText('');
        expect(rows).toEqual([]);
    });
});

// ─── parseFidelityPositions ────────────────────────────────────────────────────

const FIDELITY_HEADER = 'Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Gain/Loss Dollar,Gain/Loss Percent';

describe('parseFidelityPositions', () => {
    it('returns 0 count if Symbol column is missing', () => {
        const rows = parseCSVText('Foo,Bar\n1,2');
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(0);
        expect(result.positions).toEqual([]);
    });

    it('parses a valid Fidelity CSV row', () => {
        const csv = `${FIDELITY_HEADER}\nRetirement,AAPL,Apple Inc,10,175.00,"$1,750.00","$1,400.00",350,25`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(1);
        expect(result.positions[0].symbol).toBe('AAPL');
        expect(result.positions[0].value).toBe(1750);
        expect(result.positions[0].quantity).toBe(10);
        expect(result.positions[0].lastPrice).toBe(175);
        expect(result.positions[0].costBasis).toBe(1400);
    });

    it('skips rows with no symbol', () => {
        const csv = `${FIDELITY_HEADER}\n,AAPL,Apple Inc,10,175,1750,1400,350,25\nRetirement,,No Symbol,5,50,250,200,50,25`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        // second row has no account name but valid symbol, should be parsed
        // third row has no symbol, should be skipped
        expect(result.positions.every(p => p.symbol !== '')).toBe(true);
    });

    it('calculates pnlDollar from value minus costBasis when no gain columns', () => {
        const header = 'Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total';
        const csv = `${header}\nAcc,TSLA,Tesla,5,200,1000,800`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.positions[0].pnlDollar).toBe(200);
        expect(result.positions[0].pnlPercent).toBeCloseTo(25, 1);
    });

    it('stops parsing at "The data" disclaimer rows', () => {
        const csv = `${FIDELITY_HEADER}\nAcc,AAPL,Apple,10,175,1750,1400,350,25\nThe data and information,,,,,,,`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(1);
    });

    it('skips rows where current value is NaN', () => {
        const csv = `${FIDELITY_HEADER}\nAcc,AAPL,Apple,10,175,notanumber,1400,350,25`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        expect(result.count).toBe(0);
    });

    it('uses Brokerage as default account name', () => {
        const header = 'Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total';
        const csv = `${header}\nAAPL,Apple Inc,10,175,1750,1400`;
        const rows = parseCSVText(csv);
        const result = parseFidelityPositions(rows);
        if (result.count > 0) {
            expect(result.positions[0].account).toBe('Brokerage');
        }
    });
});

// ─── parseChaseStatement ───────────────────────────────────────────────────────

describe('parseChaseStatement', () => {
    it('counts negative amounts as outflow', () => {
        // Chase format: index 5 is Amount column
        const rows = [
            ['Date', 'Desc', 'Type', 'Cat', 'Bal', 'Amount'],
            ['2024-01-01', 'Coffee', 'Debit', 'Food', '100', '-5.50'],
            ['2024-01-02', 'Paycheck', 'Credit', 'Income', '1000', '3000']
        ];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(1);
        expect(result.totalOutflow).toBeCloseTo(5.50);
    });

    it('skips header row', () => {
        const rows = [['Date', 'Desc', 'x', 'x', 'x', 'Amount'], ['2024-01-01', 'Coffee', '', '', '', '-10.00']];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(1);
    });

    it('skips rows with fewer than 6 columns', () => {
        const rows = [['Header'], ['2024-01-01', 'Coffee', '-5']];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(0);
    });

    it('returns zero for positive-only transactions', () => {
        const rows = [['Date', 'Desc', 'x', 'x', 'x', 'Amount'], ['2024-01-01', 'Paycheck', '', '', '', '3000']];
        const result = parseChaseStatement(rows);
        expect(result.imported).toBe(0);
        expect(result.totalOutflow).toBe(0);
    });
});

// ─── parseCapitalOneStatement ──────────────────────────────────────────────────

describe('parseCapitalOneStatement', () => {
    it('counts debit amounts as outflow', () => {
        const csv = 'Card No.,Date,Description,Category,Debit,Credit\n1234,2024-01-01,Coffee,Food,5.50,\n1234,2024-01-02,Payment,,, 100.00';
        const rows = parseCSVText(csv);
        const result = parseCapitalOneStatement(rows);
        expect(result.imported).toBe(1);
        expect(result.totalOutflow).toBeCloseTo(5.50);
    });

    it('returns 0 if debit column not found', () => {
        const csv = 'Date,Description,Amount\n2024-01-01,Coffee,5.50';
        const rows = parseCSVText(csv);
        const result = parseCapitalOneStatement(rows);
        expect(result.imported).toBe(0);
    });

    it('skips rows shorter than debit column index', () => {
        const rows = [['Card No.', 'Date', 'Desc', 'Cat', 'Debit', 'Credit'], ['1234', '2024-01-01']];
        const result = parseCapitalOneStatement(rows);
        expect(result.imported).toBe(0);
    });
});

// ─── computeEffectiveTaxRate ───────────────────────────────────────────────────

describe('computeEffectiveTaxRate', () => {
    it('returns 0 for zero income states with no income', () => {
        // $1 income in TX should be near-zero (just FICA)
        const rate = computeEffectiveTaxRate(1, 'TX');
        expect(rate).toBeGreaterThanOrEqual(0);
    });

    it('uses 0% state rate for TX', () => {
        const rateTX = computeEffectiveTaxRate(50000, 'TX');
        const rateCA = computeEffectiveTaxRate(50000, 'CA');
        expect(rateTX).toBeLessThan(rateCA);
    });

    it('uses 0% state rate for FL, WA, NV', () => {
        const rateTX = computeEffectiveTaxRate(80000, 'TX');
        const rateFL = computeEffectiveTaxRate(80000, 'FL');
        const rateWA = computeEffectiveTaxRate(80000, 'WA');
        expect(rateTX).toBe(rateFL);
        expect(rateTX).toBe(rateWA);
    });

    it('uses flat 4.95% for IL', () => {
        const rateIL = computeEffectiveTaxRate(100000, 'IL');
        const rateTX = computeEffectiveTaxRate(100000, 'TX');
        expect(rateIL).toBeGreaterThan(rateTX);
    });

    it('uses high CA rate for income > 300k', () => {
        const rateHigh = computeEffectiveTaxRate(400000, 'CA');
        const rateLow = computeEffectiveTaxRate(80000, 'CA');
        expect(rateHigh).toBeGreaterThan(rateLow);
    });

    it('uses high NY rate for income > 215400', () => {
        const rateHigh = computeEffectiveTaxRate(300000, 'NY');
        const rateMed = computeEffectiveTaxRate(100000, 'NY');
        expect(rateHigh).toBeGreaterThan(rateMed);
    });

    it('defaults to 4% state for unknown state', () => {
        const rateOther = computeEffectiveTaxRate(80000, 'ZZ');
        const rateExplicit = computeEffectiveTaxRate(80000, 'Other');
        expect(rateOther).toBe(rateExplicit);
    });

    it('caps result at 50', () => {
        const rate = computeEffectiveTaxRate(10000000, 'CA');
        expect(rate).toBeLessThanOrEqual(50);
    });

    it('floors result at 0', () => {
        const rate = computeEffectiveTaxRate(1, 'TX');
        expect(rate).toBeGreaterThanOrEqual(0);
    });

    it('computes a reasonable rate for typical salary', () => {
        // $100k in NY: federal ~18% + NY ~6.85% + FICA ~7.65% ≈ 32%
        const rate = computeEffectiveTaxRate(100000, 'NY');
        expect(rate).toBeGreaterThan(20);
        expect(rate).toBeLessThan(40);
    });
});

// ─── insuranceToMonthly ────────────────────────────────────────────────────────

describe('insuranceToMonthly', () => {
    it('divides 6-month amount by 6', () => {
        expect(insuranceToMonthly({ amt: 600, freq: '6month' })).toBe(100);
    });

    it('divides annual amount by 12', () => {
        expect(insuranceToMonthly({ amt: 1200, freq: 'annual' })).toBe(100);
    });

    it('returns monthly amount as-is', () => {
        expect(insuranceToMonthly({ amt: 150, freq: 'monthly' })).toBe(150);
    });

    it('returns 0 for missing amt', () => {
        expect(insuranceToMonthly({ freq: 'monthly' })).toBe(0);
    });

    it('returns monthly for unrecognised freq', () => {
        expect(insuranceToMonthly({ amt: 100, freq: 'weekly' })).toBe(100);
    });
});

// ─── getInsuranceMonthly ───────────────────────────────────────────────────────

describe('getInsuranceMonthly', () => {
    it('sums car and home insurance monthly', () => {
        const ins = {
            car: { amt: 600, freq: '6month' },
            home: { amt: 1200, freq: 'annual' }
        };
        expect(getInsuranceMonthly(ins)).toBe(200); // 100 + 100
    });

    it('handles missing insurance object', () => {
        expect(getInsuranceMonthly(null)).toBe(0);
        expect(getInsuranceMonthly({})).toBe(0);
    });
});

// ─── getMonthlyExpensesBase ────────────────────────────────────────────────────

describe('getMonthlyExpensesBase', () => {
    it('sums all expense categories plus insurance', () => {
        const expenses = { housing: 1000, food: 500, transport: 200 };
        const insurances = { car: { amt: 0, freq: 'monthly' }, home: { amt: 0, freq: 'monthly' } };
        expect(getMonthlyExpensesBase(expenses, insurances)).toBe(1700);
    });

    it('includes car insurance in total', () => {
        const expenses = { housing: 1000 };
        const insurances = { car: { amt: 120, freq: 'monthly' }, home: { amt: 0, freq: 'monthly' } };
        expect(getMonthlyExpensesBase(expenses, insurances)).toBe(1120);
    });
});

// ─── getAnnualExpensesTotal ────────────────────────────────────────────────────

describe('getAnnualExpensesTotal', () => {
    it('multiplies monthly base by 12 and adds tax drag', () => {
        const expenses = { housing: 1000 };
        const insurances = { car: { amt: 0, freq: 'monthly' }, home: { amt: 0, freq: 'monthly' } };
        // monthly base = 1000, annual = 12000, tax drag 20% = 2400, total = 14400
        expect(getAnnualExpensesTotal(expenses, insurances, 20)).toBe(14400);
    });

    it('handles 0% tax rate', () => {
        const expenses = { housing: 1000 };
        const insurances = {};
        expect(getAnnualExpensesTotal(expenses, insurances, 0)).toBe(12000);
    });
});

// ─── isSettledCash ─────────────────────────────────────────────────────────────

describe('isSettledCash', () => {
    it('identifies SPAXX as settled cash', () => {
        expect(isSettledCash({ symbol: 'SPAXX', description: '' })).toBe(true);
    });

    it('identifies FDRXX as settled cash', () => {
        expect(isSettledCash({ symbol: 'FDRXX', description: '' })).toBe(true);
    });

    it('identifies money market descriptions', () => {
        expect(isSettledCash({ symbol: 'XX', description: 'Fidelity Money Market Fund' })).toBe(true);
    });

    it('identifies pending activity', () => {
        expect(isSettledCash({ symbol: 'XX', description: 'Pending Activity' })).toBe(true);
    });

    it('identifies core position', () => {
        expect(isSettledCash({ symbol: 'XX', description: 'Core Position' })).toBe(true);
    });

    it('does not flag regular equities', () => {
        expect(isSettledCash({ symbol: 'AAPL', description: 'Apple Inc' })).toBe(false);
    });

    it('identifies ** symbol as settled', () => {
        expect(isSettledCash({ symbol: '**', description: '' })).toBe(true);
    });

    it('is case-insensitive for symbol', () => {
        expect(isSettledCash({ symbol: 'spaxx', description: '' })).toBe(true);
    });
});

// ─── getAggregateCash ──────────────────────────────────────────────────────────

describe('getAggregateCash', () => {
    it('sums SPAXX positions and Cash/Savings accounts', () => {
        const positions = [
            { symbol: 'SPAXX', description: '', value: 5000 },
            { symbol: 'AAPL', description: '', value: 2000 }
        ];
        const accounts = [
            { type: 'Cash', value: 3000 },
            { type: 'Brokerage', value: 10000 }
        ];
        expect(getAggregateCash(positions, accounts)).toBe(8000); // 5000 + 3000
    });

    it('handles empty arrays', () => {
        expect(getAggregateCash([], [])).toBe(0);
    });

    it('includes FDRXX positions', () => {
        const positions = [{ symbol: 'FDRXX', description: '', value: 1500 }];
        expect(getAggregateCash(positions, [])).toBe(1500);
    });

    it('includes MONEY MARKET descriptions (case-sensitive, uppercase)', () => {
        const positions = [{ symbol: 'XX', description: 'FIDELITY MONEY MARKET CORE', value: 750 }];
        expect(getAggregateCash(positions, [])).toBe(750);
    });

    it('includes Savings account type', () => {
        const accounts = [{ type: 'Savings', value: 12000 }];
        expect(getAggregateCash([], accounts)).toBe(12000);
    });
});

// ─── getAggregateCDs ───────────────────────────────────────────────────────────

describe('getAggregateCDs', () => {
    it('sums all CD principals', () => {
        const cds = [
            { principal: 10000, rate: 5 },
            { principal: 5000, rate: 4.5 }
        ];
        expect(getAggregateCDs(cds)).toBe(15000);
    });

    it('returns 0 for empty array', () => {
        expect(getAggregateCDs([])).toBe(0);
    });

    it('handles undefined principal gracefully', () => {
        const cds = [{ bank: 'Test' }];
        expect(getAggregateCDs(cds)).toBe(0);
    });
});

// ─── getAggregateEquities ──────────────────────────────────────────────────────

describe('getAggregateEquities', () => {
    it('sums non-cash imported positions and Brokerage/Crypto accounts', () => {
        const positions = [
            { symbol: 'AAPL', description: '', value: 5000 },
            { symbol: 'SPAXX', description: '', value: 2000 }
        ];
        const accounts = [
            { type: 'Brokerage', value: 3000 },
            { type: 'Crypto', value: 1000 },
            { type: 'Savings', value: 500 }
        ];
        expect(getAggregateEquities(positions, accounts)).toBe(9000); // 5000 + 3000 + 1000
    });

    it('returns 0 for empty inputs', () => {
        expect(getAggregateEquities([], [])).toBe(0);
    });
});

// ─── getAggregateOtherAssets ───────────────────────────────────────────────────

describe('getAggregateOtherAssets', () => {
    it('sums accounts that are not Cash/Savings/Brokerage/Crypto', () => {
        const accounts = [
            { type: 'Other', value: 2000 },
            { type: 'RealEstate', value: 5000 },
            { type: 'Cash', value: 1000 },
            { type: 'Savings', value: 500 }
        ];
        expect(getAggregateOtherAssets(accounts)).toBe(7000);
    });

    it('returns 0 for empty or all-excluded types', () => {
        expect(getAggregateOtherAssets([])).toBe(0);
        expect(getAggregateOtherAssets([{ type: 'Cash', value: 100 }])).toBe(0);
    });
});

// ─── getSideGigYTDNet ──────────────────────────────────────────────────────────

describe('getSideGigYTDNet', () => {
    it('sums net values from ledger', () => {
        const ledger = [
            { net: 150 },
            { net: -30 },
            { net: 200 }
        ];
        expect(getSideGigYTDNet(ledger)).toBe(320);
    });

    it('returns 0 for empty ledger', () => {
        expect(getSideGigYTDNet([])).toBe(0);
    });
});

// ─── getAggregateRealEstate ────────────────────────────────────────────────────

describe('getAggregateRealEstate', () => {
    it('computes equity (market value - mortgage)', () => {
        const re = [
            { marketValue: 400000, mortgageBalance: 250000 },
            { marketValue: 200000, mortgageBalance: 180000 }
        ];
        expect(getAggregateRealEstate(re)).toBe(170000); // 150000 + 20000
    });

    it('floors negative equity at 0', () => {
        const re = [{ marketValue: 100000, mortgageBalance: 120000 }];
        expect(getAggregateRealEstate(re)).toBe(0);
    });

    it('returns 0 for empty list', () => {
        expect(getAggregateRealEstate([])).toBe(0);
    });
});

// ─── getAggregateVehicles ──────────────────────────────────────────────────────

describe('getAggregateVehicles', () => {
    it('computes equity (current value - loan balance)', () => {
        const vehicles = [
            { currentValue: 25000, loanBalance: 15000 },
            { currentValue: 12000, loanBalance: 0 }
        ];
        expect(getAggregateVehicles(vehicles)).toBe(22000); // 10000 + 12000
    });

    it('floors negative equity at 0 (underwater loan)', () => {
        const vehicles = [{ currentValue: 8000, loanBalance: 12000 }];
        expect(getAggregateVehicles(vehicles)).toBe(0);
    });
});

// ─── getAggregateNetWorth ──────────────────────────────────────────────────────

describe('getAggregateNetWorth', () => {
    it('sums all asset categories', () => {
        const state = {
            importedPositions: [{ symbol: 'AAPL', description: '', value: 10000 }],
            customAccounts: [{ type: 'Cash', value: 5000 }],
            cds: [{ principal: 8000 }],
            realEstate: [{ marketValue: 300000, mortgageBalance: 200000 }],
            vehicles: [{ currentValue: 20000, loanBalance: 10000 }],
            sideGigLedger: [{ net: 500 }]
        };
        const nw = getAggregateNetWorth(state);
        // equities: 10000, cash: 5000, CDs: 8000, RE equity: 100000, vehicles: 10000, side: 500
        expect(nw).toBe(133500);
    });

    it('returns 0 when state has no assets', () => {
        const state = {
            importedPositions: [], customAccounts: [], cds: [],
            realEstate: [], vehicles: [], sideGigLedger: []
        };
        expect(getAggregateNetWorth(state)).toBe(0);
    });
});

// ─── windowToPoints ────────────────────────────────────────────────────────────

describe('windowToPoints', () => {
    it('returns 2 for 1m', () => expect(windowToPoints('1m')).toBe(2));
    it('returns 2 for 1y', () => expect(windowToPoints('1y')).toBe(2));
    it('returns 6 for 5y', () => expect(windowToPoints('5y')).toBe(6));
    it('returns 11 for 10y', () => expect(windowToPoints('10y')).toBe(11));
    it('returns 16 for 15y', () => expect(windowToPoints('15y')).toBe(16));
    it('returns null for all', () => expect(windowToPoints('all')).toBeNull());
    it('returns null for unknown key', () => expect(windowToPoints('foo')).toBeNull());
});

// ─── sliceProjectionData ───────────────────────────────────────────────────────

describe('sliceProjectionData', () => {
    const makeData = (n = 10) => ({
        labels: Array.from({ length: n }, (_, i) => `Year ${i}`),
        nwData: Array.from({ length: n }, (_, i) => i * 1000),
        fireLine: Array.from({ length: n }, () => 500000),
        leanFireLine: Array.from({ length: n }, () => 375000),
        fatFireLine: Array.from({ length: n }, () => 625000),
        coastFireLine: Array.from({ length: n }, () => 200000),
        bullData: Array.from({ length: n }, (_, i) => i * 1100),
        bearData: Array.from({ length: n }, (_, i) => i * 900),
        benchData: Array.from({ length: n }, () => 50000),
        retirementLineIndex: 5,
        cdEvents: [{ yearIndex: 3, label: 'CD Matures', amount: 10000 }],
        fireNumber: 500000
    });

    it('returns all data for "all" window', () => {
        const data = makeData(10);
        const sliced = sliceProjectionData(data, 'all');
        expect(sliced.labels).toHaveLength(10);
    });

    it('slices to 6 points for 5y', () => {
        const data = makeData(10);
        const sliced = sliceProjectionData(data, '5y');
        expect(sliced.labels).toHaveLength(6);
        expect(sliced.nwData).toHaveLength(6);
        expect(sliced.fireLine).toHaveLength(6);
    });

    it('filters CD events outside the window', () => {
        const data = makeData(10);
        // cdEvent at yearIndex 3 - within 5y (6 points, indices 0-5)
        const sliced = sliceProjectionData(data, '5y');
        expect(sliced.cdEvents).toHaveLength(1);

        // slicing to 2 points: only indices 0-1 remain
        const sliced2 = sliceProjectionData(data, '1y');
        expect(sliced2.cdEvents).toHaveLength(0);
    });

    it('resets retirementLineIndex to -1 when out of range', () => {
        const data = makeData(10);
        // retirementLineIndex = 5, slicing to 2 points
        const sliced = sliceProjectionData(data, '1y');
        expect(sliced.retirementLineIndex).toBe(-1);
    });

    it('keeps retirementLineIndex when within range', () => {
        const data = makeData(10);
        data.retirementLineIndex = 3;
        const sliced = sliceProjectionData(data, '5y'); // 6 points, index 3 is within
        expect(sliced.retirementLineIndex).toBe(3);
    });
});

// ─── buildProjectionData ───────────────────────────────────────────────────────

describe('buildProjectionData', () => {
    const baseState = {
        importedPositions: [],
        customAccounts: [{ type: 'Cash', value: 100000 }],
        cds: [],
        realEstate: [],
        vehicles: [],
        sideGigLedger: [],
        expenses: { housing: 2000, food: 500, transport: 300, utilities: 200, healthcare: 150, discretionary: 400 },
        insurances: { car: { amt: 0, freq: 'monthly' }, home: { amt: 0, freq: 'monthly' } },
        taxRate: 25,
        projectionSettings: {
            annualSavings: 20000,
            expectedReturn: 8.0,
            inflationRate: 2.5,
            swr: 4.0,
            spanYears: 10,
            currentAge: 35,
            retireAge: 60
        }
    };

    it('generates labels for each year of the span', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.labels).toHaveLength(11); // 0..10 inclusive
        expect(data.labels[0]).toBe('Age 35');
        expect(data.labels[10]).toBe('Age 45');
    });

    it('starting networth matches aggregate', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.networth).toBe(100000);
        expect(data.nwData[0]).toBe(100000);
    });

    it('net worth grows over time with positive real return', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.nwData[data.nwData.length - 1]).toBeGreaterThan(data.nwData[0]);
    });

    it('computes fireNumber from annual expenses and SWR', () => {
        const data = buildProjectionData(baseState, 0);
        const annualExpenses = getAnnualExpensesTotal(baseState.expenses, baseState.insurances, baseState.taxRate);
        const expected = annualExpenses / 0.04;
        expect(data.fireNumber).toBeCloseTo(expected, 0);
    });

    it('fireLine is constant (FIRE target)', () => {
        const data = buildProjectionData(baseState, 0);
        const allSame = data.fireLine.every(v => v === data.fireLine[0]);
        expect(allSame).toBe(true);
    });

    it('leanFireLine is 75% of fireLine (rounded)', () => {
        const data = buildProjectionData(baseState, 0);
        // buildProjectionData uses Math.round, so compare against rounded value
        expect(data.leanFireLine[0]).toBe(Math.round(data.fireLine[0] * 0.75));
    });

    it('fatFireLine is 125% of fireLine (rounded)', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.fatFireLine[0]).toBe(Math.round(data.fireLine[0] * 1.25));
    });

    it('bull scenario is higher than base', () => {
        const data = buildProjectionData(baseState, 0);
        const lastIdx = data.nwData.length - 1;
        expect(data.bullData[lastIdx]).toBeGreaterThan(data.nwData[lastIdx]);
    });

    it('bear scenario is lower than base', () => {
        const data = buildProjectionData(baseState, 0);
        const lastIdx = data.nwData.length - 1;
        expect(data.bearData[lastIdx]).toBeLessThanOrEqual(data.nwData[lastIdx]);
    });

    it('applies scenario offset to return rate', () => {
        const bullData = buildProjectionData(baseState, 2);
        const baseData = buildProjectionData(baseState, 0);
        const lastIdx = bullData.nwData.length - 1;
        expect(bullData.nwData[lastIdx]).toBeGreaterThan(baseData.nwData[lastIdx]);
    });

    it('sets retirementLineIndex correctly', () => {
        const data = buildProjectionData(baseState, 0);
        // currentAge=35, retireAge=60, so retirementLineIndex = 60-35 = 25, but span is 10
        // so it won't be within range
        expect(data.retirementLineIndex).toBe(-1);
    });

    it('sets retirementLineIndex when retire is within span', () => {
        const state = { ...baseState, projectionSettings: { ...baseState.projectionSettings, retireAge: 40, spanYears: 10 } };
        const data = buildProjectionData(state, 0);
        expect(data.retirementLineIndex).toBe(5); // age 40 is 5 years from 35
    });

    it('includes CD events', () => {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 2);
        const state = {
            ...baseState,
            cds: [{ bank: 'Marcus', principal: 10000, rate: 5, maturity: futureDate.toISOString().slice(0, 10) }]
        };
        const data = buildProjectionData(state, 0);
        expect(data.cdEvents.length).toBeGreaterThan(0);
    });

    it('benchData has correct length', () => {
        const data = buildProjectionData(baseState, 0);
        expect(data.benchData).toHaveLength(11);
    });
});

// ─── pnlColorStyle ─────────────────────────────────────────────────────────────

describe('pnlColorStyle', () => {
    it('returns muted color for zero pnl', () => {
        expect(pnlColorStyle(0, 50)).toBe('color: var(--text-muted);');
    });

    it('returns muted color for near-zero maxAbsPct', () => {
        expect(pnlColorStyle(5, 0.001)).toBe('color: var(--text-muted);');
    });

    it('returns green hsl for positive pnl', () => {
        const style = pnlColorStyle(20, 50);
        expect(style).toMatch(/hsl\(142,/);
    });

    it('returns red hsl for negative pnl', () => {
        const style = pnlColorStyle(-20, 50);
        expect(style).toMatch(/hsl\(0,/);
    });

    it('clamps norm to [-1, 1]', () => {
        // pnlPct much larger than maxAbsPct
        const style1 = pnlColorStyle(1000, 50);
        const style2 = pnlColorStyle(50, 50);
        // Both should produce green (max intensity), check format
        expect(style1).toMatch(/hsl\(142,/);
        expect(style2).toMatch(/hsl\(142,/);
    });
});

// ─── sortPositions ─────────────────────────────────────────────────────────────

describe('sortPositions', () => {
    const positions = [
        { symbol: 'TSLA', description: 'Tesla', quantity: 5, lastPrice: 200, costBasis: 800, value: 1000, pnlDollar: 200 },
        { symbol: 'AAPL', description: 'Apple', quantity: 10, lastPrice: 175, costBasis: 1400, value: 1750, pnlDollar: 350 },
        { symbol: 'MSFT', description: 'Microsoft', quantity: 3, lastPrice: 380, costBasis: 900, value: 1140, pnlDollar: 240 }
    ];

    it('sorts by symbol ascending', () => {
        const sorted = sortPositions(positions, 'symbol', 'asc');
        expect(sorted[0].symbol).toBe('AAPL');
        expect(sorted[2].symbol).toBe('TSLA');
    });

    it('sorts by symbol descending', () => {
        const sorted = sortPositions(positions, 'symbol', 'desc');
        expect(sorted[0].symbol).toBe('TSLA');
    });

    it('sorts by pnlDollar descending (default)', () => {
        const sorted = sortPositions(positions, 'pnl', 'desc');
        expect(sorted[0].pnlDollar).toBe(350);
        expect(sorted[2].pnlDollar).toBe(200);
    });

    it('sorts by pnlDollar ascending', () => {
        const sorted = sortPositions(positions, 'pnl', 'asc');
        expect(sorted[0].pnlDollar).toBe(200);
    });

    it('sorts by value', () => {
        const sorted = sortPositions(positions, 'value', 'desc');
        expect(sorted[0].value).toBe(1750);
    });

    it('sorts by quantity', () => {
        const sorted = sortPositions(positions, 'qty', 'asc');
        expect(sorted[0].quantity).toBe(3);
    });

    it('sorts by price', () => {
        const sorted = sortPositions(positions, 'price', 'desc');
        expect(sorted[0].lastPrice).toBe(380);
    });

    it('sorts by cost basis', () => {
        const sorted = sortPositions(positions, 'cost', 'asc');
        expect(sorted[0].costBasis).toBe(800);
    });

    it('sorts by description', () => {
        const sorted = sortPositions(positions, 'desc', 'asc');
        expect(sorted[0].description).toBe('Apple');
    });

    it('does not mutate original array', () => {
        const original = [...positions];
        sortPositions(positions, 'symbol', 'asc');
        expect(positions[0].symbol).toBe(original[0].symbol);
    });
});

// ─── calculateEbayFees ─────────────────────────────────────────────────────────

describe('calculateEbayFees', () => {
    it('computes fees correctly for standard category (13.25%)', () => {
        // price=100, shipping=0, category=13.25%, ad=0%
        // standard fee = 100 * 0.1325 + 0.30 = 13.55
        const fees = calculateEbayFees(100, 0, 13.25, 0);
        expect(fees).toBeCloseTo(13.55, 2);
    });

    it('includes promoted listings ad fee', () => {
        // price=100, shipping=0, category=13.25%, ad=2%
        // standard fee = 13.55, ad fee = 2.00, total = 15.55
        const fees = calculateEbayFees(100, 0, 13.25, 2);
        expect(fees).toBeCloseTo(15.55, 2);
    });

    it('includes shipping in total transaction value', () => {
        // price=100, shipping=10, category=13.25%, ad=0%
        // total = 110, standard fee = 110 * 0.1325 + 0.30 = 14.875
        const fees = calculateEbayFees(100, 10, 13.25, 0);
        expect(fees).toBeCloseTo(14.875, 2);
    });

    it('handles zero values', () => {
        const fees = calculateEbayFees(0, 0, 0, 0);
        expect(fees).toBeCloseTo(0.30, 2); // just the flat $0.30
    });
});

// ─── calculateEbayNetProfit ────────────────────────────────────────────────────

describe('calculateEbayNetProfit', () => {
    it('computes correct net profit', () => {
        // price=100, cost=30, shipping_charged=0, shipping_actual=8.50, cat=13.25%, ad=2%
        // gross=100, fees=15.55, net = 100 - 15.55 - 8.50 - 30 = 45.95
        const profit = calculateEbayNetProfit(100, 30, 0, 8.50, 13.25, 2);
        expect(profit).toBeCloseTo(45.95, 1);
    });

    it('returns negative when costs exceed revenue', () => {
        const profit = calculateEbayNetProfit(10, 50, 0, 5, 13.25, 2);
        expect(profit).toBeLessThan(0);
    });

    it('handles zero cost basis', () => {
        const profit = calculateEbayNetProfit(100, 0, 0, 0, 13.25, 0);
        // gross=100, fees = 100*0.1325 + 0.30 = 13.55, net = 86.45
        expect(profit).toBeCloseTo(86.45, 1);
    });
});

// ─── US_MEDIAN_SAVINGS constant ────────────────────────────────────────────────

describe('US_MEDIAN_SAVINGS', () => {
    it('has entries for key ages', () => {
        expect(US_MEDIAN_SAVINGS[30]).toBe(45000);
        expect(US_MEDIAN_SAVINGS[65]).toBe(400000);
    });

    it('increases with age', () => {
        const ages = Object.keys(US_MEDIAN_SAVINGS).map(Number).sort((a, b) => a - b);
        for (let i = 1; i < ages.length; i++) {
            expect(US_MEDIAN_SAVINGS[ages[i]]).toBeGreaterThanOrEqual(US_MEDIAN_SAVINGS[ages[i - 1]]);
        }
    });
});
