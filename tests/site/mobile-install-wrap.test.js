const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
    path.join(__dirname, '..', '..', 'site', 'styles.css'),
    'utf8',
);
const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'site', 'index.html'),
    'utf8',
);

describe('mobile install command wrapping', () => {
    it('wraps the install panels without changing their copy payloads', () => {
        expect(css).toMatch(/#install \.install\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;/s);
        expect(css).not.toContain('overflow-x: visible;');

        const start = html.indexOf('<section class="install-sec" id="install"');
        const end = html.indexOf('</section>', start);
        const section = html.slice(start, end);
        const payloads = [...section.matchAll(/data-copy="([^"]*)"/g)].map((match) => match[1]);

        expect(payloads).toHaveLength(2);
        expect(payloads[0]).toContain('node -e');
        expect(payloads[1]).toBe('docker compose up -d');
    });
});
