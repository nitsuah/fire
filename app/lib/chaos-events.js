/* ==========================================================================
   chaos-events.js — "Chaos mode" life-event engine for the projection chart

   A fixed catalog of realistic life events (surgery, a pet's cancer, a new
   job, a windfall, a child…). Each event has a life-average annual
   probability, an age window, and a small set of predefined outcomes with
   sensible dollar impacts — randomness only picks *which* event happens
   *when* and *which* predefined outcome it gets, never a free-form amount.

   Everything is seeded, so the same seed always yields the same timeline:
   toggling chaos off/on or switching the 1Y/5Y/All window shows the same
   life, and "Reroll" just picks a new seed.

   UMD like aggregates.js: browser global `FireChaos`, CommonJS for tests.
   ========================================================================== */
/* global module */
(function (root) {
    'use strict';

    // Category metadata — drives marker colors and the timeline chips.
    const CATEGORIES = {
        health: { label: 'Health', color: '#f43f5e' },
        pets: { label: 'Pets', color: '#fb923c' },
        family: { label: 'Family', color: '#ec4899' },
        career: { label: 'Career', color: '#3b82f6' },
        housing: { label: 'Housing', color: '#a855f7' },
        auto: { label: 'Auto', color: '#eab308' },
        windfall: { label: 'Windfall', color: '#10b981' },
        legal: { label: 'Legal & Money', color: '#64748b' },
    };

    // Outcome fields (all real, today's dollars — the projection is real-terms):
    //   cost          one-time cost
    //   gain          one-time gain
    //   incomeMonths  months of income lost (income ≈ annual savings + annual
    //                 expenses); 0 once retired
    //   annual        recurring change to yearly cash flow (negative = cost)
    //   years         how long `annual` lasts; null = until retirement
    //   nwPct         one-time fraction of net worth (e.g. -0.2 for a divorce)
    //   w             relative weight when picking the outcome
    //
    // rate: life-average chance per year while inside [ageMin, ageMax].
    // max: lifetime cap. gap: minimum years between repeats.
    // working: only happens before the retirement age.
    // needsPaycheck: only while there is earned income to lose or grow
    //   (job loss, pay cut, bonus, RSUs); skipped for someone between jobs.
    // chain: follow-up events, e.g. a parent's care → funeral → inheritance.
    //   Each { id, chance, after: [minYears, maxYears] } is rolled when the
    //   event happens; rate 0 events only ever arrive through a chain.
    // flowGrowth: recurring costs that outpace inflation (see EXCESS_GROWTH).
    const CATALOG = [
        // ── Health ──────────────────────────────────────────────────────
        {
            id: 'gallbladder',
            icon: '🏥',
            label: 'Gallbladder surgery',
            category: 'health',
            rate: 0.008,
            ageMin: 30,
            max: 1,
            outcomes: [
                {
                    label: 'In-network, deductible already met',
                    cost: 2500,
                    w: 3,
                },
                { label: 'High-deductible plan', cost: 6000, w: 3 },
                {
                    label: 'Complications + extra hospital nights',
                    cost: 14000,
                    w: 1,
                },
            ],
        },
        {
            id: 'er-visit',
            icon: '🚑',
            label: 'ER visit / broken bone',
            category: 'health',
            rate: 0.04,
            max: 3,
            gap: 3,
            outcomes: [
                { label: 'Urgent care + X-ray', cost: 1200, w: 4 },
                { label: 'ER visit with a cast', cost: 3500, w: 3 },
                { label: 'Surgery to set the fracture', cost: 7500, w: 1 },
            ],
        },
        {
            id: 'dental',
            icon: '🦷',
            label: 'Dental emergency',
            category: 'health',
            rate: 0.05,
            max: 4,
            gap: 3,
            outcomes: [
                { label: 'Root canal + crown', cost: 1800, w: 4 },
                { label: 'Extraction + implant', cost: 4500, w: 2 },
                { label: 'Multiple implants', cost: 9000, w: 1 },
            ],
        },
        {
            id: 'major-illness',
            icon: '🎗️',
            label: 'Serious illness',
            category: 'health',
            rate: 0.006,
            ageMin: 35,
            max: 1,
            outcomes: [
                {
                    label: 'Treatment hits the out-of-pocket max',
                    cost: 9000,
                    w: 3,
                },
                {
                    label: 'OOP max + 3 months off work',
                    cost: 9000,
                    incomeMonths: 3,
                    w: 2,
                },
                {
                    label: 'OOP max + 6-month recovery',
                    cost: 9000,
                    incomeMonths: 6,
                    w: 1,
                },
            ],
        },
        {
            id: 'joint-replacement',
            icon: '🦿',
            label: 'Knee / hip replacement',
            category: 'health',
            rate: 0.012,
            ageMin: 55,
            max: 1,
            outcomes: [
                { label: 'Covered, deductible + PT copays', cost: 3500, w: 3 },
                { label: 'Out-of-network surgeon', cost: 7000, w: 2 },
            ],
        },
        // ── Pets ────────────────────────────────────────────────────────
        {
            id: 'cat-cancer',
            icon: '🐈',
            label: 'Cat cancer diagnosis',
            category: 'pets',
            rate: 0.012,
            max: 2,
            gap: 8,
            outcomes: [
                { label: 'Palliative care', cost: 1500, w: 3 },
                { label: 'Tumor removal surgery', cost: 5000, w: 2 },
                { label: 'Surgery + chemotherapy', cost: 10000, w: 1 },
            ],
        },
        {
            id: 'dog-surgery',
            icon: '🐕',
            label: 'Dog emergency surgery',
            category: 'pets',
            rate: 0.02,
            max: 3,
            gap: 4,
            outcomes: [
                { label: 'Swallowed a sock', cost: 3500, w: 3 },
                { label: 'Torn ACL repair', cost: 5500, w: 2 },
                { label: 'Spinal surgery', cost: 9000, w: 1 },
            ],
        },
        // ── Family ──────────────────────────────────────────────────────
        {
            id: 'wedding',
            chain: [{ id: 'child', chance: 0.45, after: [1, 4] }],
            icon: '💍',
            label: 'Wedding',
            category: 'family',
            rate: 0.03,
            ageMin: 24,
            ageMax: 40,
            max: 1,
            outcomes: [
                { label: 'Courthouse + party', cost: 5000, w: 2 },
                { label: 'Typical wedding', cost: 30000, w: 3 },
                { label: 'Big destination wedding', cost: 60000, w: 1 },
            ],
        },
        {
            id: 'child',
            flowGrowth: 'kids',
            chain: [{ id: 'childcare-ends', chance: 0.6, after: [4, 6] }],
            icon: '👶',
            label: 'Child birth',
            category: 'family',
            rate: 0.045,
            ageMin: 24,
            ageMax: 42,
            max: 3,
            gap: 2,
            outcomes: [
                {
                    label: 'Frugal parenting',
                    cost: 2500,
                    annual: -8000,
                    years: 18,
                    w: 2,
                },
                {
                    label: 'Typical costs (USDA average)',
                    cost: 3000,
                    annual: -12000,
                    years: 18,
                    w: 3,
                },
                {
                    label: 'Full-time daycare years',
                    cost: 4000,
                    annual: -16000,
                    years: 18,
                    w: 1,
                },
            ],
        },
        {
            id: 'divorce',
            icon: '💔',
            label: 'Divorce',
            category: 'family',
            rate: 0.006,
            ageMin: 28,
            ageMax: 65,
            max: 1,
            outcomes: [
                { label: 'Amicable split', cost: 8000, nwPct: -0.2, w: 2 },
                { label: 'Contested divorce', cost: 35000, nwPct: -0.35, w: 1 },
            ],
        },
        {
            id: 'parent-care',
            flowGrowth: 'care',
            chain: [{ id: 'funeral', chance: 0.6, after: [2, 6] }],
            icon: '🧓',
            label: 'Aging parent needs care',
            category: 'family',
            rate: 0.02,
            ageMin: 40,
            ageMax: 70,
            max: 1,
            outcomes: [
                {
                    label: 'Help with assisted living',
                    annual: -9000,
                    years: 4,
                    w: 3,
                },
                {
                    label: 'Parent moves in with you',
                    annual: -5000,
                    years: 6,
                    w: 2,
                },
                {
                    label: 'Full-time memory care help',
                    annual: -20000,
                    years: 3,
                    w: 1,
                },
            ],
        },
        {
            id: 'family-loan',
            icon: '🤝',
            label: 'Family loan never repaid',
            category: 'family',
            rate: 0.02,
            max: 2,
            gap: 5,
            outcomes: [
                { label: 'Covered a few months of rent', cost: 2500, w: 3 },
                { label: 'Bailed out a car loan', cost: 8000, w: 2 },
                { label: 'Paid off a sibling’s debt', cost: 15000, w: 1 },
            ],
        },
        {
            id: 'funeral',
            chain: [
                { id: 'inherit-house', chance: 0.25, after: [0, 1] },
                { id: 'inheritance', chance: 0.35, after: [0, 1] },
            ],
            icon: '⚱️',
            label: 'Family funeral costs',
            category: 'family',
            rate: 0.012,
            ageMin: 30,
            max: 2,
            gap: 5,
            outcomes: [
                { label: 'Cremation + memorial', cost: 6000, w: 3 },
                { label: 'Traditional burial', cost: 12000, w: 2 },
            ],
        },
        {
            id: 'inheritance',
            icon: '🕊️',
            label: 'Inheritance',
            category: 'family',
            positive: true,
            rate: 0.003,
            ageMin: 40,
            ageMax: 75,
            max: 1,
            outcomes: [
                { label: 'Modest estate share', gain: 15000, w: 3 },
                { label: 'Paid-off house sold', gain: 60000, w: 2 },
                { label: 'Large estate', gain: 200000, w: 1 },
            ],
        },
        // ── Career (pre-retirement only) ────────────────────────────────
        {
            id: 'job-loss',
            chain: [{ id: 'new-job', chance: 0.6, after: [0, 1] }],
            needsPaycheck: true,
            icon: '📉',
            label: 'Job loss',
            category: 'career',
            rate: 0.03,
            working: true,
            max: 3,
            gap: 4,
            outcomes: [
                { label: 'Rehired in ~2 months', incomeMonths: 2, w: 3 },
                { label: '6-month job search', incomeMonths: 6, w: 2 },
                {
                    label: 'Year-long search (after benefits)',
                    incomeMonths: 10,
                    w: 1,
                },
            ],
        },
        {
            id: 'new-job',
            icon: '🚀',
            label: 'New job / promotion',
            category: 'career',
            positive: true,
            rate: 0.045,
            working: true,
            max: 3,
            gap: 4,
            // Wages barely beat inflation, so a raise is a few good years,
            // not a permanent step up. Amounts are the extra *savings* kept
            // after lifestyle creep and taxes, not the raise itself.
            outcomes: [
                {
                    label: 'Lateral move with a signing bonus',
                    gain: 4000,
                    w: 3,
                },
                {
                    label: 'Promotion (raises stall after a few years)',
                    annual: 6000,
                    years: 5,
                    w: 2,
                },
                {
                    label: 'Big career jump + signing bonus',
                    gain: 5000,
                    annual: 10000,
                    years: 6,
                    w: 1,
                },
            ],
        },
        {
            id: 'bonus',
            needsPaycheck: true,
            icon: '🎁',
            label: 'Unexpected bonus',
            category: 'career',
            positive: true,
            rate: 0.07,
            working: true,
            max: 10,
            gap: 2,
            outcomes: [
                { label: 'Spot bonus', gain: 3000, w: 4 },
                { label: 'Strong year-end bonus', gain: 8000, w: 2 },
                { label: 'Record-year payout', gain: 20000, w: 1 },
            ],
        },
        {
            id: 'side-hustle',
            icon: '💡',
            label: 'Side hustle takes off',
            category: 'career',
            positive: true,
            rate: 0.02,
            working: true,
            max: 2,
            gap: 5,
            outcomes: [
                {
                    label: 'Steady weekend income',
                    annual: 6000,
                    years: 4,
                    w: 3,
                },
                { label: 'Breakout product', annual: 15000, years: 5, w: 1 },
            ],
        },
        {
            id: 'pay-cut',
            needsPaycheck: true,
            icon: '✂️',
            label: 'Pay cut / reduced hours',
            category: 'career',
            rate: 0.02,
            working: true,
            max: 2,
            gap: 5,
            outcomes: [
                {
                    label: 'Company-wide pay cut',
                    annual: -6000,
                    years: 2,
                    w: 3,
                },
                { label: 'Forced part-time', annual: -12000, years: 3, w: 1 },
            ],
        },
        {
            id: 'rsu',
            needsPaycheck: true,
            icon: '📈',
            label: 'Equity / RSUs pay off',
            category: 'career',
            positive: true,
            rate: 0.015,
            working: true,
            max: 2,
            gap: 4,
            outcomes: [
                { label: 'Small grant vests', gain: 15000, w: 3 },
                { label: 'Stock ran up', gain: 40000, w: 2 },
                { label: 'Startup acquisition', gain: 90000, w: 1 },
            ],
        },
        // ── Housing ─────────────────────────────────────────────────────
        {
            id: 'roof-hvac',
            icon: '🏠',
            label: 'Roof / HVAC replacement',
            category: 'housing',
            rate: 0.035,
            max: 3,
            gap: 8,
            outcomes: [
                { label: 'New HVAC system', cost: 9000, w: 3 },
                { label: 'New roof', cost: 15000, w: 2 },
                { label: 'Roof and HVAC together', cost: 24000, w: 1 },
            ],
        },
        {
            id: 'water-damage',
            icon: '💧',
            label: 'Water damage',
            category: 'housing',
            rate: 0.01,
            max: 2,
            gap: 6,
            outcomes: [
                { label: 'Burst pipe, insurance deductible', cost: 2500, w: 3 },
                { label: 'Partial coverage', cost: 12000, w: 2 },
                { label: 'Uninsured flood', cost: 35000, w: 1 },
            ],
        },
        {
            id: 'rent-hike',
            flowGrowth: 'rent',
            icon: '🏢',
            label: 'Rent hike / forced move',
            category: 'housing',
            rate: 0.04,
            max: 3,
            gap: 4,
            outcomes: [
                { label: 'Moving costs', cost: 4000, w: 3 },
                { label: 'Rent +$250/mo', annual: -3000, years: 5, w: 2 },
                {
                    label: 'Forced into a pricier area',
                    cost: 4000,
                    annual: -6000,
                    years: 5,
                    w: 1,
                },
            ],
        },
        // ── Auto ────────────────────────────────────────────────────────
        {
            id: 'car-accident',
            flowGrowth: 'insurance',
            icon: '🚗',
            label: 'Car accident',
            category: 'auto',
            rate: 0.03,
            max: 3,
            gap: 4,
            outcomes: [
                { label: 'Collision deductible', cost: 1000, w: 4 },
                {
                    label: 'At fault + premium hike',
                    cost: 2000,
                    annual: -1200,
                    years: 3,
                    w: 2,
                },
                {
                    label: 'Total loss, underwater on the loan',
                    cost: 12000,
                    w: 1,
                },
            ],
        },
        {
            id: 'car-repair',
            icon: '🔧',
            label: 'Major car repair',
            category: 'auto',
            rate: 0.05,
            max: 4,
            gap: 3,
            outcomes: [
                { label: 'Brakes + suspension', cost: 2500, w: 3 },
                { label: 'Transmission rebuild', cost: 4500, w: 2 },
                { label: 'Engine replacement', cost: 7000, w: 1 },
            ],
        },
        {
            id: 'new-car',
            icon: '🚙',
            label: 'Car needs replacing',
            category: 'auto',
            rate: 0.06,
            max: 4,
            gap: 6,
            outcomes: [
                { label: 'Reliable used car', cost: 8000, w: 3 },
                { label: 'New economy car', cost: 18000, w: 2 },
                { label: 'New SUV / truck', cost: 30000, w: 1 },
            ],
        },
        // ── Windfalls ───────────────────────────────────────────────────
        {
            id: 'windfall',
            icon: '🍀',
            label: 'Unexpected windfall',
            category: 'windfall',
            positive: true,
            rate: 0.03,
            max: 3,
            gap: 4,
            outcomes: [
                { label: 'Surprise tax refund', gain: 2000, w: 4 },
                { label: 'Sold a collection', gain: 8000, w: 2 },
                { label: 'Lottery / crypto moonshot', gain: 40000, w: 1 },
            ],
        },
        // ── Legal & money ───────────────────────────────────────────────
        {
            id: 'identity-theft',
            icon: '🕵️',
            label: 'Identity theft / scam',
            category: 'legal',
            rate: 0.012,
            max: 2,
            gap: 5,
            outcomes: [
                { label: 'Mostly recovered by the bank', cost: 500, w: 3 },
                { label: 'Partial loss', cost: 3000, w: 2 },
                { label: 'Wire scam, unrecoverable', cost: 9000, w: 1 },
            ],
        },
        {
            id: 'tax-bill',
            icon: '🧾',
            label: 'Surprise tax bill',
            category: 'legal',
            rate: 0.015,
            max: 2,
            gap: 4,
            outcomes: [
                { label: 'IRS underpayment notice', cost: 2500, w: 3 },
                { label: 'Audit + penalties', cost: 9000, w: 1 },
            ],
        },
        {
            id: 'lawsuit',
            icon: '⚖️',
            label: 'Lawsuit',
            category: 'legal',
            rate: 0.004,
            max: 1,
            outcomes: [
                { label: 'Settled out of court', cost: 8000, w: 2 },
                {
                    label: 'Judgment beyond insurance limits',
                    cost: 30000,
                    w: 1,
                },
            ],
        },
        // ── More good news (and the follow-ups) ─────────────────────────
        {
            id: 'inherit-house',
            icon: '🏡',
            label: 'Inherited a house',
            category: 'family',
            positive: true,
            rate: 0.002,
            ageMin: 28,
            max: 1,
            outcomes: [
                { label: 'Sold the paid-off house', gain: 220000, w: 2 },
                {
                    label: 'Moved in: no more rent (upkeep + taxes still due)',
                    cost: 6000,
                    annual: 15000,
                    years: 99,
                    w: 2,
                },
                {
                    label: 'Kept it as a rental',
                    cost: 9000,
                    annual: 11000,
                    years: 99,
                    w: 1,
                },
            ],
        },
        {
            id: 'childcare-ends',
            icon: '🎒',
            label: 'Kid starts school, daycare ends',
            category: 'family',
            positive: true,
            rate: 0,
            max: 3,
            outcomes: [
                {
                    label: 'Part-time care until middle school',
                    annual: 4000,
                    years: 12,
                    w: 2,
                },
                { label: 'Daycare bill gone', annual: 7000, years: 12, w: 1 },
            ],
        },
        {
            id: 'refinance',
            icon: '🏦',
            label: 'Refinanced at a lower rate',
            category: 'housing',
            positive: true,
            rate: 0.015,
            ageMin: 25,
            max: 2,
            gap: 6,
            outcomes: [
                {
                    label: 'Rate dropped ~1%',
                    cost: 3000,
                    annual: 2400,
                    years: 15,
                    w: 3,
                },
                {
                    label: 'Rate dropped ~2%',
                    cost: 4000,
                    annual: 4800,
                    years: 15,
                    w: 1,
                },
            ],
        },
        {
            id: 'car-paid-off',
            icon: '🔑',
            label: 'Car loan paid off',
            category: 'auto',
            positive: true,
            rate: 0.04,
            max: 3,
            gap: 5,
            outcomes: [
                {
                    label: 'Kept driving it, payment gone',
                    annual: 4200,
                    years: 4,
                    w: 3,
                },
                {
                    label: 'Paid-off car lasted for years',
                    annual: 5400,
                    years: 6,
                    w: 1,
                },
            ],
        },
        {
            id: 'roommate',
            icon: '🛋️',
            label: 'Took in a roommate',
            category: 'housing',
            positive: true,
            rate: 0.015,
            ageMin: 21,
            ageMax: 45,
            max: 2,
            gap: 4,
            outcomes: [
                { label: 'Spare room rented', annual: 7200, years: 3, w: 3 },
                {
                    label: 'House hack: rented the basement unit',
                    annual: 12000,
                    years: 4,
                    w: 1,
                },
            ],
        },
        {
            id: 'settlement',
            icon: '📬',
            label: 'Settlement or claim payout',
            category: 'windfall',
            positive: true,
            rate: 0.02,
            max: 3,
            gap: 3,
            outcomes: [
                { label: 'Class-action check', gain: 400, w: 4 },
                { label: 'Unclaimed property found', gain: 1500, w: 2 },
                {
                    label: 'Insurance claim paid out above the deductible',
                    gain: 6000,
                    w: 1,
                },
            ],
        },
        {
            id: 'family-gift',
            icon: '🎀',
            label: 'Gift from family',
            category: 'family',
            positive: true,
            rate: 0.012,
            ageMax: 50,
            max: 2,
            gap: 5,
            outcomes: [
                { label: 'Help with a big expense', gain: 5000, w: 3 },
                { label: 'Down-payment help', gain: 20000, w: 1 },
            ],
        },
    ];

    // Real (above-inflation) growth. The projection is in today's dollars,
    // so a cost that rises with inflation is already flat on the chart;
    // these are the costs that have historically outrun it.
    const EXCESS_GROWTH = {
        rent: 0.01, // rent hikes: ~1%/yr over CPI
        kids: 0.01, // raising a child (education, care, health): ~1%/yr over CPI
        care: 0.03, // elder / home care: ~3%/yr over CPI
        insurance: 0.02, // premium hikes after a claim
        medical: 0.02, // medical bills: ~2%/yr over CPI
        vet: 0.02, // vet bills
    };
    // One-time costs that cost more (in real terms) the later they happen.
    const COST_GROWTH_BY_CATEGORY = { health: 'medical', pets: 'vet' };

    // 🛡️ Mitigations: coverage people can buy or set up ahead of time.
    // reduction = share of the covered cost removed (0 = pays it from
    // savings without debt, no net-worth change); part = which part of the
    // hit it shrinks; premium = real yearly cost, charged every year when on.
    const MITIGATIONS = [
        {
            id: 'pet-insurance',
            icon: '🐾',
            label: 'Pet insurance',
            covers: ['cat-cancer', 'dog-surgery'],
            reduction: 0.8,
            part: 'cost',
            premium: 600,
            tip: 'Accident-and-illness plans usually reimburse 70–90% of vet bills after the deductible. Enroll while pets are young: pre-existing conditions are excluded.',
        },
        {
            id: 'health-oop',
            icon: '🩺',
            label: 'Low out-of-pocket health plan or a funded HSA',
            covers: [
                'gallbladder',
                'er-visit',
                'major-illness',
                'joint-replacement',
            ],
            reduction: 0.5,
            part: 'cost',
            premium: 1200,
            tip: 'A lower out-of-pocket maximum caps the big bills; an HSA pays them with pre-tax money. Check the in-network OOP max, not just the premium.',
        },
        {
            id: 'disability',
            icon: '🛟',
            label: 'Long-term disability insurance',
            covers: ['major-illness'],
            reduction: 0.6,
            part: 'income',
            premium: 900,
            tip: 'Replaces ~60% of pay if illness keeps you out of work for months. Often cheap or free through an employer.',
        },
        {
            id: 'dental',
            icon: '🦷',
            label: 'Dental insurance or a discount plan',
            covers: ['dental'],
            reduction: 0.5,
            part: 'cost',
            premium: 420,
            tip: 'Most plans pay ~50% of major work like crowns and implants, after a waiting period and up to an annual maximum.',
        },
        {
            id: 'umbrella',
            icon: '☂️',
            label: 'Umbrella liability policy',
            covers: ['lawsuit'],
            reduction: 0.9,
            part: 'cost',
            premium: 300,
            tip: '$1M of extra liability coverage typically costs a few hundred dollars a year, and matters more as net worth grows.',
        },
        {
            id: 'water-rider',
            icon: '💧',
            label: 'Water-backup / flood coverage',
            covers: ['water-damage'],
            reduction: 0.7,
            part: 'cost',
            premium: 180,
            tip: 'Standard home and renters policies exclude sewer backup and floods. A rider or NFIP policy closes the gap.',
        },
        {
            id: 'gap-insurance',
            icon: '🚗',
            label: 'Gap insurance + good liability limits',
            covers: ['car-accident'],
            reduction: 0.5,
            part: 'cost',
            premium: 120,
            tip: 'Gap pays the loan balance when a financed car is totaled for less than you owe.',
        },
        {
            id: 'credit-freeze',
            icon: '🔒',
            label: 'Credit freeze + account alerts',
            covers: ['identity-theft'],
            reduction: 0.8,
            part: 'cost',
            premium: 0,
            tip: 'Free at all three bureaus. Add transaction alerts and never wire money on a phone or email request.',
        },
        {
            id: 'safe-harbor',
            icon: '🧾',
            label: 'Safe-harbor tax withholding',
            covers: ['tax-bill'],
            reduction: 0.8,
            part: 'cost',
            premium: 0,
            tip: 'Withholding or paying estimates of at least 100% of last year’s tax (110% at higher incomes) avoids underpayment penalties.',
        },
        {
            id: 'emergency-fund',
            icon: '⛑️',
            label: '6-month emergency fund',
            covers: [
                'job-loss',
                'pay-cut',
                'car-repair',
                'new-car',
                'roof-hvac',
            ],
            reduction: 0,
            part: 'cost',
            premium: 0,
            tip: 'Doesn’t make the bill smaller, but you pay it from cash instead of credit cards or selling investments in a downturn.',
        },
    ];

    const BY_ID = Object.fromEntries(CATALOG.map((d) => [d.id, d]));

    const MAX_EVENTS_PER_YEAR = 2;
    // Floor so short windows always show something: ≥1 event in the first
    // year and ≥3 in every 5-year block.
    const MIN_FIRST_YEAR = 1;
    const MIN_PER_BLOCK = 3;
    const BLOCK_YEARS = 5;

    const MONTHS = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
    ];

    // mulberry32 — tiny, fast, good-enough seeded PRNG.
    function makeRng(seed) {
        let a = seed >>> 0 || 1;
        return function () {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function newSeed() {
        return Math.floor(Math.random() * 0xffffffff) >>> 0 || 1;
    }

    function pickWeighted(items, rng, weightOf) {
        const total = items.reduce((s, it) => s + weightOf(it), 0);
        let r = rng() * total;
        for (const it of items) {
            r -= weightOf(it);
            if (r < 0) return it;
        }
        return items[items.length - 1];
    }

    function isEligible(def, age, retireAge, yr, history, earning) {
        if (def.ageMin !== undefined && age < def.ageMin) return false;
        if (def.ageMax !== undefined && age > def.ageMax) return false;
        if (def.working && age >= retireAge) return false;
        if (def.needsPaycheck && !earning) return false;
        const past = history[def.id] || [];
        if (past.length >= (def.max || Infinity)) return false;
        if (past.length && yr - past[past.length - 1] < (def.gap || 1))
            return false;
        return true;
    }

    function makeEvent(def, yr, age, rng) {
        const outcome = pickWeighted(def.outcomes, rng, (o) => o.w || 1);
        return {
            id: `${def.id}@${yr}`,
            defId: def.id,
            icon: def.icon,
            label: def.label,
            category: def.category,
            positive: !!def.positive,
            yearIndex: yr,
            month: Math.floor(rng() * 12),
            age,
            outcome: { ...outcome },
            term: outcome.annual ? 'long' : 'short',
            flowGrowth: def.flowGrowth || null,
            costGrowth: COST_GROWTH_BY_CATEGORY[def.category] || null,
        };
    }

    /**
     * Build a deterministic life-event timeline.
     * @param {{seed:number,currentAge:number,retireAge:number,span:number,
     *   hasEarnedIncome?:boolean}} opts  hasEarnedIncome=false drops the
     *   paycheck-dependent events (job loss, pay cut, bonus, RSUs).
     * @returns {Array} events sorted by (yearIndex, month)
     */
    function generateEvents({
        seed,
        currentAge = 30,
        retireAge = 60,
        span = 30,
        hasEarnedIncome = true,
    }) {
        const rng = makeRng(seed);
        const history = {};
        const perYear = Array.from({ length: Math.max(span, 0) }, () => []);
        const pending = {}; // yearIndex -> [{ defId, cause }]
        const record = (ev) => {
            perYear[ev.yearIndex].push(ev);
            (history[ev.defId] = history[ev.defId] || []).push(ev.yearIndex);
            (BY_ID[ev.defId].chain || []).forEach((c) => {
                if (rng() >= c.chance) return;
                const [lo, hi] = c.after;
                const y = ev.yearIndex + lo + Math.floor(rng() * (hi - lo + 1));
                if (y < span)
                    (pending[y] = pending[y] || []).push({
                        defId: c.id,
                        cause: ev,
                    });
            });
        };

        // Follow-ups are consequences, not coin flips. Drain a year's queue
        // until it's empty, so follow-ups queued while draining (same-year
        // chains) are handled too; a full year pushes them to the next one.
        const runPending = (yr) => {
            const queue = pending[yr];
            if (!queue) return;
            const age = currentAge + yr;
            while (queue.length) {
                const { defId, cause } = queue.shift();
                const def = BY_ID[defId];
                if (perYear[yr].length >= MAX_EVENTS_PER_YEAR) {
                    if (yr + 1 < span)
                        (pending[yr + 1] = pending[yr + 1] || []).push({
                            defId,
                            cause,
                        });
                    continue;
                }
                if (
                    !isEligible(
                        def,
                        age,
                        retireAge,
                        yr,
                        history,
                        hasEarnedIncome,
                    )
                )
                    continue;
                const ev = makeEvent(def, yr, age, rng);
                if (cause.yearIndex === yr)
                    ev.month = Math.min(
                        11,
                        Math.max(ev.month, cause.month + 1),
                    );
                ev.cause = `${cause.icon} ${cause.label}, age ${cause.age}`;
                record(ev);
            }
        };
        const drainFrom = (yr) => {
            for (let y = yr; y < span; y++) runPending(y);
        };

        // Pass 1: each catalog event rolls against its life-average rate.
        for (let yr = 0; yr < span; yr++) {
            const age = currentAge + yr;
            runPending(yr);
            // Shuffle-free but fair: start the scan at a random offset so the
            // per-year cap doesn't always favor the catalog's first entries.
            const start = Math.floor(rng() * CATALOG.length);
            for (let k = 0; k < CATALOG.length; k++) {
                const def = CATALOG[(start + k) % CATALOG.length];
                const roll = rng();
                if (perYear[yr].length >= MAX_EVENTS_PER_YEAR) continue;
                if (
                    !isEligible(
                        def,
                        age,
                        retireAge,
                        yr,
                        history,
                        hasEarnedIncome,
                    )
                )
                    continue;
                if (roll < def.rate) record(makeEvent(def, yr, age, rng));
            }
            runPending(yr);
        }

        // Pass 2: top up sparse windows so 1Y/5Y views aren't empty.
        const topUp = (yrFrom, yrTo, need) => {
            let guard = 50;
            while (need > 0 && guard-- > 0) {
                const years = [];
                for (let y = yrFrom; y < yrTo; y++)
                    if (perYear[y].length < MAX_EVENTS_PER_YEAR) years.push(y);
                if (!years.length) return;
                const yr = years[Math.floor(rng() * years.length)];
                const age = currentAge + yr;
                const pool = CATALOG.filter(
                    (d) =>
                        d.rate > 0 &&
                        isEligible(
                            d,
                            age,
                            retireAge,
                            yr,
                            history,
                            hasEarnedIncome,
                        ),
                );
                if (!pool.length) continue;
                record(
                    makeEvent(
                        pickWeighted(pool, rng, (d) => d.rate),
                        yr,
                        age,
                        rng,
                    ),
                );
                need--;
                drainFrom(yr);
            }
        };
        if (span > 0) topUp(0, 1, MIN_FIRST_YEAR - perYear[0].length);
        for (let b = 0; b < span; b += BLOCK_YEARS) {
            const end = Math.min(b + BLOCK_YEARS, span);
            const have = perYear
                .slice(b, end)
                .reduce((s, l) => s + l.length, 0);
            const need =
                Math.ceil((MIN_PER_BLOCK * (end - b)) / BLOCK_YEARS) - have;
            topUp(b, end, need);
        }

        return perYear
            .flat()
            .sort((a, b) => a.yearIndex - b.yearIndex || a.month - b.month);
    }

    /**
     * Real-terms projection of one path with life events applied. Mirrors
     * the base loop in projections.js (accumulate, then cash-first
     * withdrawals once retired) so with no events and no mitigations it
     * reproduces it exactly. Mutates nothing; returns per-event impacts.
     *
     * Accounting (all in today's dollars, like the chart):
     *  - one-time amounts land in their year, then compound with the rest
     *    of the portfolio; medical/vet bills grow ~2%/yr above inflation
     *  - recurring amounts change yearly savings (or, once retired, the
     *    yearly withdrawal) for their duration; rent, child costs, care and
     *    insurance escalate above inflation (EXCESS_GROWTH)
     *  - active mitigations shrink the covered part of a hit and charge
     *    their premium every year
     */
    function simulate({
        events,
        startNW,
        cashFraction = 0,
        realReturn,
        savings,
        annualExpenses,
        spending = annualExpenses,
        currentAge,
        retireAge,
        span,
        inflation = 0,
        mitigations = [],
    }) {
        // A month without a paycheck costs that month's savings plus the
        // living costs now paid from the portfolio: actual spending, not the
        // tax-padded annualExpenses used for the FIRE number (no paycheck,
        // no income tax on it).
        const income = Math.max(0, savings) + Math.max(0, spending);
        const active = MITIGATIONS.filter((m) => mitigations.includes(m.id));
        const premium = active.reduce((sum, m) => sum + m.premium, 0);
        const byYear = {};
        (events || []).forEach((ev) => {
            (byYear[ev.yearIndex] = byYear[ev.yearIndex] || []).push(ev);
        });
        const flows = []; // { annual, startYr, untilYr, g }
        const impacts = {};
        let savedTotal = 0;

        let nw = startNW;
        let cash = null;
        let invested = null;
        let depletionAge = null;
        const nwData = [];

        for (let yr = 0; yr <= span; yr++) {
            const age = currentAge + yr;
            nwData.push(Math.round(cash !== null ? cash + invested : nw));
            if (yr >= span) break;
            const retired = age >= retireAge;
            const yearsToRetire = Math.max(retireAge - age, 0);

            // Resolve this year's events into a lump sum + new recurring flows.
            let lump = 0;
            (byYear[yr] || []).forEach((ev) => {
                const o = ev.outcome;
                const curNW = cash !== null ? cash + invested : nw;
                const costG = EXCESS_GROWTH[ev.costGrowth] || 0;
                let cost = (o.cost || 0) * Math.pow(1 + costG, yr);
                let lostIncome =
                    o.incomeMonths && !retired
                        ? (income * o.incomeMonths) / 12
                        : 0;
                // Mitigations: the best cover for each part of the hit.
                const covering = active.filter((m) =>
                    m.covers.includes(ev.defId),
                );
                const best = (part) =>
                    covering
                        .filter((m) => m.part === part)
                        .reduce((r, m) => Math.max(r, m.reduction), 0);
                const saved = cost * best('cost') + lostIncome * best('income');
                cost *= 1 - best('cost');
                lostIncome *= 1 - best('income');
                savedTotal += saved;

                let evLump = (o.gain || 0) - cost - lostIncome;
                if (o.nwPct) evLump += Math.max(curNW, 0) * o.nwPct;
                let annualTotal = 0;
                let yrs = 0;
                const g = o.annual ? EXCESS_GROWTH[ev.flowGrowth] || 0 : 0;
                if (o.annual) {
                    yrs = Math.min(
                        o.years === null || o.years === undefined
                            ? yearsToRetire
                            : o.years,
                        span - yr,
                    );
                    if (yrs > 0) {
                        flows.push({
                            annual: o.annual,
                            startYr: yr,
                            untilYr: yr + yrs,
                            g,
                        });
                        for (let k = 0; k < yrs; k++)
                            annualTotal += o.annual * Math.pow(1 + g, k);
                    }
                }
                lump += evLump;
                impacts[ev.id] = {
                    lump: Math.round(evLump),
                    annual: o.annual || 0,
                    years: yrs,
                    ongoing: (o.years || 0) >= 99,
                    growth: g,
                    inflation,
                    saved: Math.round(saved),
                    mitigatedBy: covering.map((m) => m.label),
                    total: Math.round(evLump + annualTotal),
                };
            });
            const flow =
                flows
                    .filter((f) => yr >= f.startYr && yr < f.untilYr)
                    .reduce(
                        (sum, f) =>
                            sum + f.annual * Math.pow(1 + f.g, yr - f.startYr),
                        0,
                    ) - premium;

            if (!retired) {
                nw = nw * (1 + realReturn) + savings + flow + lump;
            } else {
                if (cash === null) {
                    cash = nw * cashFraction;
                    invested = nw * (1 - cashFraction);
                }
                // Same cash-first rule as projections.js; a negative "expense"
                // (net windfall) simply lands in cash.
                const expense = annualExpenses - flow - lump;
                const totalBefore = cash + invested;
                const cashDrawn = Math.min(cash, expense);
                const rawInvested =
                    invested * (1 + realReturn) - (expense - cashDrawn);
                cash -= cashDrawn;
                invested = Math.max(0, rawInvested);
                if (
                    depletionAge === null &&
                    (totalBefore > 0 || expense > 0) &&
                    cash + rawInvested <= 0
                )
                    depletionAge = age + 1;
            }
        }
        return {
            nwData,
            impacts,
            depletionAge,
            savedTotal: Math.round(savedTotal),
            premiumTotal: Math.round(premium * span),
        };
    }

    // Events whose marker sits nearest to chart index `idx` — what the
    // index-mode tooltip shows when hovering/tapping that point.
    function eventsNearIndex(events, idx) {
        return (events || []).filter(
            (ev) => Math.round(ev.yearIndex + ev.month / 12) === idx,
        );
    }

    function eventsInWindow(events, points) {
        if (!points) return events || [];
        // Points are inclusive year marks 0..points-1, so events that start
        // before the last displayed point are inside the window.
        return (events || []).filter(
            (ev) => ev.yearIndex + ev.month / 12 <= points - 1,
        );
    }

    function fmtMoney(n) {
        const abs = Math.abs(Math.round(n));
        const s =
            abs >= 1e6
                ? `$${(abs / 1e6).toFixed(2)}M`
                : abs >= 1e3
                  ? `$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`
                  : `$${abs}`;
        return (n < 0 ? '−' : '+') + s;
    }

    const pct = (x) => `${(x * 100).toFixed((x * 100) % 1 ? 1 : 0)}%`;

    function describeImpact(ev, impact) {
        const parts = [];
        if (impact && impact.lump)
            parts.push(`${fmtMoney(impact.lump)} one-time`);
        if (impact && impact.annual && impact.years) {
            let flow = impact.ongoing
                ? `${fmtMoney(impact.annual)}/yr from then on`
                : `${fmtMoney(impact.annual)}/yr for ${impact.years} yr${impact.years === 1 ? '' : 's'}`;
            if (impact.growth)
                flow += impact.inflation
                    ? ` (rising ~${pct(impact.inflation + impact.growth)}/yr: inflation + ${pct(impact.growth)})`
                    : ` (rising ${pct(impact.growth)}/yr above inflation)`;
            parts.push(flow);
        }
        if (impact && impact.mitigatedBy && impact.mitigatedBy.length)
            parts.push(
                impact.saved
                    ? `🛡️ ${impact.mitigatedBy.join(' + ')} saved ${fmtMoney(impact.saved).slice(1)}`
                    : `🛡️ covered by ${impact.mitigatedBy.join(' + ')}`,
            );
        return parts.join(', ') || 'no net change';
    }

    function whenLabel(ev) {
        return `Age ${ev.age} · ${MONTHS[ev.month]}`;
    }

    const api = {
        CATEGORIES,
        CATALOG,
        MITIGATIONS,
        EXCESS_GROWTH,
        MAX_EVENTS_PER_YEAR,
        makeRng,
        newSeed,
        generateEvents,
        simulate,
        eventsNearIndex,
        eventsInWindow,
        describeImpact,
        whenLabel,
        fmtMoney,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FireChaos = api;
})(globalThis);
