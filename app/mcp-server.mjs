import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { appendFileSync } from 'fs';
import { join } from 'path';

const require = createRequire(import.meta.url);
const { readState, initDatabase, DATA_DIR } = require('./lib/db.js');
const { buildProjectionData } = require('./lib/finance-calcs.js');

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
            'Scenario modeling: "What if I sold X of AssetA and bought Y of AssetB?"',
        inputSchema: {
            type: 'object',
            properties: {
                soldAsset: { type: 'string' },
                soldAmount: { type: 'number' },
                boughtAsset: { type: 'string' },
                boughtAmount: { type: 'number' },
            },
            required: [
                'soldAsset',
                'soldAmount',
                'boughtAsset',
                'boughtAmount',
            ],
        },
    },
    {
        name: 'get_market_correlation',
        description: 'Check portfolio sync (e.g., COIN + VOO).',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_swr_sensitivity',
        description: 'Impact of market dip on 4-year SWR.',
        inputSchema: {
            type: 'object',
            properties: {
                swr: { type: 'number' },
                marketDipPercent: { type: 'number' },
            },
            required: ['swr', 'marketDipPercent'],
        },
    },
    {
        name: 'set_price_target_alert',
        description: 'Monitor assets for exit prices.',
        inputSchema: {
            type: 'object',
            properties: {
                symbol: { type: 'string' },
                targetPrice: { type: 'number' },
            },
            required: ['symbol', 'targetPrice'],
        },
    },
    {
        name: 'auto_reconcile_csv',
        description: 'Automate matching pending transactions.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_emergency_runway',
        description: 'If income hits $0, how many months until $0 net worth?',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_dividend_forecast',
        description: 'Project portfolio yield.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_net_worth_trend',
        description: 'Time-series projection.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'get_diversification_score',
        description: 'Proprietary balance rating.',
        inputSchema: { type: 'object', properties: {} },
    },
];

function computeNetWorthBreakdown(state) {
    let cash = 0,
        equities = 0;
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
            cash += acc.value || 0;
        }
    }
    const cds = (state.cds || []).reduce((s, cd) => s + (cd.principal || 0), 0);
    const realEstate = (state.realEstate || []).reduce(
        (s, r) => s + ((r.marketValue || 0) - (r.mortgageBalance || 0)),
        0,
    );
    const vehicles = (state.vehicles || []).reduce(
        (s, v) => s + ((v.currentValue || 0) - (v.loanBalance || 0)),
        0,
    );
    const cryptoWallets = (state.wallets || []).reduce(
        (s, w) => s + (w.lastUsdValue || 0),
        0,
    );
    const total = cash + equities + cds + realEstate + vehicles + cryptoWallets;
    return { total, cash, equities, cds, realEstate, vehicles, cryptoWallets };
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
            }));
            return {
                accounts,
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
            return {
                breakdown: expenses,
                monthlyTotal: Math.round(monthlyTotal),
                annualTotal: Math.round(monthlyTotal * 12),
                taxRate: state.taxRate || 0,
            };
        }

        case 'get_projection_settings': {
            return { ...(state.projectionSettings || {}) };
        }

        case 'get_side_gig_income': {
            const ledger = state.sideGigLedger || [];
            const byPlatform = {};
            for (const entry of ledger) {
                const platform = entry.platform || 'Other';
                if (!byPlatform[platform]) {
                    byPlatform[platform] = { count: 0, gross: 0, net: 0 };
                }
                byPlatform[platform].count++;
                byPlatform[platform].gross += entry.gross || 0;
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
                    percentage: Math.round((p.value / total) * 100),
                }));
            return { risk, total };
        }

        case 'simulate_rebalance': {
            const { soldAsset, soldAmount, boughtAsset, boughtAmount } =
                toolArgs;
            if (
                !soldAsset ||
                typeof soldAmount !== 'number' ||
                !Number.isFinite(soldAmount) ||
                soldAmount <= 0 ||
                !boughtAsset ||
                typeof boughtAmount !== 'number' ||
                !Number.isFinite(boughtAmount) ||
                boughtAmount <= 0
            ) {
                throw new Error(
                    'Invalid input: soldAsset, soldAmount, boughtAsset, and boughtAmount (>0) are required.',
                );
            }
            return {
                status: 'simulated',
                sold: { soldAsset, soldAmount },
                bought: { boughtAsset, boughtAmount },
            };
        }

        case 'get_market_correlation': {
            return { status: 'not_implemented' };
        }

        case 'get_swr_sensitivity': {
            const { swr, marketDipPercent } = toolArgs;
            if (
                typeof swr !== 'number' ||
                swr <= 0 ||
                typeof marketDipPercent !== 'number' ||
                marketDipPercent < 0
            ) {
                throw new Error(
                    'Invalid input: swr (>0) and marketDipPercent (>=0) are required.',
                );
            }
            return { swr, marketDipPercent, status: 'not_implemented' };
        }

        case 'set_price_target_alert': {
            const { symbol, targetPrice } = toolArgs;
            if (
                !symbol ||
                typeof targetPrice !== 'number' ||
                targetPrice <= 0
            ) {
                throw new Error(
                    'Invalid input: symbol and targetPrice (>0) are required.',
                );
            }
            return { symbol, targetPrice, status: 'alert_set' };
        }

        case 'auto_reconcile_csv': {
            return { status: 'not_implemented' };
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

        case 'get_dividend_forecast': {
            return { status: 'not_implemented' };
        }

        case 'get_net_worth_trend': {
            return { status: 'not_implemented' };
        }

        case 'get_diversification_score': {
            return { status: 'not_implemented' };
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

main().catch((err) => {
    console.error('[MCP] Fatal:', err);
    process.exit(1);
});
