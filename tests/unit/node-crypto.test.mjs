import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('node-crypto', () => {
    it('is the runtime crypto module with AES-GCM available', () => {
        const crypto = require('../../app/lib/node-crypto.js');
        expect(crypto).toBe(require('node:crypto'));
        expect(typeof crypto.createCipheriv).toBe('function');
    });

    it('seals and opens with crypto-utils', () => {
        const prev = process.env.SYNC_MASTER_KEY;
        process.env.SYNC_MASTER_KEY = 'a'.repeat(64);
        try {
            const {
                encrypt,
                decrypt,
            } = require('../../app/lib/crypto-utils.js');
            expect(decrypt(encrypt('round trip'))).toBe('round trip');
        } finally {
            if (prev === undefined) delete process.env.SYNC_MASTER_KEY;
            else process.env.SYNC_MASTER_KEY = prev;
        }
    });
});
