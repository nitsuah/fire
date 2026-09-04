import { describe, it, expect, afterEach } from 'vitest';
import {
    isEnsName,
    resolveEnsAddress,
    _setProviderForTests,
} from '../../app/lib/ens-resolver.js';

describe('isEnsName', () => {
    it('accepts simple .eth names', () => {
        expect(isEnsName('vitalik.eth')).toBe(true);
        expect(isEnsName('my-wallet.eth')).toBe(true);
    });

    it('accepts subdomain .eth names', () => {
        expect(isEnsName('sub.vitalik.eth')).toBe(true);
    });

    it('rejects non-.eth or malformed input', () => {
        expect(isEnsName('vitalik')).toBe(false);
        expect(isEnsName('vitalik.com')).toBe(false);
        expect(isEnsName('.eth')).toBe(false);
        expect(isEnsName('-bad.eth')).toBe(false);
        expect(isEnsName('')).toBe(false);
        expect(isEnsName(null)).toBe(false);
        expect(isEnsName(123)).toBe(false);
    });

    it('trims whitespace before validating', () => {
        expect(isEnsName('  vitalik.eth  ')).toBe(true);
    });
});

describe('resolveEnsAddress', () => {
    afterEach(() => {
        _setProviderForTests(undefined);
    });

    it('rejects non-ENS input before touching the provider', async () => {
        await expect(resolveEnsAddress('not-a-name')).rejects.toMatchObject({
            code: 'INVALID_NAME',
        });
    });

    it('returns the resolved address on success', async () => {
        _setProviderForTests({
            resolveName: async (name) => {
                expect(name).toBe('vitalik.eth');
                return '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'.slice(
                    0,
                    42,
                );
            },
        });
        const address = await resolveEnsAddress('vitalik.eth');
        expect(address).toMatch(/^0x/);
    });

    it('throws NOT_FOUND when the name has no address record', async () => {
        _setProviderForTests({ resolveName: async () => null });
        await expect(resolveEnsAddress('nobody.eth')).rejects.toMatchObject({
            code: 'NOT_FOUND',
        });
    });

    it('wraps provider/network errors as RESOLVE_FAILED', async () => {
        _setProviderForTests({
            resolveName: async () => {
                throw new Error('network down');
            },
        });
        await expect(resolveEnsAddress('vitalik.eth')).rejects.toMatchObject({
            code: 'RESOLVE_FAILED',
        });
    });
});
