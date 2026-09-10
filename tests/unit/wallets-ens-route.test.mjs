import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import walletsRouter from '../../app/routes/wallets.js';

// Only the fully deterministic, network-free path is exercised here (invalid
// name never reaches resolveEnsAddress). The resolver's own error-code
// behavior is covered by ens-resolver.test.mjs (via an injected provider)
// and the aggregation/error-mapping logic by ens-wallet-lookup.test.mjs
// (via stub functions) — that split avoids mocking CJS modules mid-require
// chain, which proved unreliable under Vitest's CJS/ESM interop, and avoids
// depending on real network access in the test sandbox.
function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/wallets', walletsRouter);
    return app;
}

describe('GET /api/wallets/ens/:name', () => {
    it('rejects a non-.eth name with 400 before any lookup', async () => {
        const res = await request(buildApp()).get('/api/wallets/ens/notanens');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/valid \.eth ENS name/i);
    });

    it('rejects an empty-looking name with 400', async () => {
        const res = await request(buildApp()).get('/api/wallets/ens/%20.eth');
        expect(res.status).toBe(400);
    });
});
