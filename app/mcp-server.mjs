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
} = require('./lib/aggregates.js');
const { summarizeNetWorthHistory } = require('./lib/net-worth-history.js');

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
            'High-level FIRE status: FIRE number, current net worth, progress %, years to FIRE, and Coast FIRE status. Start here.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_net_worth',
        description:
            'Net worth broken down by category: equities, cash, CDs, real estate, vehicles, and crypto wallets.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_accounts',
        description:
            'All custom accounts (cash, savings, brokerage, crypto, etc.) with type and current value.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_portfolio',
        description:
            'Imported Fidelity / Plaid brokerage positions with symbol, value, cost basis, and unrealized P&L.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_cds',
        description:
            'Certificate of Deposit holdings with bank, principal, yield rate, maturity date, and days to maturity.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_expenses',
        description:
            'Monthly expense breakdown (housing, food, transport, etc.) with monthly and annual totals.',
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
            'What-if: move an amount from one asset class to another (e.g. sell $20k of equities into cds) and see the allocation and diversification score before and after. Read-only — nothing is traded or saved.',
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
            },
            required: ['soldAsset', 'amount', 'boughtAsset'],
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
            'Actual net worth over time from daily snapshots: latest value, change over 7/30/365 days and since tracking began, plus the daily points (optionally limited to the last N days).',
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
        } else if (acc.type === 'Brokerage' || acc.type === 'Crypto') {
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
    const cryptoWallets = (state.wallets || []).reduce(
        (s, w) => s + (w.lastUsdValue || 0),
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
            };
        }

        case 'get_accounts': {
            const accounts = (state.customAccounts || []).map((a) => ({
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
                total: Math.round(accounts.reduce((s, a) => s + a.value, 0)),
                count: accounts.length,
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
                (p) => ({ date: p.date, total: Math.round(p.total) }),
            );
            return {
                latest: {
                    date: s.latest.date,
                    total: Math.round(s.latest.total),
                },
                changes: s.changes,
                trackingSince: s.points[0].date,
                count: s.points.length,
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
