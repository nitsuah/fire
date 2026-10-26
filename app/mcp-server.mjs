import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
// Deliberately does NOT import writeState / mutateState — the MCP server is
// read-only by design (see docs/security-hardening.md, "MCP-Specific" pen
// test checklist: "MCP server registers no write tools"). Locked in by
// tests/unit/mcp-server-read-only.test.mjs.
const { readState, initDatabase, DATA_DIR } = require('./lib/db.js');
const { buildProjectionData } = require('./lib/finance-calcs.js');
const { saleAmounts, summarizeSideGigTax } = require('./lib/side-gig-tax.js');
const {
    getEstimatedAnnualInterest,
    getAggregateNetWorth,
    getAnnualExpensesTotal,
} = require('./lib/finance-core.js');
const {
    ASSET_CLASSES,
    getAllocationAmounts,
    scoreDiversification,
    insuranceToMonthly,
    getInsuranceMonthly,
} = require('./lib/aggregates.js');
const { sweepRebalances } = require('./lib/rebalance-sweep.js');
const { summarizeNetWorthHistory } = require('./lib/net-worth-history.js');
const { coinTrackerAddresses } = require('./lib/cointracker-merge.js');
const { summarizeDataFreshness } = require('./lib/data-freshness.js');

const AUDIT_LOG = join(DATA_DIR, 'mcp-audit.log');

function writeAuditLog(toolName, responseBytes) {
    try {
        const line =
            JSON.stringify({
                ts: new Date().toISOString(),
                tool: toolName,
                bytes: responseBytes,
            }) + '\n';
        appendFileSync(AUDIT_LOG, line);
    } catch {
        // Non-fatal: audit log failure must not block tool responses
    }
}

