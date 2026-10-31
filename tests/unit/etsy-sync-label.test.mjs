import { describe, it, expect } from 'vitest';

const {
    ETSY_LAST_OUTCOME_KEY,
    etsyBuildOutcome,
    etsyReadOutcome,
    etsyWriteOutcome,
    etsyFailedSyncText,
} = await import('../../app/lib/etsy-sync.js');

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
function fakeStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    };
}
describe('Etsy last-sync outcome storage', () => {
    it('records failures and lets a later success replace them', () => {
        const storage = fakeStorage();
        etsyWriteOutcome(
            storage,
            etsyBuildOutcome({
                at: '2026-10-31T12:00:00.000Z',
                ok: false,
                errorCode: 'ETSY_UNAUTHORIZED',
            }),
        );
        expect(etsyReadOutcome(storage)).toEqual({
            at: '2026-10-31T12:00:00.000Z',
            ok: false,
            errorCode: 'etsy_unauthorized',
        });
        etsyWriteOutcome(storage, {
            at: '2026-10-31T12:05:00.000Z',
            ok: true,
            errorCode: null,
        });
        expect(etsyReadOutcome(storage)).toEqual({
            at: '2026-10-31T12:05:00.000Z',
            ok: true,
            errorCode: null,
        });
    });
    it('strips extra fields and normalizes safe codes', () => {
        const storage = fakeStorage();
        storage.setItem(
            ETSY_LAST_OUTCOME_KEY,
            JSON.stringify({
                at: '2026-10-31T12:00:00.000Z',
                ok: false,
                errorCode: 'ETSY_BAD-CODE',
                message: 'private provider detail',
                tokens: 'sealed-token-blob',
            }),
        );
        const outcome = etsyReadOutcome(storage);
        expect(outcome).toEqual({
            at: '2026-10-31T12:00:00.000Z',
            ok: false,
            errorCode: 'etsy_bad-code',
        });
        expect(Object.keys(outcome)).toEqual(['at', 'ok', 'errorCode']);
        expect(
            etsyBuildOutcome({
                at: 1,
                ok: 1,
                errorCode: 'unsafe code!',
            }),
        ).toEqual({
            at: null,
            ok: false,
            errorCode: null,
        });
    });
    it('returns null for missing, malformed, primitive, and array values', () => {
        const storage = fakeStorage();
        expect(etsyReadOutcome(storage)).toBeNull();
        for (const raw of ['{', 'null', '[]', '42', '"string"', '{}']) {
            storage.setItem(ETSY_LAST_OUTCOME_KEY, raw);
            expect(etsyReadOutcome(storage)).toBeNull();
        }
    });
    it('clears the key and fails open when storage throws', () => {
        const storage = fakeStorage();
        etsyWriteOutcome(storage, {
            at: '2026-10-31T12:00:00.000Z',
            ok: false,
        });
        etsyWriteOutcome(storage, null);
        expect(etsyReadOutcome(storage)).toBeNull();
        const blocked = {
            getItem() {
                throw new Error('storage blocked');
            },
            setItem() {
                throw new Error('storage blocked');
            },
            removeItem() {
                throw new Error('storage blocked');
            },
        };
        expect(etsyReadOutcome(blocked)).toBeNull();
        expect(() =>
            etsyWriteOutcome(blocked, {
                at: '2026-10-31T12:00:00.000Z',
                ok: false,
            }),
        ).not.toThrow();
        expect(() => etsyWriteOutcome(blocked, null)).not.toThrow();
    });
});
