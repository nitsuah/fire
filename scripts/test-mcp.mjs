/**
 * MCP protocol test — uses @modelcontextprotocol/sdk Client to drive the server.
 * Run inside the Docker container: node scripts/test-mcp.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dir, '../app/mcp-server.mjs');

const EXPECTED_TOOLS = [
    'fire_status_summary',
    'get_net_worth',
    'get_accounts',
    'get_portfolio',
    'get_cds',
    'get_expenses',
    'get_projection_settings',
    'get_side_gig_income',
    'get_side_gig_tax_summary',
    'get_wallets',
    'get_concentration_risk',
    'get_diversification_score',
    'get_swr_sensitivity',
    'simulate_rebalance',
    'get_emergency_runway',
    'get_net_worth_trend',
];

function assertOk(result, toolName) {
    if (!result?.content?.[0]?.text)
        throw new Error(`${toolName}: empty response`);
    const parsed = JSON.parse(result.content[0].text);
    if (parsed?.error)
        throw new Error(`${toolName}: MCP error — ${parsed.error}`);
    return parsed;
}

try {
    console.log('Starting FIRE MCP server…\n');

    const transport = new StdioClientTransport({
        command: 'node',
        args: [serverPath],
    });

    const client = new Client(
        { name: 'fire-mcp-test', version: '1.0.0' },
        { capabilities: {} },
    );

    await client.connect(transport);
    console.log('Connected.\n');

    // 1. Verify all tools are advertised
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    if (tools.length !== EXPECTED_TOOLS.length) {
        throw new Error(`Expected ${EXPECTED_TOOLS.length} MCP tools, got ${tools.length}`);
    }
    const missing = EXPECTED_TOOLS.filter((n) => !toolNames.includes(n));
    if (missing.length) throw new Error(`Missing tools: ${missing.join(', ')}`);
    console.log(`── tools/list (${tools.length} tools) ──`);
    console.log(toolNames.map((n) => `  • ${n}`).join('\n'), '\n');

    // 2. Call each tool and validate response
    const argumentsByTool = {
        get_swr_sensitivity: { swr: 4, marketDipPercent: 10 },
        simulate_rebalance: {
            soldAsset: 'equities',
            amount: 1,
            boughtAsset: 'cash',
        },
    };

    for (const name of EXPECTED_TOOLS) {
        const result = await client.callTool({
            name,
            arguments: argumentsByTool[name] || {},
        });
        const data = assertOk(result, name);
        console.log(`── ${name} ──`);
        console.log(JSON.stringify(data, null, 2), '\n');
    }

    console.log(
        `✓ All ${EXPECTED_TOOLS.length} MCP tools tested successfully.`,
    );
    await client.close();
    process.exit(0);
} catch (err) {
    console.error('FAIL:', err);
    process.exit(1);
}
