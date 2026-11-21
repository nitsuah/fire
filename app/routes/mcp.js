'use strict';

const express = require('express');
const crypto = require('crypto');
const { readState } = require('../lib/db');

const router = express.Router();

// Constant-time token check without hashing the key: copy both values into
// equal-length buffers so timingSafeEqual always runs over the same span, then
// also require equal lengths. Only the longer length is observable.
function tokensMatch(provided, expected) {
    const a = Buffer.from(String(provided), 'utf8');
    const b = Buffer.from(String(expected), 'utf8');
    const len = Math.max(a.length, b.length, 1);
    const pa = Buffer.alloc(len);
    const pb = Buffer.alloc(len);
    a.copy(pa);
    b.copy(pb);
    const same = crypto.timingSafeEqual(pa, pb);
    return same && a.length === b.length;
}

// Cache the dynamic imports
let mcpServerModulePromise = null;
let streamableHttpModulePromise = null;

async function getMcpModules() {
    if (!mcpServerModulePromise) {
        mcpServerModulePromise = import('../mcp-server.mjs');
    }
    if (!streamableHttpModulePromise) {
        streamableHttpModulePromise =
            import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    }
    const [mcpServerModule, streamableHttpModule] = await Promise.all([
        mcpServerModulePromise,
        streamableHttpModulePromise,
    ]);
    return { mcpServerModule, streamableHttpModule };
}

// Auth middleware - runs on every method
router.use(async (req, res, next) => {
    // Read FIRE_API_KEY at request time (not startup)
    const apiKey = process.env.FIRE_API_KEY;
    if (!apiKey || apiKey === '') {
        return res.status(503).json({
            error: 'MCP endpoint disabled: FIRE_API_KEY is not set.',
        });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        return res.status(401).json({ error: 'Unauthorized.' });
    }

    const token = authHeader.slice(7); // Remove 'Bearer '
    if (!tokensMatch(token, apiKey)) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        return res.status(401).json({ error: 'Unauthorized.' });
    }

    next();
});

// Only POST is allowed on /mcp
router.post('/', async (req, res) => {
    const { mcpServerModule, streamableHttpModule } = await getMcpModules();
    const { TOOLS, handleTool } = mcpServerModule;
    const { StreamableHTTPServerTransport } = streamableHttpModule;
    const { CallToolRequestSchema, ListToolsRequestSchema } =
        await import('@modelcontextprotocol/sdk/types.js');
    const { Server } =
        await import('@modelcontextprotocol/sdk/server/index.js');

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
            return {
                content: [{ type: 'text', text }],
            };
        } catch (err) {
            const text = `Error: ${err.message}`;
            return {
                content: [{ type: 'text', text }],
                isError: true,
            };
        }
    });

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });

    await server.connect(transport);

    // Handle cleanup on connection close
    res.on('close', async () => {
        try {
            await transport.close();
            await server.close();
        } catch {
            // Ignore cleanup errors
        }
    });

    await transport.handleRequest(req, res, req.body);
});

// GET, DELETE, and other methods return 405
router.all('/', (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed.' });
    }
});

module.exports = router;
