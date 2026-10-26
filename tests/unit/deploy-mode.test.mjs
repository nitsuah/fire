import { describe, expect, it, beforeEach } from 'vitest';
import deployMode from '../../app/lib/deploy-mode.js';

beforeEach(() => deployMode.reset());

describe('deploy mode signal', () => {
    it('is unknown until a probe reports', () => {
        expect(deployMode.isUnknown()).toBe(true);
        expect(deployMode.known()).toBeNull();
        expect(deployMode.isHosted()).toBe(false);
    });

    it('reports self-hosted when /api/state answers', () => {
        deployMode.resolve(true);
        expect(deployMode.isHosted()).toBe(false);
        expect(deployMode.known()).toBe(false);
    });

    it('reports hosted when /api/state is unreachable', () => {
        deployMode.resolve(false);
        expect(deployMode.isHosted()).toBe(true);
    });

    it('keeps the first answer — a later re-sync cannot flip the mode', () => {
        deployMode.resolve(true);
        deployMode.resolve(false);
        expect(deployMode.isHosted()).toBe(false);
    });

    it('whenKnown resolves as soon as the probe answers', async () => {
        const waited = deployMode.whenKnown();
        deployMode.resolve(false);
        await expect(waited).resolves.toBe(true);
    });

    // The regression #292 names: a self-hosted tab whose /api/state is slow
    // must not read as hosted (and paint "Disconnected" from localStorage).
    it('a slow probe yields null, not a wrong answer', async () => {
        await expect(deployMode.whenKnown(10)).resolves.toBeNull();
        // Nothing was guessed: the mode is still simply unknown.
        expect(deployMode.isUnknown()).toBe(true);
        deployMode.resolve(true);
        expect(deployMode.isHosted()).toBe(false);
    });
});
