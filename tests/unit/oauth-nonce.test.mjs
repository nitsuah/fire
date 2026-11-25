import { describe, it, expect } from 'vitest';
import { cleanNonce, nonceSuffix } from '../../app/lib/oauth-nonce.js';

describe('cleanNonce', () => {
    it('valid 32 lowercase hex chars is returned unchanged', () => {
        const nonce = '0123456789abcdef0123456789abcdef';
        expect(cleanNonce(nonce)).toBe(nonce);
    });

    it('array input returns first element when valid', () => {
        const nonce = '0123456789abcdef0123456789abcdef';
        expect(cleanNonce([nonce, 'other'])).toBe(nonce);
    });

    it('uppercase hex returns empty string', () => {
        expect(cleanNonce('0123456789ABCDEF0123456789ABCDEF')).toBe('');
    });

    it('31 chars returns empty string', () => {
        expect(cleanNonce('0123456789abcdef0123456789abcde')).toBe('');
    });

    it('33 chars returns empty string', () => {
        expect(cleanNonce('0123456789abcdef0123456789abcdef0')).toBe('');
    });

    it('non-string (number) returns empty string', () => {
        expect(cleanNonce(42)).toBe('');
    });

    it('non-string (null) returns empty string', () => {
        expect(cleanNonce(null)).toBe('');
    });

    it('non-string (undefined) returns empty string', () => {
        expect(cleanNonce(undefined)).toBe('');
    });

    it('non-string (object) returns empty string', () => {
        expect(cleanNonce({})).toBe('');
    });
});

describe('nonceSuffix', () => {
    it('valid nonce returns &n=<nonce>', () => {
        const nonce = '0123456789abcdef0123456789abcdef';
        expect(nonceSuffix(nonce)).toBe(`&n=${nonce}`);
    });

    it('invalid nonce returns empty string', () => {
        expect(nonceSuffix('invalid')).toBe('');
        expect(nonceSuffix('0123456789ABCDEF0123456789ABCDEF')).toBe('');
        expect(nonceSuffix(42)).toBe('');
        expect(nonceSuffix(null)).toBe('');
    });
});
