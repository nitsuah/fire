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
const state = { importedPositions: [], customAccounts: [
    { id: '1', name: 'Checking', type: 'Cash', value: 50000 },
    { id: '2', name: 'Brokerage', type: 'Brokerage', value: 100000 },
  ], cds: [], expenses: { housing: 1500 }, insurances: [], projectionSettings: { swr: 4 },
  sideGigLedger: [], transactions: [] };
// Valid arguments where a tool's real code path needs them; {} for the rest.
const ARGS = {
  simulate_rebalance: { soldAsset: 'equities', amount: 10000, boughtAsset: 'cash' },
  get_transactions: { offset: 0, limit: 10 },
};
const calls = [...m.TOOLS.map((t) => [t.name, ARGS[t.name] ?? {}]), ['simulate_rebalance', { chaos: true }]];
const binding = /is not a function|undefined|TypeError/;
const failures = [];
for (const [name, args] of calls) {
  const label = name + (args.chaos ? '(chaos)' : '');
  try {
    const r = m.handleTool(name, state, args);
    if (r && typeof r.error === 'string' && binding.test(r.error)) failures.push(label + ': ' + r.error);
    // simulate_rebalance must reach its helpers, not stop at input validation.
    if (name === 'simulate_rebalance' && (!r || r.error)) failures.push(label + ' returned ' + JSON.stringify(r).slice(0, 200));
  } catch (e) {
    if (e instanceof TypeError || name === 'simulate_rebalance') failures.push(label + ': ' + e.message);
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
