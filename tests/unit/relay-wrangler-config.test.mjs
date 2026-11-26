import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const configPath = resolve('relay/wrangler.toml');
const content = readFileSync(configPath, 'utf-8');

describe('relay/wrangler.toml', () => {
    it('contains the BRIDGE_SESSIONS binding with correct class name', () => {
        expect(content).toContain('name = "BRIDGE_SESSIONS"');
        expect(content).toContain('class_name = "BridgeSessionObject"');
    });

    it('has observability disabled', () => {
        // [observability] is followed by enabled = false
        expect(content).toMatch(/\[observability\]\s*enabled = false/);
    });

    it('contains no account_id', () => {
        expect(content).not.toContain('account_id');
    });

    it('contains no RELAY_HMAC_KEY assignment', () => {
        // No line that assigns RELAY_HMAC_KEY (e.g., RELAY_HMAC_KEY = "...")
        const lines = content.split('\n');
        const hasHmacAssignment = lines.some((line) =>
            line.trim().startsWith('RELAY_HMAC_KEY'),
        );
        expect(hasHmacAssignment).toBe(false);
    });
});
