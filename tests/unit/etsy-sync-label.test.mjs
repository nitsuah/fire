import { describe, it, expect } from 'vitest';

const { etsyFailedSyncText } = await import('../../app/lib/etsy-sync.js');

describe('etsyFailedSyncText', () => {
    it('is null when there is no outcome or the last sync succeeded', () => {
        expect(etsyFailedSyncText(null)).toBeNull();
        expect(etsyFailedSyncText(undefined)).toBeNull();
        expect(
            etsyFailedSyncText({ at: '2026-10-27T00:00:00.000Z', ok: true }),
        ).toBeNull();
    });

    it('names the failure code', () => {
        const text = etsyFailedSyncText({
            at: '2026-10-27T00:00:00.000Z',
            ok: false,
            errorCode: 'etsy_unauthorized',
        });
        expect(text).toMatch(/^Last sync failed \(etsy_unauthorized\)/);
    });

    it('still reports a failure with no code and never shows a provider message', () => {
        const text = etsyFailedSyncText({
            ok: false,
            errorCode: null,
            message: 'provider says: secret detail',
        });
        expect(text).toBe('Last sync failed');
        expect(text).not.toContain('secret');
    });
});
