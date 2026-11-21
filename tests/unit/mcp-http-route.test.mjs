import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

const TEST_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'fire-mcp-http-test-'),
);
const TEST_DB_FILE = path.join(TEST_DATA_DIR, 'db.json');
const TEST_MASTER_KEY = '22'.repeat(32);
const TEST_API_KEY = 'test-fire-api-key-123';

const PREVIOUS_ENV = {
    FIRE_DATA_DIR: process.env.FIRE_DATA_DIR,
    FIRE_DB_FILE: process.env.FIRE_DB_FILE,
    FIRE_AUTH_DISABLED: process.env.FIRE_AUTH_DISABLED,
    FIRE_RATE_LIMIT_DISABLED: process.env.FIRE_RATE_LIMIT_DISABLED,
    SYNC_MASTER_KEY: process.env.SYNC_MASTER_KEY,
    FIRE_API_KEY: process.env.FIRE_API_KEY,
};

process.env.FIRE_DATA_DIR = TEST_DATA_DIR;
process.env.FIRE_DB_FILE = TEST_DB_FILE;
process.env.FIRE_AUTH_DISABLED = 'true';
process.env.FIRE_RATE_LIMIT_DISABLED = 'true';
process.env.SYNC_MASTER_KEY = TEST_MASTER_KEY;
process.env.FIRE_API_KEY = TEST_API_KEY;

let app;

beforeAll(async () => {
    const serverModule = await import('../../app/server.js');
    app = serverModule.default;
    // Initialize database
    const { initDatabase } = await import('../../app/lib/db.js');
    initDatabase();
});

afterAll(() => {
    // Restore env
    for (const [key, value] of Object.entries(PREVIOUS_ENV)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    // Clean up temp files
    try {
        fs.unlinkSync(TEST_DB_FILE);
    } catch {
        /* ignore */
    }
    try {
        fs.unlinkSync(`${TEST_DB_FILE}.tmp`);
    } catch {
        /* ignore */
    }
    try {
        fs.rmSync(TEST_DATA_DIR, { recursive: true });
    } catch {
        /* ignore */
    }
});

function getAuthHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/event-stream',
    };
}

describe('MCP HTTP route /mcp', () => {
    it('returns 401 with no Authorization header', async () => {
        const res = await request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .send({ jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized.');
        expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('returns 401 with wrong token', async () => {
        const res = await request(app)
            .post('/mcp')
            .set(getAuthHeaders('wrong-token'))
            .send({ jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized.');
    });

    it('returns 401 with x-api-key header only (not accepted)', async () => {
        const res = await request(app)
            .post('/mcp')
            .set('x-api-key', TEST_API_KEY)
            .set('Accept', 'application/json, text/event-stream')
            .send({ jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized.');
    });

    it('returns 503 when FIRE_API_KEY is unset at runtime', async () => {
        delete process.env.FIRE_API_KEY;
        try {
            const res = await request(app)
                .post('/mcp')
                .set(getAuthHeaders(TEST_API_KEY))
                .send({
                    jsonrpc: '2.0',
                    method: 'initialize',
                    params: {},
                    id: 1,
                });
            expect(res.status).toBe(503);
            expect(res.body.error).toBe(
                'MCP endpoint disabled: FIRE_API_KEY is not set.',
            );
        } finally {
            process.env.FIRE_API_KEY = TEST_API_KEY;
        }
    });

    it('returns 200 with valid token for initialize', async () => {
        const res = await request(app)
            .post('/mcp')
            .set(getAuthHeaders(TEST_API_KEY))
            .send({
                jsonrpc: '2.0',
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'test-client', version: '1.0.0' },
                },
                id: 1,
            });
        expect(res.status).toBe(200);
        expect(res.body.result.serverInfo.name).toBe('fire-tracker');
    });

    it('tools/list returns exactly the names in TOOLS', async () => {
        const { TOOLS } = await import('../../app/mcp-server.mjs');
        const res = await request(app)
            .post('/mcp')
            .set(getAuthHeaders(TEST_API_KEY))
            .send({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 2 });
        expect(res.status).toBe(200);
        const toolNames = res.body.result.tools.map((t) => t.name).sort();
        const expectedNames = TOOLS.map((t) => t.name).sort();
        expect(toolNames).toEqual(expectedNames);
    });

    it('tools/call fire_status_summary returns text content that parses as JSON', async () => {
        const res = await request(app)
            .post('/mcp')
            .set(getAuthHeaders(TEST_API_KEY))
            .send({
                jsonrpc: '2.0',
                method: 'tools/call',
                params: { name: 'fire_status_summary', arguments: {} },
                id: 3,
            });
        expect(res.status).toBe(200);
        expect(res.body.result.content).toBeDefined();
        expect(res.body.result.content[0].type).toBe('text');
        const parsed = JSON.parse(res.body.result.content[0].text);
        expect(parsed.fireNumber).toBeDefined();
        expect(parsed.currentNetWorth).toBeDefined();
        expect(parsed.progressPercent).toBeDefined();
    });

    it('unknown tool name returns isError: true', async () => {
        const res = await request(app)
            .post('/mcp')
            .set(getAuthHeaders(TEST_API_KEY))
            .send({
                jsonrpc: '2.0',
                method: 'tools/call',
                params: { name: 'nonexistent_tool', arguments: {} },
                id: 4,
            });
        expect(res.status).toBe(200);
        expect(res.body.result.isError).toBe(true);
        expect(res.body.result.content[0].text).toMatch(
            /^Error: Unknown tool:/,
        );
    });

    it('GET /mcp with valid token returns 405', async () => {
        const res = await request(app)
            .get('/mcp')
            .set(getAuthHeaders(TEST_API_KEY));
        expect(res.status).toBe(405);
        expect(res.headers.allow).toBe('POST');
        expect(res.body.error).toBe('Method not allowed.');
    });

    it('DELETE /mcp with valid token returns 405', async () => {
        const res = await request(app)
            .delete('/mcp')
            .set(getAuthHeaders(TEST_API_KEY));
        expect(res.status).toBe(405);
        expect(res.headers.allow).toBe('POST');
    });
});