import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const configPath = resolve('relay/wrangler.toml');
const content = readFileSync(configPath, 'utf-8');

describe('relay/wrangler.toml', () => {
    it('contains an active BRIDGE_SESSIONS binding with the correct class name', () => {
        // Drop comment lines so a commented-out block cannot pass.
        const active = content
            .split(/\r?\n/)
            .map((line) => line.replace(/#.*$/, '').trim())
            .filter(Boolean);
        const start = active.indexOf('[[durable_objects.bindings]]');
        expect(start).toBeGreaterThanOrEqual(0);
        const next = active.findIndex(
            (line, i) => i > start && line.startsWith('['),
        );
        const block = active.slice(start + 1, next === -1 ? undefined : next);
        expect(block).toContain('name = "BRIDGE_SESSIONS"');
        expect(block).toContain('class_name = "BridgeSessionObject"');
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
