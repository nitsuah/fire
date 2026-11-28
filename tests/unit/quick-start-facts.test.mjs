import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { STEPS, quickStartProgress } = require('../../app/lib/quick-start.js');
const {
    DEFAULT_PROJECTION,
    buildQuickStartFacts,
} = require('../../app/lib/quick-start-facts.js');

describe('buildQuickStartFacts', () => {
    it('returns all six false for no input', () => {
        const facts = buildQuickStartFacts();
        expect(facts).toEqual({
            privacy: false,
            accounts: false,
            profile: false,
            providers: false,
            backup: false,
            explore: false,
        });
    });

    it('returns all six false for empty object', () => {
        const facts = buildQuickStartFacts({});
        expect(facts).toEqual({
            privacy: false,
            accounts: false,
            profile: false,
            providers: false,
            backup: false,
            explore: false,
        });
    });

    it('privacy true only when privacyAccepted is true', () => {
        expect(buildQuickStartFacts({ privacyAccepted: true }).privacy).toBe(
            true,
        );
        expect(buildQuickStartFacts({ privacyAccepted: false }).privacy).toBe(
            false,
        );
        expect(buildQuickStartFacts({ privacyAccepted: 'yes' }).privacy).toBe(
            false,
        );
        expect(buildQuickStartFacts({ privacyAccepted: 1 }).privacy).toBe(
            false,
        );
    });

    it('accounts true when either array is non-empty', () => {
        expect(
            buildQuickStartFacts({ state: { customAccounts: [{}] } }).accounts,
        ).toBe(true);
        expect(
            buildQuickStartFacts({ state: { importedPositions: [{}] } })
                .accounts,
        ).toBe(true);
        expect(
            buildQuickStartFacts({
                state: { customAccounts: [], importedPositions: [] },
            }).accounts,
        ).toBe(false);
        expect(
            buildQuickStartFacts({
                state: { customAccounts: null, importedPositions: null },
            }).accounts,
        ).toBe(false);
        expect(buildQuickStartFacts({ state: {} }).accounts).toBe(false);
        expect(buildQuickStartFacts({}).accounts).toBe(false);
    });

    it('profile false for default projection, true when any value differs', () => {
        expect(
            buildQuickStartFacts({
                state: { projectionSettings: DEFAULT_PROJECTION },
            }).profile,
        ).toBe(false);
        expect(
            buildQuickStartFacts({
                state: {
                    projectionSettings: {
                        ...DEFAULT_PROJECTION,
                        retireAge: 55,
                    },
                },
            }).profile,
        ).toBe(true);
        expect(
            buildQuickStartFacts({
                state: {
                    projectionSettings: {
                        ...DEFAULT_PROJECTION,
                        annualSavings: 30000,
                    },
                },
            }).profile,
        ).toBe(true);
        expect(
            buildQuickStartFacts({
                state: {
                    projectionSettings: {
                        ...DEFAULT_PROJECTION,
                        expectedReturn: 7.5,
                    },
                },
            }).profile,
        ).toBe(true);
        expect(
            buildQuickStartFacts({
                state: {
                    projectionSettings: {
                        ...DEFAULT_PROJECTION,
                        inflationRate: 3,
                    },
                },
            }).profile,
        ).toBe(true);
        expect(
            buildQuickStartFacts({
                state: {
                    projectionSettings: { ...DEFAULT_PROJECTION, swr: 3.5 },
                },
            }).profile,
        ).toBe(true);
        expect(
            buildQuickStartFacts({
                state: {
                    projectionSettings: {
                        ...DEFAULT_PROJECTION,
                        spanYears: 25,
                    },
                },
            }).profile,
        ).toBe(true);
        expect(
            buildQuickStartFacts({
                state: {
                    projectionSettings: {
                        ...DEFAULT_PROJECTION,
                        currentAge: 35,
                    },
                },
            }).profile,
        ).toBe(true);
        expect(
            buildQuickStartFacts({
                state: { projectionSettings: {} },
            }).profile,
        ).toBe(false);
        expect(buildQuickStartFacts({ state: {} }).profile).toBe(false);
        expect(buildQuickStartFacts({}).profile).toBe(false);
    });

    it('providers true only for connected === true', () => {
        expect(
            buildQuickStartFacts({ providerStatuses: [{ connected: true }] })
                .providers,
        ).toBe(true);
        expect(
            buildQuickStartFacts({ providerStatuses: [{ configured: true }] })
                .providers,
        ).toBe(false);
        expect(
            buildQuickStartFacts({ providerStatuses: [{ connected: false }] })
                .providers,
        ).toBe(false);
        expect(buildQuickStartFacts({ providerStatuses: [{}] }).providers).toBe(
            false,
        );
        expect(
            buildQuickStartFacts({ providerStatuses: [null] }).providers,
        ).toBe(false);
        expect(
            buildQuickStartFacts({ providerStatuses: [undefined] }).providers,
        ).toBe(false);
        expect(buildQuickStartFacts({ providerStatuses: [] }).providers).toBe(
            false,
        );
        expect(
            buildQuickStartFacts({ providerStatuses: 'not-array' }).providers,
        ).toBe(false);
        expect(buildQuickStartFacts({}).providers).toBe(false);
    });

    it('backup true only for authorized === true', () => {
        expect(
            buildQuickStartFacts({ driveStatus: { authorized: true } }).backup,
        ).toBe(true);
        expect(
            buildQuickStartFacts({ driveStatus: { authorized: false } }).backup,
        ).toBe(false);
        expect(
            buildQuickStartFacts({
                driveStatus: { clientConfigured: true, masterKeySet: true },
            }).backup,
        ).toBe(false);
        expect(buildQuickStartFacts({ driveStatus: {} }).backup).toBe(false);
        expect(buildQuickStartFacts({ driveStatus: null }).backup).toBe(false);
        expect(buildQuickStartFacts({}).backup).toBe(false);
    });

    it('explore true for seed positive integer, false otherwise', () => {
        expect(buildQuickStartFacts({ chaos: { seed: 12345 } }).explore).toBe(
            true,
        );
        expect(buildQuickStartFacts({ chaos: { seed: 1 } }).explore).toBe(true);
        expect(buildQuickStartFacts({ chaos: { seed: 0 } }).explore).toBe(
            false,
        );
        expect(buildQuickStartFacts({ chaos: { seed: -1 } }).explore).toBe(
            false,
        );
        expect(buildQuickStartFacts({ chaos: { seed: 1.5 } }).explore).toBe(
            false,
        );
        expect(buildQuickStartFacts({ chaos: { enabled: true } }).explore).toBe(
            false,
        );
        expect(
            buildQuickStartFacts({ chaos: { enabled: true, seed: 42 } })
                .explore,
        ).toBe(true);
        expect(buildQuickStartFacts({ chaos: {} }).explore).toBe(false);
        expect(buildQuickStartFacts({ chaos: null }).explore).toBe(false);
        expect(buildQuickStartFacts({}).explore).toBe(false);
    });

    it('returned keys match STEPS ids and feed quickStartProgress correctly', () => {
        const facts = buildQuickStartFacts({
            privacyAccepted: true,
            state: {
                customAccounts: [{ name: 'Test' }],
                projectionSettings: { ...DEFAULT_PROJECTION, retireAge: 55 },
            },
            providerStatuses: [{ connected: true }],
            driveStatus: { authorized: true },
            chaos: { seed: 12345 },
        });
        const stepIds = STEPS.map((s) => s.id);
        expect(Object.keys(facts).sort()).toEqual(stepIds.sort());
        const progress = quickStartProgress(facts);
        const trueCount = stepIds.filter((id) => facts[id] === true).length;
        expect(progress.doneCount).toBe(trueCount);
    });
});

describe('quick start facts: assets and confirmations', () => {
    const { buildQuickStartFacts: build } = createRequire(import.meta.url)(
        '../../app/lib/quick-start-facts.js',
    );

    it.each([
        'customAccounts',
        'importedPositions',
        'cds',
        'realEstate',
        'vehicles',
    ])('counts %s as an added asset', (key) => {
        expect(build({ state: { [key]: [{}] } }).accounts).toBe(true);
    });

    it('counts confirmed example figures as retirement assumptions', () => {
        expect(build({ state: { assumptionsConfirmed: true } }).profile).toBe(
            true,
        );
    });
});
