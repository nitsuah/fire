import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const policy = readFileSync(
    new URL('../../docs/privacy-policy.md', import.meta.url),
    'utf8',
).replaceAll(String.fromCharCode(13), '');
const summaryAt = policy.indexOf('## Summary');
const fullAt = policy.indexOf('## 1. Overview');
const bullets = policy
    .slice(summaryAt, fullAt)
    .split(String.fromCharCode(10))
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));

describe('privacy policy summary', () => {
    it('comes before the full policy', () => {
        expect(summaryAt).toBeGreaterThan(-1);
        expect(summaryAt).toBeLessThan(fullAt);
    });

    it('has three or four bullets', () => {
        expect(bullets.length).toBeGreaterThanOrEqual(3);
        expect(bullets.length).toBeLessThanOrEqual(4);
    });

    // The summary may only repeat the policy, so the two cannot drift apart.
    it.each(bullets)('repeats the full policy word for word: %s', (bullet) => {
        expect(policy.slice(fullAt)).toContain(bullet);
    });
});
