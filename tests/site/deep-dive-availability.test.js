const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'site', 'index.html'),
    'utf8',
);

describe('showcase tour availability', () => {
    it('does not promise narrated deep dives that are not published', () => {
        expect(html).not.toContain('Narrated deep dives on Projections');
        expect(html).not.toContain('are rendered from the real app in');
        expect(html).toContain('85-second');
    });
});
