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

async function main() {
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

    // 1. List tools
    const { tools } = await client.listTools();
    console.log(`── tools/list (${tools.length} tools) ──`);
    console.log(tools.map(t => `  • ${t.name}`).join('\n'), '\n');

    // 2. fire_status_summary
    const status = await client.callTool({ name: 'fire_status_summary', arguments: {} });
    const statusData = JSON.parse(status.content[0].text);
    console.log('── fire_status_summary ──');
    console.log(JSON.stringify(statusData, null, 2), '\n');

    // 3. get_net_worth
    const nw = await client.callTool({ name: 'get_net_worth', arguments: {} });
    const nwData = JSON.parse(nw.content[0].text);
    console.log('── get_net_worth ──');
    console.log(JSON.stringify(nwData, null, 2), '\n');

    // 4. get_expenses
    const exp = await client.callTool({ name: 'get_expenses', arguments: {} });
    const expData = JSON.parse(exp.content[0].text);
    console.log('── get_expenses ──');
    console.log(JSON.stringify(expData, null, 2), '\n');

    // 5. get_accounts
    const accts = await client.callTool({ name: 'get_accounts', arguments: {} });
    const acctData = JSON.parse(accts.content[0].text);
    console.log('── get_accounts ──');
    console.log(JSON.stringify(acctData, null, 2), '\n');

    console.log('✓ All MCP tools tested successfully.');
    await client.close();
    process.exit(0);
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });
