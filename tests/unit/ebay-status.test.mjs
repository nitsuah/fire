import { describe, it, expect } from 'vitest';
import { ebayStatusBadge } from '../../app/lib/ebay-status.js';

describe('ebayStatusBadge', () => {
    it('not configured is a warning and not connectable', () => {
        const b = ebayStatusBadge({ configured: false, connected: false });
        expect(b.label).toMatch(/not configured on this deployment/);
        expect(b.connectable).toBe(false);
    });

    it('connected with a failed last sync shows the error code', () => {
        const b = ebayStatusBadge({
            configured: true,
            connected: true,
            lastSyncOutcome: { ok: false, errorCode: 'TIMEOUT' },
        });
        expect(b.label).toBe('Last sync failed (TIMEOUT)');
        expect(b.color).toBe('var(--color-danger)');
    });

    it('connected is Connected; an absent outcome is not a failure', () => {
        expect(ebayStatusBadge({ configured: true, connected: true }).label).toBe('Connected');
        expect(
            ebayStatusBadge({ configured: true, connected: true, lastSyncOutcome: null }).label,
        ).toBe('Connected');
    });

    it('disconnected is connectable; offline (configured null) is connectable too', () => {
        expect(ebayStatusBadge({ configured: true, connected: false })).toEqual({
            label: 'Disconnected',
            color: 'var(--text-muted)',
            connectable: true,
        });
        expect(ebayStatusBadge({ configured: null, connected: false }).connectable).toBe(true);
    });
});