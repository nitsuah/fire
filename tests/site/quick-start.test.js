const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'site', 'index.html'),
  'utf8',
);

describe('Fire Quick Start', () => {
  it('separates configuration from the start command with exact copy payloads', () => {
    const start = html.indexOf('<section class="install-sec" id="install"');
    const end = html.indexOf('</section>', start);
    const section = html.slice(start, end);
    const payloads = [...section.matchAll(/data-copy="([^"]*)"/g)].map(
      (match) => match[1],
    );
    const configure =
      'git clone https://github.com/nitsuah/fire.git\n' +
      'cd fire\n' +
      'cp .env.example .env\n' +
      'node -e &quot;console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))&quot;';

    expect(start).toBeGreaterThanOrEqual(0);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toBe(configure);
    expect(payloads[0]).not.toContain('docker compose up -d');
    expect(payloads[1]).toBe('docker compose up -d');
  });

  it('explains where the generated key goes before the start command', () => {
    const start = html.indexOf('<section class="install-sec" id="install"');
    const end = html.indexOf('</section>', start);
    const section = html.slice(start, end);
    const keyInstruction = section.indexOf('FIRE_API_KEY');
    const startCommand = section.indexOf('data-copy="docker compose up -d"');

    expect(section).toContain('FIRE_AUTH_DISABLED=true');
    expect(keyInstruction).toBeGreaterThanOrEqual(0);
    expect(keyInstruction).toBeLessThan(startCommand);
  });
});
