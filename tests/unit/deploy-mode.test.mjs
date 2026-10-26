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

    // A "hosted" answer can come from a request that merely failed, so a later
    // probe that does reach a server must be able to replace it (#297 review).
    it('a failed probe does not permanently mark the tab hosted', () => {
        deployMode.resolve(false); // request failed
        expect(deployMode.isHosted()).toBe(true);
        deployMode.resolve(true); // the server answered on a later probe
        expect(deployMode.isHosted()).toBe(false);
        expect(deployMode.known()).toBe(false);
    });

    it('a confirmed server is never flipped back to hosted', () => {
        deployMode.resolve(true);
        deployMode.resolve(false);
        deployMode.resolve(false);
        expect(deployMode.isHosted()).toBe(false);
    });

    it('re-reporting the same answer is a no-op', () => {
        deployMode.resolve(false);
        expect(deployMode.resolve(false)).toBe(true);
        deployMode.resolve(true);
        expect(deployMode.resolve(true)).toBe(false);
    });

    // A wait that the probe wins must not leave its timeout armed (#297 review).
    it('a probe answer clears pending wait timers', async () => {
        const waited = deployMode.whenKnown(5000);
        deployMode.resolve(true);
        await expect(waited).resolves.toBe(false);
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
