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
            rate: 0.01,
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
            // Amounts are the extra *savings* kept after lifestyle creep and
            // taxes, not the raise itself.
            outcomes: [
                {
                    label: 'Lateral move, small raise',
                    annual: 2500,
                    years: null,
                    w: 3,
                },
                { label: 'Promotion', annual: 6000, years: null, w: 2 },
                { label: 'Big career jump', annual: 12000, years: null, w: 1 },
            ],
        },
        {
            id: 'bonus',
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
    ];

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

    function isEligible(def, age, retireAge, yr, history) {
        if (def.ageMin !== undefined && age < def.ageMin) return false;
        if (def.ageMax !== undefined && age > def.ageMax) return false;
        if (def.working && age >= retireAge) return false;
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
        };
    }

    /**
     * Build a deterministic life-event timeline.
     * @param {{seed:number,currentAge:number,retireAge:number,span:number}} opts
     * @returns {Array} events sorted by (yearIndex, month)
     */
    function generateEvents({
        seed,
        currentAge = 30,
        retireAge = 60,
        span = 30,
    }) {
        const rng = makeRng(seed);
        const history = {};
        const perYear = Array.from({ length: Math.max(span, 0) }, () => []);
        const record = (ev) => {
            perYear[ev.yearIndex].push(ev);
            (history[ev.defId] = history[ev.defId] || []).push(ev.yearIndex);
        };

        // Pass 1: each catalog event rolls against its life-average rate.
        for (let yr = 0; yr < span; yr++) {
            const age = currentAge + yr;
            // Shuffle-free but fair: start the scan at a random offset so the
            // per-year cap doesn't always favor the catalog's first entries.
            const start = Math.floor(rng() * CATALOG.length);
            for (let k = 0; k < CATALOG.length; k++) {
                const def = CATALOG[(start + k) % CATALOG.length];
                const roll = rng();
                if (perYear[yr].length >= MAX_EVENTS_PER_YEAR) continue;
                if (!isEligible(def, age, retireAge, yr, history)) continue;
                if (roll < def.rate) record(makeEvent(def, yr, age, rng));
            }
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
                const pool = CATALOG.filter((d) =>
                    isEligible(d, age, retireAge, yr, history),
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
     * withdrawals once retired) so with no events it reproduces it exactly.
     * Mutates nothing; returns per-event resolved dollar impacts.
     */
    function simulate({
        events,
        startNW,
        cashFraction = 0,
        realReturn,
        savings,
        annualExpenses,
        currentAge,
        retireAge,
        span,
    }) {
        const income = Math.max(0, savings) + Math.max(0, annualExpenses);
        const byYear = {};
        (events || []).forEach((ev) => {
            (byYear[ev.yearIndex] = byYear[ev.yearIndex] || []).push(ev);
        });
        const active = []; // { annual, untilYr }
        const impacts = {};

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
                let evLump = (o.gain || 0) - (o.cost || 0);
                if (o.incomeMonths && !retired)
                    evLump -= (income * o.incomeMonths) / 12;
                if (o.nwPct) evLump += Math.max(curNW, 0) * o.nwPct;
                let annualTotal = 0;
                if (o.annual) {
                    const yrs =
                        o.years === null || o.years === undefined
                            ? yearsToRetire
                            : o.years;
                    if (yrs > 0) {
                        active.push({ annual: o.annual, untilYr: yr + yrs });
                        annualTotal = o.annual * yrs;
                    }
                }
                lump += evLump;
                impacts[ev.id] = {
                    lump: Math.round(evLump),
                    annual: o.annual || 0,
                    years: o.annual ? (o.years ?? yearsToRetire) : 0,
                    total: Math.round(evLump + annualTotal),
                };
            });
            const flow = active
                .filter((a) => yr < a.untilYr)
                .reduce((s, a) => s + a.annual, 0);

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
        return { nwData, impacts, depletionAge };
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

    function describeImpact(ev, impact) {
        const parts = [];
        if (impact && impact.lump)
            parts.push(`${fmtMoney(impact.lump)} one-time`);
        if (impact && impact.annual && impact.years)
            parts.push(
                `${fmtMoney(impact.annual)}/yr for ${impact.years} yr${impact.years === 1 ? '' : 's'}`,
            );
        return parts.join(', ') || 'no net change';
    }

    function whenLabel(ev) {
        return `Age ${ev.age} · ${MONTHS[ev.month]}`;
    }

    const api = {
        CATEGORIES,
        CATALOG,
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