const TOOLS = [
    {
        name: 'fire_status_summary',
        description:
            'High-level FIRE status: FIRE number, current net worth, progress %, years to FIRE, and Coast FIRE status. Start here. dataFreshness says how old the prices behind net worth are — check it before trusting the numbers.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_net_worth',
        description:
            'Net worth broken down by category: equities, cash, CDs, real estate, vehicles, and crypto wallets, plus dataFreshness (price age, last import, positions with no price source).',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_accounts',
        description:
            'All custom accounts (cash, savings, brokerage, HSA, crypto, etc.) with type and current value, plus estimated annual interest and the combined HSA balance.',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description:
                        'Only return accounts of this type, e.g. "HSA" (case-sensitive).',
                },
            },
        },
    },
    {
        name: 'get_portfolio',
        description:
            'Imported Fidelity / Plaid brokerage positions with symbol, value, cost basis, unrealized P&L and priceUpdatedAt, plus dataFreshness (price age, last import, positions with no price source).',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_cds',
        description:
            'Certificate of Deposit holdings with bank, principal, yield rate, maturity date, and days to maturity.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_upcoming_events',
        description:
            'Date-ordered financial events in the next N days (default 90): CD maturities, plus CDs that matured in the last 7 days so they can be flagged for a decision.',
        inputSchema: {
            type: 'object',
            properties: {
                days: {
                    type: 'number',
                    description:
                        'Look-ahead window in days (1-730, default 90).',
                },
            },
        },
    },
    {
        name: 'get_expenses',
        description:
            'Monthly expense breakdown (housing, food, transport, etc.) with monthly and annual totals.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_insurances',
        description:
            'Insurance policies (car, home) with the amount and frequency as entered, normalized monthly and annual amounts, and combined totals.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_projection_settings',
        description:
            'FIRE projection configuration: annual savings, expected return rate, inflation rate, SWR, and time span.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_side_gig_income',
        description:
            'Side hustle income log grouped by platform with per-platform and overall totals.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_side_gig_tax_summary',
        description:
            'Side gig sales rolled up by how each item was acquired (business/resale, personal, gift, free): estimated taxable resale profit, taxable gains on personal items, non-deductible personal losses, and sales still missing a tag or cost basis. Optional year filter.',
        inputSchema: {
            type: 'object',
            properties: {
                year: {
                    type: 'number',
                    description: 'Limit to sales dated in this calendar year.',
                },
            },
        },
    },
    {
        name: 'get_wallets',
        description:
            'Tracked crypto wallets: chain, label, truncated address (last 8 chars), USD balance, and last-fetched timestamp.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_concentration_risk',
        description: 'Monitor exposure limits (e.g., COIN > 20%).',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'simulate_rebalance',
        description:
            'What-if: move an amount from one asset class to another (e.g. sell $20k of equities into cds) and see the allocation and diversification score before and after. Pass chaos: true (no soldAsset/amount/boughtAsset needed) to sweep every single-leg move across liquid classes and your top positions at several sizes, scored under bear/base/bull return assumptions net of estimated capital-gains tax, and ranked by a metric you pick. Default returns are placeholders — supply your own in options.returns. Read-only — nothing is traded or saved.',
        inputSchema: {
            type: 'object',
            properties: {
                soldAsset: {
                    type: 'string',
                    enum: [
                        'cash',
                        'cds',
                        'equities',
                        'crypto',
                        'metals',
                        'realEstate',
                        'vehicles',
                        'otherAssets',
                    ],
                },
                amount: {
                    type: 'number',
                    description:
                        'Dollars moved (> 0, at most the class balance).',
                },
                boughtAsset: {
                    type: 'string',
                    enum: [
                        'cash',
                        'cds',
                        'equities',
                        'crypto',
                        'metals',
                        'realEstate',
                        'vehicles',
                        'otherAssets',
                    ],
                },
                chaos: {
                    type: 'boolean',
                    description:
                        'Sweep many scenarios instead of one move. soldAsset, amount and boughtAsset are then ignored.',
                },
                options: {
                    type: 'object',
                    description:
                        'chaos only. fractions: sizes to try as fractions of each balance (default 0.1, 0.25, 0.5, 1). capGainsRatePct: flat tax rate on realized gains (default 15). returns: { bear|base|bull: { <assetClass>: annualReturn }, symbols: { COIN: { bear, base, bull } } } as decimals, e.g. -0.3. rankBy: baseDelta | bearDelta | bullDelta | scoreChange | taxCost | largestPositionPct (default baseDelta). limit: rows returned (default 25). maxPositions / minPositionValue: which top positions are tried as sellers (default 5 / 1000).',
                },
            },
            // soldAsset / amount / boughtAsset are validated in the handler:
            // they are required unless chaos is true.
        },
    },
    {
        name: 'get_swr_sensitivity',
        description:
            'Safe-withdrawal-rate stress test: annual withdrawal at the given SWR from current net worth, before and after a market dip, compared with annual expenses (incl. tax drag), plus the same at 3–5% SWR.',
        inputSchema: {
            type: 'object',
            properties: {
                swr: { type: 'number', description: 'Percent, e.g. 4.' },
                marketDipPercent: {
                    type: 'number',
                    description:
                        'Drop applied to equities, crypto and metals, e.g. 30.',
                },
            },
            required: ['swr', 'marketDipPercent'],
        },
    },
    {
        name: 'get_emergency_runway',
        description: 'If income hits $0, how many months until $0 net worth?',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_net_worth_trend',
        description:
            'Actual net worth over time from daily snapshots: latest value, change over 7/30/365 days and since tracking began, plus the daily points (optionally limited to the last N days). Each point carries pricesAsOf/stale (null on snapshots recorded before this was tracked); stalePoints counts snapshots taken on stale prices.',
        inputSchema: {
            type: 'object',
            properties: {
                days: {
                    type: 'number',
                    description: 'Only return the last N daily points.',
                },
            },
        },
    },
    {
        name: 'get_transactions',
        description:
            'Categorized spending transactions (CSV imports and Plaid sync) newest first, filtered by date range, category or merchant, with per-category totals for the filtered rows.',
        inputSchema: {
            type: 'object',
            properties: {
                from: {
                    type: 'string',
                    description: 'Earliest date, YYYY-MM-DD (inclusive).',
                },
                to: {
                    type: 'string',
                    description: 'Latest date, YYYY-MM-DD (inclusive).',
                },
                category: {
                    type: 'string',
                    description: 'Exact category, case-insensitive.',
                },
                merchant: {
                    type: 'string',
                    description: 'Case-insensitive substring of the merchant.',
                },
                limit: {
                    type: 'number',
                    description: 'Max rows returned (default 200, max 1000).',
                },
            },
        },
    },
    {
        name: 'get_diversification_score',
        description:
            '0–100 diversification score from how net worth is spread across asset classes (cash, CDs, equities, crypto, metals, real estate, vehicles, other), minus a penalty for any single position over 20% of net worth; includes the class weights.',
        inputSchema: { type: 'object', properties: {} },
    },
];

