import { describe, it, expect } from 'vitest';
import {
    REAUTH_CODES,
    failureCode,
    reauthRequired,
} from '../../app/lib/plaid-status.js';

describe('failureCode', () => {
    it('returns plaidErrorCode when both are set', () => {
        expect(
            failureCode({
                plaidErrorCode: 'ITEM_LOGIN_REQUIRED',
                code: 'OTHER',
            }),
        ).toBe('ITEM_LOGIN_REQUIRED');
    });

    it('returns code when plaidErrorCode is absent', () => {
        expect(failureCode({ code: 'SOME_CODE' })).toBe('SOME_CODE');
    });

    it('returns REQUEST_FAILED for empty object', () => {
        expect(failureCode({})).toBe('REQUEST_FAILED');
    });

    it('returns REQUEST_FAILED for null', () => {
        expect(failureCode(null)).toBe('REQUEST_FAILED');
    });

    it('returns REQUEST_FAILED for undefined', () => {
        expect(failureCode(undefined)).toBe('REQUEST_FAILED');
    });
});

describe('reauthRequired', () => {
    it('is true when any item has a REAUTH_CODE', () => {
        for (const code of REAUTH_CODES) {
            expect(reauthRequired([{ lastErrorCode: code }])).toBe(true);
        }
    });

    it('is false for RATE_LIMIT', () => {
        expect(reauthRequired([{ lastErrorCode: 'RATE_LIMIT' }])).toBe(false);
    });

    it('is false for empty array', () => {
        expect(reauthRequired([])).toBe(false);
    });

    it('is false for null', () => {
        expect(reauthRequired(null)).toBe(false);
    });

    it('is false for undefined', () => {
        expect(reauthRequired(undefined)).toBe(false);
    });

    it('tolerates a null entry inside the array', () => {
        expect(
            reauthRequired([null, { lastErrorCode: 'ITEM_LOGIN_REQUIRED' }]),
        ).toBe(true);
        expect(reauthRequired([null, { lastErrorCode: 'RATE_LIMIT' }])).toBe(
            false,
        );
    });
});

describe('REAUTH_CODES', () => {
    it('has exactly 4 members', () => {
        expect(REAUTH_CODES.size).toBe(4);
    });

    it('includes ITEM_LOGIN_REQUIRED', () => {
        expect(REAUTH_CODES.has('ITEM_LOGIN_REQUIRED')).toBe(true);
    });
});
