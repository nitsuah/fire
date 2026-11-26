import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('hosted privacy policy copy', () => {
    it('keeps the Pages-served policy identical to the source policy', () => {
        const source = readFileSync(
            new URL('../../docs/privacy-policy.md', import.meta.url),
        );
        const hosted = readFileSync(
            new URL('../../app/docs/privacy-policy.md', import.meta.url),
        );

        expect(
            hosted.equals(source),
            'app/docs/privacy-policy.md must match docs/privacy-policy.md; re-run: mkdir -p app/docs && cp docs/privacy-policy.md app/docs/privacy-policy.md',
        ).toBe(true);
    });
});
