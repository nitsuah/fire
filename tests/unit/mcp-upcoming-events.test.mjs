import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';

process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-upcoming-events-${process.pid}.json`,
);

let handleTool;

beforeAll(async () => {
    ({ handleTool } = await import('../../app/mcp-server.mjs'));
});

const DAY_MS = 1000 * 60 * 60 * 24;
const inDays = (n) =>
    new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10);

const stateWith = (...cds) => ({ cds });

describe('get_upcoming_events', () => {
    it('returns CDs inside the window in date order', () => {
        const r = handleTool(
            'get_upcoming_events',
            stateWith(
                {
                    bank: 'Ally',
                    principal: 1000,
                    rate: 4.5,
                    maturity: inDays(60),
                },
                {
                    bank: 'Marcus',
                    principal: 5000,
                    rate: 5,
                    maturity: inDays(10),
                },
            ),
        );
        expect(r.count).toBe(2);
        expect(r.days).toBe(90);
        expect(r.events.map((e) => e.label)).toEqual(['Marcus CD', 'Ally CD']);
        expect(r.events[0]).toMatchObject({
            type: 'cd_maturity',
            amount: 5000,
            rate: 5,
        });
        expect(r.events[0].daysAway).toBeLessThan(r.events[1].daysAway);
    });

    it('honours the days window and drops CDs beyond it', () => {
        const r = handleTool(
            'get_upcoming_events',
            stateWith(
                { bank: 'Ally', maturity: inDays(30) },
                { bank: 'Marcus', maturity: inDays(400) },
            ),
            { days: 90 },
        );
        expect(r.events.map((e) => e.label)).toEqual(['Ally CD']);
    });

    it('keeps CDs that matured in the last 7 days with a negative daysAway', () => {
        const r = handleTool(
            'get_upcoming_events',
            stateWith(
                { bank: 'Fresh', maturity: inDays(-2) },
                { bank: 'Stale', maturity: inDays(-30) },
            ),
        );
        expect(r.events.map((e) => e.label)).toEqual(['Fresh CD']);
        expect(r.events[0].daysAway).toBeLessThan(0);
    });

    it('defaults to 90 days and ignores bad arguments', () => {
        expect(handleTool('get_upcoming_events', stateWith()).days).toBe(90);
        expect(
            handleTool('get_upcoming_events', stateWith(), { days: 0 }).days,
        ).toBe(90);
        expect(
            handleTool('get_upcoming_events', stateWith(), { days: 5000 }).days,
        ).toBe(90);
        expect(
            handleTool('get_upcoming_events', stateWith(), { days: 30 }).days,
        ).toBe(30);
    });

    it('skips CDs with no parseable maturity and handles an empty state', () => {
        const r = handleTool(
            'get_upcoming_events',
            stateWith({ bank: 'None' }, { bank: 'Bad', maturity: 'soon' }),
        );
        expect(r.events).toEqual([]);
        expect(handleTool('get_upcoming_events', {}).count).toBe(0);
    });
});
