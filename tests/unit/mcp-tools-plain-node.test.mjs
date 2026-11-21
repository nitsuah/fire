// Runs app/mcp-tools.mjs under plain Node ESM in a child process, outside
// vitest's CommonJS interop. Named imports from `module.exports = api` modules
// are undefined there, which once left 10 of 20 tools throwing TypeError in the
// real stdio server while every vitest test passed (#538 review).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const toolsUrl = pathToFileURL(resolve('app/mcp-tools.mjs')).href;

const script = `
const m = await import(${JSON.stringify(toolsUrl)});
const state = { importedPositions: [], customAccounts: [], cds: [], expenses: {},
  insurances: [], projectionSettings: { swr: 4 }, sideGigLedger: [], transactions: [] };
const failures = [];
for (const t of m.TOOLS) {
  try {
    const r = await m.handleTool(t.name, state, {}, {});
    if (r && typeof r.error === 'string' && /is not a function|undefined|TypeError/.test(r.error)) failures.push(t.name + ': ' + r.error);
  } catch (e) {
    if (e instanceof TypeError) failures.push(t.name + ': ' + e.message);
  }
}
process.stdout.write(JSON.stringify({ count: m.TOOLS.length, failures }));
`;

describe('mcp-tools under plain Node ESM', () => {
    it('every tool runs without TypeError outside vitest interop', () => {
        const out = spawnSync(
            process.execPath,
            ['--input-type=module', '-e', script],
            {
                encoding: 'utf8',
                timeout: 60_000,
            },
        );
        expect(out.status, out.stderr).toBe(0);
        const result = JSON.parse(out.stdout);
        expect(result.count).toBeGreaterThan(10);
        expect(result.failures).toEqual([]);
    });
});
