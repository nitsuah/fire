import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { tokensMatch } = require('../../app/lib/safe-compare.js');

describe('tokensMatch', () => {
    const KEY = 'k'.repeat(40);

    it('accepts the exact value', () => {
        expect(tokensMatch(KEY, KEY)).toBe(true);
    });

    it('rejects a wrong value of the same length', () => {
        expect(tokensMatch(`${'k'.repeat(39)}x`, KEY)).toBe(false);
    });

    it('rejects a prefix, an extension and an empty value', () => {
        expect(tokensMatch(KEY.slice(0, 10), KEY)).toBe(false);
        expect(tokensMatch(`${KEY}k`, KEY)).toBe(false);
        expect(tokensMatch('', KEY)).toBe(false);
    });

    it('rejects missing or non-string input', () => {
        expect(tokensMatch(undefined, KEY)).toBe(false);
        expect(tokensMatch(null, KEY)).toBe(false);
        expect(tokensMatch([KEY], KEY)).toBe(false);
        expect(tokensMatch(KEY, null)).toBe(false);
    });

    it('compares with crypto.timingSafeEqual', () => {
        const spy = vi.spyOn(crypto, 'timingSafeEqual');
        try {
            tokensMatch('abc', KEY);
            expect(spy).toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
});
