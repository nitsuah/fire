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
import { createHash } from 'crypto';

const require = createRequire(import.meta.url);
// Deliberately does NOT import writeState / mutateState — the MCP server is
// read-only by design (see docs/security-hardening.md, "MCP-Specific" pen
// test checklist: "MCP server registers no write tools"). Locked in by
// tests/unit/mcp-server-read-only.test.mjs.
const { readState, initDatabase, DATA_DIR } = require('./lib/db.js');

// Import the browser-safe tool core
import { TOOLS, handleTool } from './mcp-tools.mjs';

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

// Node hasher for pagingKey (SHA-256 hex)
function nodeHasher(input) {
    return createHash('sha256').update(input).digest('hex');
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
            const result = handleTool(name, state, toolArgs, {
                hasher: nodeHasher,
            });
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
