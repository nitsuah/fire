import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateMapping } = require('../../app/lib/jsonata-eval.js');

describe('evaluateMapping (worker-thread JSONata)', () => {
    it('evaluates a mapping against the input', async () => {
        const out = await evaluateMapping('{ "name": a.b, "n": $count(c) }', {
            a: { b: 'x' },
            c: [1, 2, 3],
        });
        expect(out).toEqual({ name: 'x', n: 3 });
    });

    it('rejects an invalid expression', async () => {
        await expect(evaluateMapping('{{{nope', {})).rejects.toThrow();
    });

    it('terminates a long-running expression at the timeout', async () => {
        const started = Date.now();
        await expect(
            evaluateMapping(
                '$count([1..9000000].($ * 2 + $ * 3))',
                {},
                { timeoutMs: 300 },
            ),
        ).rejects.toThrow(/timed out/);
        expect(Date.now() - started).toBeLessThan(3000);
    });

    it('keeps the main thread responsive while the expression runs', async () => {
        let ticks = 0;
        const timer = setInterval(() => ticks++, 20);
        await evaluateMapping(
            '$count([1..9000000].($ * 2 + $ * 3))',
            {},
            { timeoutMs: 400 },
        ).catch(() => {});
        clearInterval(timer);
        expect(ticks).toBeGreaterThan(3);
    });

    it('rejects an oversized result', async () => {
        await expect(
            evaluateMapping('[1..100000]', {}, { maxResultBytes: 1000 }),
        ).rejects.toThrow(/too large/);
    });

    it('rejects an oversized mapping without evaluating it', async () => {
        await expect(
            evaluateMapping('1+'.repeat(5000) + '1', {}),
        ).rejects.toThrow(/too large/);
    });
});
