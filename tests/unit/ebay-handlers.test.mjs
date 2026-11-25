import handlers from '../../app/lib/ebay-handlers.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let originalClientId;
let originalClientSecret;

const notification = (overrides = {}) => ({
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
    notification: { notificationId: 'abc-1' },
    ...overrides,
});

beforeEach(() => {
    originalClientId = process.env.EBAY_CLIENT_ID;
    originalClientSecret = process.env.EBAY_CLIENT_SECRET;
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    if (originalClientId === undefined) delete process.env.EBAY_CLIENT_ID;
    else process.env.EBAY_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.EBAY_CLIENT_SECRET;
    else process.env.EBAY_CLIENT_SECRET = originalClientSecret;
    vi.restoreAllMocks();
});

describe('isRevokedGrantError', () => {
    it.each([
        [{ status: 400, message: 'invalid_grant' }, true],
        [{ status: 401, body: 'Invalid_Grant: expired' }, true],
        [{ status: 500, message: 'invalid_grant' }, false],
        [{ status: 400, message: 'other' }, false],
        [{ status: 401, body: 'other', message: 'invalid_grant' }, false],
        [null, false],
        [undefined, false],
    ])('classifies %s as revoked=%s', (error, expected) => {
        expect(handlers.isRevokedGrantError(error)).toBe(expected);
    });
});

describe('handleDeletionNotification', () => {
    it('returns 503 when eBay is unconfigured and unsigned notifications are not allowed', async () => {
        await expect(
            handlers.handleDeletionNotification({ body: notification() }),
        ).resolves.toEqual({
            status: 503,
            body: {
                error: 'eBay not configured. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.',
            },
        });
    });

    it('acknowledges an allowed unsigned notification after purging', async () => {
        const purge = vi.fn();
        await expect(
            handlers.handleDeletionNotification({
                body: notification(),
                allowUnsigned: true,
                purge,
            }),
        ).resolves.toEqual({
            status: 200,
            body: { status: 'acknowledged' },
        });
        expect(purge).toHaveBeenCalledOnce();
    });

    it.each([
        [{ metadata: { topic: 'OTHER' }, notification: { notificationId: 'x' } }],
        [{ metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' } }],
    ])('rejects malformed notifications without purging', async (body) => {
        const purge = vi.fn();
        await expect(
            handlers.handleDeletionNotification({ body, allowUnsigned: true, purge }),
        ).resolves.toMatchObject({ status: 400 });
        expect(purge).not.toHaveBeenCalled();
    });

    it('returns a generic 500 when cleanup throws', async () => {
        const purge = vi.fn().mockRejectedValue(new Error('private cleanup detail'));
        await expect(
            handlers.handleDeletionNotification({
                body: notification(),
                allowUnsigned: true,
                purge,
            }),
        ).resolves.toEqual({
            status: 500,
            body: { error: 'Cleanup failed.' },
        });
    });

    it('acknowledges when no purge function is supplied', async () => {
        await expect(
            handlers.handleDeletionNotification({
                body: notification(),
                allowUnsigned: true,
            }),
        ).resolves.toEqual({
            status: 200,
            body: { status: 'acknowledged' },
        });
    });

    it('sanitizes newline-forged notification IDs before logging', async () => {
        await handlers.handleDeletionNotification({
            body: notification({
                notification: { notificationId: 'bad\nid' },
            }),
            allowUnsigned: true,
        });
        const logged = console.log.mock.calls.flat().join(' ');
        expect(logged).toContain('notificationId=invalid');
        expect(logged).not.toContain('bad\nid');
    });
});
