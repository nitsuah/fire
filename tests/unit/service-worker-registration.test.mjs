import { describe, it, expect, vi, afterEach } from 'vitest';

describe('service-worker-registration', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('registers /sw.js once the window load event fires', async () => {
        const handlers = {};
        const register = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { serviceWorker: { register } });
        vi.stubGlobal('window', {
            addEventListener: (name, fn) => {
                handlers[name] = fn;
            },
        });

        await import('../../app/lib/service-worker-registration.js');
        expect(register).not.toHaveBeenCalled();
        handlers.load();
        expect(register).toHaveBeenCalledWith('/sw.js');
    });

    it('does nothing when service workers are unsupported', async () => {
        const addEventListener = vi.fn();
        vi.stubGlobal('navigator', {});
        vi.stubGlobal('window', { addEventListener });

        await import('../../app/lib/service-worker-registration.js');
        expect(addEventListener).not.toHaveBeenCalled();
    });

    it('is loaded by index.html as a native module', async () => {
        const fs = await import('node:fs');
        const html = fs.readFileSync(
            new URL('../../app/index.html', import.meta.url),
            'utf8',
        );
        expect(html).toContain(
            '<script type="module" src="lib/service-worker-registration.js"></script>',
        );
    });
});
