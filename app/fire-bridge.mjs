#!/usr/bin/env node
/**
 * fire-bridge: the local stdio MCP shim for sealed mode (#517, design §5.3).
 *
 * Your MCP client runs this as a stdio server. It lists the same read-only
 * tools as app/mcp-server.mjs, but every call is encrypted for the browser tab
 * that holds your data (see app/bridge-sealed.mjs), so the relay carries
 * ciphertext and metadata only. It reads no fire data and writes nothing.
 *
 *   FIRE_BRIDGE_PAIRING   the pairing string shown by the consent page
 *   FIRE_BRIDGE_RELAY_URL the relay's sealed carrier endpoint
 */
/* global fetch, process, console */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { TOOLS } from './mcp-tools.mjs';
import { acceptPairing, SealedClient } from './bridge-sealed.mjs';

/**
 * Carrier over HTTPS: POST `{ hello }` once, then `{ envelope }` per call; the
 * reply is `{ envelope }`. The relay endpoint that serves this is a follow-up.
 */
export function createHttpCarrier(baseUrl, sid, fetchImpl = fetch) {
    const url = `${String(baseUrl).replace(/\/+$/, '')}/${encodeURIComponent(sid)}`;
    return async (message) => {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(message),
        });
        if (!res.ok) throw new Error(`relay_${res.status}`);
        const body = await res.json();
        if (!body || typeof body.envelope !== 'object' || !body.envelope) {
            throw new Error('relay_no_envelope');
        }
        return body.envelope;
    };
}

/** Build the stdio MCP server around a SealedClient. */
export function buildShim(client) {
    const server = new Server(
        { name: 'fire-bridge', version: '1.0.0' },
        { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOLS,
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args = {} } = request.params;
        if (!TOOLS.some((t) => t.name === name)) {
            return {
                isError: true,
                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            };
        }
        try {
            const result = await client.call(name, args);
            return {
                content: [
                    { type: 'text', text: JSON.stringify(result, null, 2) },
                ],
            };
        } catch (err) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error: ${String(err.message || err)}`,
                    },
                ],
            };
        }
    });
    return server;
}

async function main() {
    const pairing = (process.env.FIRE_BRIDGE_PAIRING || '').trim();
    const relay = (process.env.FIRE_BRIDGE_RELAY_URL || '').trim();
    if (!pairing || !relay) {
        console.error(
            'fire-bridge: set FIRE_BRIDGE_PAIRING (from the consent page) and FIRE_BRIDGE_RELAY_URL.',
        );
        process.exit(2);
    }
    const { channel, hello } = await acceptPairing(pairing);
    const carrier = createHttpCarrier(relay, channel.sid);
    await carrier({ hello });
    const client = new SealedClient({
        channel,
        send: async (envelope) => carrier({ envelope }),
    });
    await buildShim(client).connect(new StdioServerTransport());
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    main().catch((err) => {
        console.error(`fire-bridge: ${err.message}`);
        process.exit(1);
    });
}