function computeNetWorthBreakdown(state) {
    let cash = 0,
        equities = 0,
        otherAssets = 0;
    for (const pos of state.importedPositions || []) {
        const sym = pos.symbol || '';
        const desc = pos.description || '';
        if (
            sym.includes('SPAXX') ||
            sym.includes('FDRXX') ||
            desc.includes('MONEY MARKET')
        ) {
            cash += pos.value || 0;
        } else {
            equities += pos.value || 0;
        }
    }
    for (const acc of state.customAccounts || []) {
        if (acc.type === 'Cash' || acc.type === 'Savings') {
            cash += acc.value || 0;
        } else if (
            acc.type === 'Brokerage' ||
            acc.type === 'HSA' ||
            acc.type === 'Crypto'
        ) {
            equities += acc.value || 0;
        } else {
            // Metals and other valuables — matches the dashboard's
            // "Other Assets" card rather than inflating cash.
            otherAssets += acc.value || 0;
        }
    }
    const cds = (state.cds || []).reduce((s, cd) => s + (cd.principal || 0), 0);
    // Equity floored at $0 per property/vehicle, matching the dashboard
    // (getAggregateRealEstate / getAggregateVehicles): an underwater loan
    // shouldn't silently offset other assets in one total but not the other.
    const realEstate = (state.realEstate || []).reduce(
        (s, r) =>
            s + Math.max(0, (r.marketValue || 0) - (r.mortgageBalance || 0)),
        0,
    );
    const vehicles = (state.vehicles || []).reduce(
        (s, v) => s + Math.max(0, (v.currentValue || 0) - (v.loanBalance || 0)),
        0,
    );
    // A tracked wallet CoinTracker also reports is already in the Crypto
    // accounts above; count it once.
    const covered = coinTrackerAddresses(state.customAccounts);
    const cryptoWallets = (state.wallets || []).reduce(
        (s, w) =>
            covered.has(String(w.address || '').toLowerCase())
                ? s
                : s + (w.lastUsdValue || 0),
        0,
    );
    const total =
        cash +
        equities +
        otherAssets +
        cds +
        realEstate +
        vehicles +
        cryptoWallets;
    return {
        total,
        cash,
        equities,
        otherAssets,
        cds,
        realEstate,
        vehicles,
        cryptoWallets,
    };
}

