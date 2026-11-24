// Calls every registered MCP tool against the demo seed and against an empty
// state. Guards the whole tool table (used by stdio, /mcp and the browser
// bridge) against a handler that throws or returns something unserialisable.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { TOOLS, handleTool } from '../../app/mcp-tools.mjs';

const require = createRequire(import.meta.url);
const SEED = require('../../promo/demo-seed.js');

const sampleArgs = (tool) => {
    // simulate_rebalance needs two different asset classes and an amount.
    if (tool.name === 'simulate_rebalance')
        return { soldAsset: 'equities', boughtAsset: 'cash', amount: 1000 };
    const args = {};
    const props = tool.inputSchema?.properties || {};
    for (const key of tool.inputSchema?.required || []) {
        const p = props[key] || {};
        if (p.enum) args[key] = p.enum[0];
        else if (p.type === 'number' || p.type === 'integer')
            args[key] = p.minimum ?? 1;
        else if (p.type === 'string') args[key] = 'x';
    }
    return args;
};

describe('every MCP tool', () => {
    it('is registered once with a schema', () => {
        const names = TOOLS.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
        for (const t of TOOLS) expect(t.inputSchema?.type).toBe('object');
    });

    for (const tool of TOOLS) {
        it(`${tool.name} runs on the demo seed`, () => {
            const out = handleTool(tool.name, SEED, sampleArgs(tool));
            expect(out).toBeTruthy();
            expect(() => JSON.stringify(out)).not.toThrow();
        });

        it(`${tool.name} survives an empty state`, () => {
            let out;
            try {
                out = handleTool(tool.name, {}, sampleArgs(tool));
            } catch (err) {
                // A clean, explained error is fine; a TypeError is not.
                expect(err).not.toBeInstanceOf(TypeError);
                return;
            }
            expect(() => JSON.stringify(out)).not.toThrow();
        });
    }

    it('rejects an unknown tool', () => {
        expect(() => handleTool('nope', SEED, {})).toThrow();
    });
});
