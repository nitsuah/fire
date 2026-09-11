import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Safety invariant from docs/security-hardening.md's pen test checklist
// ("MCP-Specific" section): the MCP server must never register a tool that
// can mutate db.json. An LLM driving this server should only ever be able
// to read financial data, never change it. This is checked two ways below:
//   1. behaviorally — call every registered tool and confirm db.json on
//      disk is byte-for-byte unchanged afterward (the test that actually
//      caught app/mcp-server.mjs's former `set_price_target_alert`, which
//      called writeState() despite the server being documented read-only);
//   2. by name, as a lighter defense-in-depth / documentation-level check
//      for obviously mutating verbs, per the checklist's own wording.
//
// FIRE_DB_FILE must be set before app/mcp-server.mjs (and the app/lib/db.js
// it requires internally) is first loaded, so mcp-server.mjs is imported
// dynamically inside beforeAll rather than via a static top-level import
// (static imports are hoisted above this assignment).
const TEST_DB = path.join(
    os.tmpdir(),
    `fire-mcp-readonly-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;

const require = createRequire(import.meta.url);
// Same absolute path mcp-server.mjs requires internally, so this shares
// Node's CJS module cache with it (same DB_FILE, same in-memory state).
const { initDatabase, readState } = require('../../app/lib/db.js');

let TOOLS;
let handleTool;

beforeAll(async () => {
    initDatabase();
    // Generous timeout: first import of mcp-server.mjs cold-loads the MCP
    // SDK and its transitive deps, which is slow under a bind-mounted
    // Docker volume (e.g. Docker Desktop on Windows).
    ({ TOOLS, handleTool } = await import('../../app/mcp-server.mjs'));
}, 60000);

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        /* ignore */
    }
    try {
        fs.unlinkSync(`${TEST_DB}.tmp`);
    } catch {
        /* ignore */
    }
});

function dummyArgsFor(tool) {
    const props = tool.inputSchema?.properties || {};
    const required = tool.inputSchema?.required || [];
    const args = {};
    for (const key of required) {
        const schema = props[key] || {};
        if (schema.type === 'number') args[key] = 1;
        else if (schema.type === 'boolean') args[key] = true;
        else args[key] = 'test-value';
    }
    return args;
}

describe('MCP server tool registry is read-only', () => {
    it('registers at least one tool (sanity check the import worked)', () => {
        expect(Array.isArray(TOOLS)).toBe(true);
        expect(TOOLS.length).toBeGreaterThan(0);
    });

    it('exposes no tool name containing an obvious mutation verb', () => {
        const mutationVerbs =
            /(^|_)(create|add|update|edit|delete|remove|write|save|persist|put|patch|insert|append|destroy)($|_)/i;
        const offenders = TOOLS.map((t) => t.name).filter((name) =>
            mutationVerbs.test(name),
        );
        expect(offenders).toEqual([]);
    });

    it('never modifies db.json when every registered tool is called', () => {
        const before = fs.readFileSync(TEST_DB, 'utf8');
        const state = readState();

        for (const tool of TOOLS) {
            try {
                handleTool(tool.name, state, dummyArgsFor(tool));
            } catch {
                // A tool rejecting its dummy args (e.g. bad business-logic
                // input) is irrelevant here — only disk mutation matters.
            }
        }

        const after = fs.readFileSync(TEST_DB, 'utf8');
        expect(after).toBe(before);
        expect(fs.existsSync(`${TEST_DB}.tmp`)).toBe(false);
    });
});