function handleTool(name, state, toolArgs = {}) {
    switch (name) {
        case 'fire_status_summary': {
            const proj = buildProjectionData(state);
            const {
                networth,
                fireNumber,
                nwData,
                coastFireLine,
                passiveIncome,
                netWithdrawal,
                blendedReturn,
                depletionAge,
            } = proj;
            const progressPercent =
                fireNumber > 0
                    ? Math.round((networth / fireNumber) * 1000) / 10
                    : 0;
            const yearsIdx = nwData.findIndex((nw) => nw >= fireNumber);
            const annualExpenses =
                fireNumber * ((state.projectionSettings?.swr || 4.0) / 100);
            const monthlyExpenses = annualExpenses / 12;
            const settings = state.projectionSettings || {};
            const coastFireNumber = coastFireLine[0] || 0;
            return {
                fireNumber: Math.round(fireNumber),
                currentNetWorth: Math.round(networth),
                progressPercent,
                yearsToFire: yearsIdx >= 0 ? yearsIdx : null,
                currentAge: settings.currentAge || null,
                retireAge: settings.retireAge || null,
                monthlyExpenses: Math.round(monthlyExpenses),
                annualExpenses: Math.round(monthlyExpenses * 12),
                swr: settings.swr || 4.0,
                coastFireNumber: Math.round(coastFireNumber),
                coastFireReached: networth >= coastFireNumber,
                passiveIncome: Math.round(passiveIncome || 0),
                netWithdrawalNeeded: Math.round(netWithdrawal || 0),
                blendedReturnPct: Math.round((blendedReturn || 0) * 10) / 10,
                depletionAge: depletionAge || {
                    base: null,
                    bull: null,
                    bear: null,
                },
                dataFreshness: summarizeDataFreshness(state),
            };
        }

        case 'get_net_worth': {
            const b = computeNetWorthBreakdown(state);
            return {
                total: Math.round(b.total),
                breakdown: {
                    equities: Math.round(b.equities),
                    cash: Math.round(b.cash),
                    cds: Math.round(b.cds),
                    otherAssets: Math.round(b.otherAssets),
                    realEstate: Math.round(b.realEstate),
                    vehicles: Math.round(b.vehicles),
                    cryptoWallets: Math.round(b.cryptoWallets),
                },
                dataFreshness: summarizeDataFreshness(state),
            };
        }

        case 'get_accounts': {
            // Optional type filter so a caller can pull just its HSAs, etc.
            const wantType =
                typeof toolArgs.type === 'string' && toolArgs.type
                    ? toolArgs.type
                    : null;
            const accounts = (state.customAccounts || [])
                .filter((a) => !wantType || a.type === wantType)
                .map((a) => ({
                    id: a.id,
                    name: a.name,
                    type: a.type,
                    value: a.value || 0,
                    apy: a.apy || 0,
                    ...(a.type === 'Metal'
                        ? {
                              metalType: a.metalType,
                              weightOz: a.weightOz,
                              spotPricePerOz: a.spotPricePerOz ?? null,
                              payoutPct: a.payoutPct ?? null,
                              valueLastRefreshed: a.valueLastRefreshed ?? null,
                          }
                        : {}),
                }));
            const interest = getEstimatedAnnualInterest(
                state.customAccounts,
                state.cds,
            );
            return {
                accounts,
                estimatedAnnualInterest: {
                    savings: Math.round(interest.savings),
                    cds: Math.round(interest.cds),
                    staking: Math.round(interest.staking),
                    total: Math.round(interest.total),
                },
                // Total is over the returned (possibly filtered) rows.
                total: Math.round(accounts.reduce((s, a) => s + a.value, 0)),
                // Always the whole-state HSA total, filtered or not.
                hsaTotal: Math.round(
                    (state.customAccounts || []).reduce(
                        (s, a) => (a.type === 'HSA' ? s + (a.value || 0) : s),
                        0,
                    ),
                ),
                count: accounts.length,
                typeFilter: wantType,
            };
        }

        case 'get_portfolio': {
            const positions = (state.importedPositions || []).map((p) => {
                const pl =
                    p.value != null && p.costBasis != null
                        ? Math.round((p.value - p.costBasis) * 100) / 100
                        : null;
                const plPercent =
                    p.costBasis && p.costBasis !== 0
                        ? Math.round(
                              ((p.value - p.costBasis) / p.costBasis) * 1000,
                          ) / 10
                        : null;
                return {
                    symbol: p.symbol,
                    description: p.description,
                    quantity: p.quantity,
                    value: p.value,
                    costBasis: p.costBasis,
                    pl,
                    plPercent,
                    priceUpdatedAt: p.priceUpdatedAt || null,
                };
            });
            return {
                positions,
                totalValue: Math.round(
                    positions.reduce((s, p) => s + (p.value || 0), 0),
                ),
                totalPL:
                    Math.round(
                        positions.reduce((s, p) => s + (p.pl || 0), 0) * 100,
                    ) / 100,
                count: positions.length,
                dataFreshness: summarizeDataFreshness(state),
            };
        }

        case 'get_cds': {
            const now = Date.now();
            const cds = (state.cds || []).map((cd) => ({
                id: cd.id,
                bank: cd.bank,
                principal: cd.principal || 0,
                rate: cd.rate || 0,
                maturity: cd.maturity,
                daysToMaturity: cd.maturity
                    ? Math.ceil(
                          (new Date(cd.maturity).getTime() - now) /
                              (1000 * 60 * 60 * 24),
                      )
                    : null,
            }));
            const dated = cds.filter((cd) =>
                Number.isFinite(cd.daysToMaturity),
            );
            const sorted = [...dated].sort(
                (a, b) => a.daysToMaturity - b.daysToMaturity,
            );
            return {
                cds,
                totalPrincipal: cds.reduce((s, cd) => s + cd.principal, 0),
                count: cds.length,
                nextMaturity: sorted[0] || null,
            };
        }

        case 'get_upcoming_events': {
            const DAY_MS = 1000 * 60 * 60 * 24;
            const days =
                Number.isInteger(toolArgs.days) &&
                toolArgs.days >= 1 &&
                toolArgs.days <= 730
                    ? toolArgs.days
                    : 90;
            // 7 days of already-matured CDs stay in the list so they get acted
            // on rather than silently dropping off the end.
            const GRACE_DAYS = 7;
            const events = [];

            for (const cd of state.cds || []) {
                const t = cd?.maturity ? Date.parse(cd.maturity) : NaN;
                if (Number.isNaN(t)) continue;
                // ceil matches get_cds's daysToMaturity, so a CD maturing
                // today reads as 0 rather than -1.
                const daysAway = Math.ceil((t - Date.now()) / DAY_MS);
                if (daysAway > days || daysAway < -GRACE_DAYS) continue;
                events.push({
                    date: new Date(t).toISOString().slice(0, 10),
                    daysAway,
                    type: 'cd_maturity',
                    label: cd.bank ? `${cd.bank} CD` : 'CD',
                    amount: cd.principal || 0,
                    rate: cd.rate || 0,
                });
            }

            events.sort((a, b) => a.daysAway - b.daysAway);
            return {
                days,
                events,
                count: events.length,
                pastGraceDays: GRACE_DAYS,
            };
        }

        case 'get_expenses': {
            const expenses = state.expenses || {};
            const monthlyTotal = Object.values(expenses).reduce(
                (s, v) => s + (v || 0),
                0,
            );
            // fireBasis* mirrors what fire_status_summary actually uses to
            // derive fireNumber: category spend + insurance, grossed up by
            // taxRate. It intentionally will not equal annualTotal above,
            // which is category spend only -- surfaced explicitly here so
            // callers don't have to reverse-engineer the gap.
            const proj = buildProjectionData(state);
            return {
                breakdown: expenses,
                monthlyTotal: Math.round(monthlyTotal),
                annualTotal: Math.round(monthlyTotal * 12),
                taxRate: state.taxRate || 0,
                fireBasisAnnualTotal: Math.round(proj.annualExpenses),
                fireBasisMonthlyTotal: Math.round(proj.annualExpenses / 12),
            };
        }

        case 'get_insurances': {
            const ins = state.insurances || {};
            const rows = Object.entries(ins).map(([policy, v]) => {
                const amt = Number(v?.amt) || 0;
                const freq = v?.freq || 'monthly';
                const monthly = insuranceToMonthly({ amt, freq });
                return {
                    policy,
                    amount: amt,
                    frequency: freq,
                    monthly: Math.round(monthly * 100) / 100,
                    annual: Math.round(monthly * 12 * 100) / 100,
                };
            });
            const monthlyTotal = getInsuranceMonthly(ins);
            return {
                policies: rows,
                monthlyTotal: Math.round(monthlyTotal * 100) / 100,
                annualTotal: Math.round(monthlyTotal * 12 * 100) / 100,
            };
        }

        case 'get_projection_settings': {
            return { ...(state.projectionSettings || {}) };
        }

        case 'get_side_gig_income': {
            const ledger = state.sideGigLedger || [];
            const byPlatform = {};
            for (const entry of ledger) {
                // Ledger entries use category/revenue; platform/gross are legacy.
                const platform = entry.category || entry.platform || 'Other';
                if (!byPlatform[platform]) {
                    byPlatform[platform] = { count: 0, gross: 0, net: 0 };
                }
                byPlatform[platform].count++;
                byPlatform[platform].gross += saleAmounts(entry).revenue;
                byPlatform[platform].net += entry.net || 0;
            }
            return {
                entries: ledger,
                byPlatform,
                totalNet:
                    Math.round(
                        ledger.reduce((s, e) => s + (e.net || 0), 0) * 100,
                    ) / 100,
                count: ledger.length,
            };
        }

        case 'get_side_gig_tax_summary': {
            const year = Number.isInteger(toolArgs.year)
                ? toolArgs.year
                : undefined;
            return summarizeSideGigTax(state.sideGigLedger || [], { year });
        }

        case 'get_concentration_risk': {
            const b = computeNetWorthBreakdown(state);
            const total = b.total;
            if (total <= 0) {
                return {
                    risk: [],
                    total,
                    unavailableReason: 'non_positive_net_worth',
                };
            }
            const positions = state.importedPositions || [];
            const risk = positions
                .filter((p) => p.value / total > 0.1)
                .map((p) => ({
                    symbol: p.symbol,
                    percentage: Math.round((p.value / total) * 1000) / 10,
                }));
            return { risk, total };
        }

        case 'simulate_rebalance': {
            if (toolArgs.chaos === true) {
                return sweepRebalances(state, toolArgs.options || {});
            }
            const { soldAsset, amount, boughtAsset } = toolArgs;
            if (
                !ASSET_CLASSES.includes(soldAsset) ||
                !ASSET_CLASSES.includes(boughtAsset) ||
                soldAsset === boughtAsset ||
                typeof amount !== 'number' ||
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                throw new Error(
                    `Invalid input: soldAsset and boughtAsset must be different values of ${ASSET_CLASSES.join(', ')}, and amount must be > 0.`,
                );
            }
            const before = getAllocationAmounts(state);
            if (amount > before[soldAsset]) {
                throw new Error(
                    `Invalid input: amount exceeds the ${soldAsset} balance (${Math.round(before[soldAsset])}).`,
                );
            }
            const after = {
                ...before,
                [soldAsset]: before[soldAsset] - amount,
                [boughtAsset]: before[boughtAsset] + amount,
            };
            const positions = state.importedPositions || [];
            const b = scoreDiversification(before, positions);
            const a = scoreDiversification(after, positions);
            return {
                status: 'simulated',
                note: 'Hypothetical only — nothing is traded or saved.',
                moved: { from: soldAsset, to: boughtAsset, amount },
                before: { weightsPct: b.weights, score: b.score },
                after: { weightsPct: a.weights, score: a.score },
                scoreChange: a.score - b.score,
            };
        }

        case 'get_swr_sensitivity': {
            const { swr, marketDipPercent } = toolArgs;
            if (
                typeof swr !== 'number' ||
                swr <= 0 ||
                swr > 20 ||
                typeof marketDipPercent !== 'number' ||
                marketDipPercent < 0 ||
                marketDipPercent > 100
            ) {
                throw new Error(
                    'Invalid input: swr (0–20) and marketDipPercent (0–100) are required.',
                );
            }
            const amounts = getAllocationAmounts(state);
            const netWorth = getAggregateNetWorth(state);
            // The dip hits market-priced assets; cash, CDs, property and
            // vehicles are held at their stated values.
            const atRisk = amounts.equities + amounts.crypto + amounts.metals;
            const afterDip = netWorth - atRisk * (marketDipPercent / 100);
            const annualExpenses = getAnnualExpensesTotal(
                state.expenses || {},
                state.insurances,
                state.taxRate || 0,
            );
            const row = (rate) => {
                const before = netWorth * (rate / 100);
                const after = afterDip * (rate / 100);
                return {
                    swr: rate,
                    withdrawalBeforeDip: Math.round(before),
                    withdrawalAfterDip: Math.round(after),
                    coversExpensesAfterDip: after >= annualExpenses,
                };
            };
            const main = row(swr);
            return {
                swr,
                marketDipPercent,
                netWorth: Math.round(netWorth),
                marketExposed: Math.round(atRisk),
                netWorthAfterDip: Math.round(afterDip),
                annualExpenses: Math.round(annualExpenses),
                ...main,
                coversExpensesBeforeDip:
                    main.withdrawalBeforeDip >= annualExpenses,
                shortfallAfterDip: Math.max(
                    0,
                    Math.round(annualExpenses - main.withdrawalAfterDip),
                ),
                fireNumberAtSwr: Math.round(annualExpenses / (swr / 100)),
                comparison: [3, 3.5, 4, 4.5, 5].map(row),
            };
        }

        case 'get_transactions': {
            const DAY_MS = 1000 * 60 * 60 * 24;
            const asDate = (v, field) => {
                if (v === undefined || v === null || v === '') return null;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))
                    throw new Error(`${field} must be YYYY-MM-DD, got "${v}"`);
                const t = Date.parse(`${v}T00:00:00Z`);
                if (Number.isNaN(t))
                    throw new Error(`${field} is not a real date: "${v}"`);
                return t;
            };
            const from = asDate(toolArgs.from, 'from');
            const to = asDate(toolArgs.to, 'to');
            if (from !== null && to !== null && from > to)
                throw new Error('from must not be after to');

            const category =
                typeof toolArgs.category === 'string' && toolArgs.category
                    ? toolArgs.category.toLowerCase()
                    : null;
            const merchant =
                typeof toolArgs.merchant === 'string' && toolArgs.merchant
                    ? toolArgs.merchant.toLowerCase()
                    : null;
            const limit =
                Number.isInteger(toolArgs.limit) && toolArgs.limit > 0
                    ? Math.min(toolArgs.limit, 1000)
                    : 200;

            // Rows come from CSV imports (locale dates like "9/24/2026") and
            // Plaid (YYYY-MM-DD), so filter on the parsed instant, not a
            // string prefix.
            const rows = [];
            for (const txn of state.spendingTransactions || []) {
                if (!txn) continue;
                if (
                    category &&
                    String(txn.category || '').toLowerCase() !== category
                )
                    continue;
                if (
                    merchant &&
                    !String(txn.merchant || '')
                        .toLowerCase()
                        .includes(merchant)
                )
                    continue;
                const t = Date.parse(txn.date);
                if (from !== null || to !== null) {
                    if (Number.isNaN(t)) continue;
                    if (from !== null && t < from) continue;
                    // `to` is inclusive of the whole day.
                    if (to !== null && t > to + DAY_MS - 1) continue;
                }
                rows.push({ txn, t });
            }

            const matched = rows.length;
            rows.sort((a, b) => {
                const at = Number.isNaN(a.t) ? -Infinity : a.t;
                const bt = Number.isNaN(b.t) ? -Infinity : b.t;
                return bt - at;
            });

            const byCategory = {};
            let total = 0;
            for (const { txn } of rows) {
                const amt = Number(txn.amount) || 0;
                const cat = txn.category || 'uncategorized';
                byCategory[cat] = (byCategory[cat] || 0) + amt;
                total += amt;
            }
            const round2 = (n) => Math.round(n * 100) / 100;

            return {
                transactions: rows.slice(0, limit).map(({ txn }) => ({
                    id: txn.id,
                    date: txn.date,
                    merchant: txn.merchant,
                    amount: txn.amount,
                    category: txn.category,
                })),
                count: Math.min(matched, limit),
                matched,
                total: round2(total),
                byCategory: Object.fromEntries(
                    Object.entries(byCategory).map(([k, v]) => [k, round2(v)]),
                ),
                limit,
            };
        }

        case 'get_emergency_runway': {
            const b = computeNetWorthBreakdown(state);
            const expenses = state.expenses || {};
            const monthlyTotal = Object.values(expenses).reduce(
                (s, v) => s + (v || 0),
                0,
            );
            if (monthlyTotal <= 0) {
                return {
                    runwayMonths: null,
                    unavailableReason: 'no_monthly_expenses',
                };
            }
            if (b.total <= 0) {
                return {
                    runwayMonths: null,
                    unavailableReason: 'non_positive_net_worth',
                };
            }
            return { runwayMonths: Math.round(b.total / monthlyTotal) };
        }

        case 'get_net_worth_trend': {
            const s = summarizeNetWorthHistory(state.netWorthHistory);
            if (!s.latest) {
                return {
                    points: [],
                    unavailableReason: 'no_snapshots_yet',
                };
            }
            const days =
                Number.isInteger(toolArgs.days) && toolArgs.days > 0
                    ? toolArgs.days
                    : null;
            const points = (days ? s.points.slice(-days) : s.points).map(
                (p) => ({
                    date: p.date,
                    total: Math.round(p.total),
                    pricesAsOf: p.pricesAsOf ?? null,
                    stale: typeof p.stale === 'boolean' ? p.stale : null,
                }),
            );
            return {
                latest: {
                    date: s.latest.date,
                    total: Math.round(s.latest.total),
                },
                changes: s.changes,
                trackingSince: s.points[0].date,
                count: s.points.length,
                stalePoints: s.points.filter((p) => p.stale === true).length,
                points,
            };
        }

        case 'get_diversification_score': {
            const result = scoreDiversification(
                getAllocationAmounts(state),
                state.importedPositions || [],
            );
            return result || { score: null, unavailableReason: 'no_assets' };
        }
        case 'get_wallets': {
            const covered = coinTrackerAddresses(state.customAccounts);
            const wallets = (state.wallets || []).map((w) => ({
                id: w.id,
                chain: w.chain,
                label: w.label,
                address: `...${w.address.slice(-8)}`,
                lastUsdValue:
                    w.lastUsdValue != null
                        ? Math.round(w.lastUsdValue * 100) / 100
                        : null,
                lastBalance: w.lastBalance,
                lastFetched: w.lastFetched,
                warning: w.warning || null,
                coveredByCoinTracker: covered.has(
                    String(w.address || '').toLowerCase(),
                ),
            }));
            return {
                wallets,
                totalUsdValue:
                    Math.round(
                        wallets.reduce((s, w) => s + (w.lastUsdValue || 0), 0) *
                            100,
                    ) / 100,
                count: wallets.length,
            };
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

async function main() {
    initDatabase();

    const server = new Server(
        { name: 'fire-tracker', version: '1.1.0' },
        { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOLS,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: toolArgs = {} } = request.params;
        try {
            const state = readState();
            const result = handleTool(name, state, toolArgs);
            const text = JSON.stringify(result, null, 2);
            writeAuditLog(name, Buffer.byteLength(text, 'utf8'));
            return {
                content: [{ type: 'text', text }],
            };
        } catch (err) {
            const text = `Error: ${err.message}`;
            writeAuditLog(name, Buffer.byteLength(text, 'utf8'));
            return {
                content: [{ type: 'text', text }],
                isError: true,
            };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

// Exported for tests (e.g. tests/unit/mcp-server-read-only.test.mjs) without
// triggering a live stdio connection on import.
export { TOOLS, handleTool };

// Only run the server when this file is executed directly (`node
// app/mcp-server.mjs` / `npm run mcp`), not when imported as a module.
const isMain =
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((err) => {
        console.error('[MCP] Fatal:', err);
        process.exit(1);
    });
}
