// Calls one tool on the real FIRE MCP server and prints its JSON result.
// Usage: FIRE_DB_FILE=/out/capture/demo-db.json node promo/mcp.mjs fire_status_summary
import { Client } from '/deps/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/deps/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const tool = process.argv[2] || 'fire_status_summary';
const transport = new StdioClientTransport({
    command: 'node',
    args: ['/repo/app/mcp-server.mjs'],
    env: { ...process.env },
    stderr: 'ignore',
});
const client = new Client(
    { name: 'fire-promo', version: '1' },
    { capabilities: {} },
);
await client.connect(transport);
const res = await client.callTool({ name: tool, arguments: {} });
process.stdout.write(res.content[0].text);
process.exit(0);
