'use strict';

import { describe, it, expect } from 'vitest';

globalThis.document = {
readyState: 'complete',
getElementById: () => ({ addEventListener() {} }),
addEventListener() {},
};
globalThis.localStorage = { getItem: () => '1', setItem() {} };

const { stripNavRow } = await import('./privacy.js');

describe('stripNavRow', () => {
it('removes a line ending in <!-- nav -->', () => {
const md = `# Title\n\n> 🧭 [fire](../README.md) · [Features](./FEATURES.md) · [Roadmap](./ROADMAP.md) · [Tasks](./TASKS.md) · [Changelog](./CHANGELOG.md) · [Metrics](./METRICS.md) <!-- nav -->\n\nContent here`;
const out = stripNavRow(md);
expect(out).not.toContain('<!-- nav -->');
expect(out).toContain('Content here');
expect(out).toContain('# Title');
});

it('leaves other lines unchanged', () => {
const md = `Line 1\nLine 2\nLine 3`;
const out = stripNavRow(md);
expect(out).toBe(md);
});
});