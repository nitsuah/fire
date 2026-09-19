/* ==========================================================================
   managers/hustle-accelerators.js — Rotating, dismissible side-hustle ideas
   with guide/video links. Video links are YouTube searches (always valid,
   never a dead video id); guides point at stable reference pages.
   ========================================================================== */

const HUSTLE_DISMISS_KEY = 'fire_dismissed_hustles';

const yt = (q) =>
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

const HUSTLE_ACCELERATORS = [
    {
        id: 'arbitrage',
        icon: '🏷️',
        title: 'E-commerce Arbitrage',
        text: 'Find clearance items locally, scan barcodes, and flip on Amazon or eBay. Targets 35%+ ROI.',
        links: [
            {
                label: '▶ Video: retail arbitrage',
                url: yt('retail arbitrage for beginners'),
            },
            {
                label: '📖 Guide: arbitrage',
                url: 'https://www.investopedia.com/terms/a/arbitrage.asp',
            },
        ],
    },
    {
        id: 'cd-ladder',
        icon: '🪜',
        title: 'High-Yield CD Ladders',
        text: 'Auto-renew cash deposits in staggered 3, 6, and 12-month intervals for steady monthly distributions.',
        links: [
            {
                label: '▶ Video: CD ladders',
                url: yt('how to build a CD ladder'),
            },
            {
                label: '📖 Guide: CD ladder',
                url: 'https://www.investopedia.com/terms/c/cdladder.asp',
            },
        ],
    },
    {
        id: 'local-service',
        icon: '🧽',
        title: 'Local Service Agency',
        text: 'Offer mobile car detailing or gutter cleaning. Low setup overhead, high hourly yields ($50-$80/hr).',
        links: [
            {
                label: '▶ Video: start a detailing business',
                url: yt('start a mobile detailing business'),
            },
            {
                label: '📖 Guide: self-employed taxes',
                url: 'https://www.irs.gov/businesses/small-businesses-self-employed/self-employed-individuals-tax-center',
            },
        ],
    },
    {
        id: 'freelance',
        icon: '💻',
        title: 'Freelance Your Day-Job Skills',
        text: 'Package a skill you already have (writing, design, dev, bookkeeping) into a fixed-scope offer. Even 5 hrs/week at $60/hr is ~$15k/yr.',
        links: [
            {
                label: '▶ Video: land first freelance client',
                url: yt('how to get your first freelance client'),
            },
            {
                label: '📖 Guide: freelancing',
                url: 'https://www.investopedia.com/terms/f/freelancer.asp',
            },
        ],
    },
    {
        id: 'digital-products',
        icon: '🗂️',
        title: 'Digital Products & Templates',
        text: 'Build a spreadsheet, template, or mini-course once and sell it repeatedly — near-zero marginal cost.',
        links: [
            {
                label: '▶ Video: sell digital products',
                url: yt('how to sell digital products online'),
            },
            {
                label: '📖 Guide: passive income',
                url: 'https://www.investopedia.com/terms/p/passiveincome.asp',
            },
        ],
    },
    {
        id: 'tutoring',
        icon: '🎓',
        title: 'Tutoring & Online Teaching',
        text: 'Teach a subject you know well over video. Steady demand for test prep, languages, coding, and music.',
        links: [
            {
                label: '▶ Video: start online tutoring',
                url: yt('how to start online tutoring business'),
            },
            {
                label: '📖 Guide: gig economy',
                url: 'https://www.investopedia.com/terms/g/gig-economy.asp',
            },
        ],
    },
    {
        id: 'rentals',
        icon: '🎒',
        title: 'Rent Out Gear or a Spare Space',
        text: 'Cameras, tools, camping gear, a driveway or spare room — idle assets can earn while you sleep.',
        links: [
            {
                label: '▶ Video: rental income side hustle',
                url: yt('gear rental side hustle'),
            },
            {
                label: '📖 Guide: rental income',
                url: 'https://www.investopedia.com/terms/r/rentalproperty.asp',
            },
        ],
    },
];

const HUSTLE_MANTRAS = [
    'You cleared the whole list. Now go get after it. 🔥',
    'Ideas are cheap — execution is the whole game. Ship something this week.',
    'Small, consistent reps beat big, occasional plans. Start ugly, start today.',
    'The best time to start was last year. The second best is right now.',
    'Your future self is watching what you do today. Make them proud.',
];

let hustleIndex = 0;
let hustleMantraIndex = 0;
let hustlePaused = false;

function getDismissedHustles() {
    try {
        const parsed = JSON.parse(
            localStorage.getItem(HUSTLE_DISMISS_KEY) || '[]',
        );
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveDismissedHustles(list) {
    try {
        localStorage.setItem(HUSTLE_DISMISS_KEY, JSON.stringify(list));
    } catch {
        /* storage unavailable — dismissals just won't persist */
    }
}

function activeHustles() {
    const dismissed = getDismissedHustles();
    return HUSTLE_ACCELERATORS.filter((h) => !dismissed.includes(h.id));
}

function renderHustleAccelerator() {
    const el = document.getElementById('hustle-accelerator');
    if (!el) return;
    const active = activeHustles();
    const dismissedCount = HUSTLE_ACCELERATORS.length - active.length;
    const restore =
        dismissedCount > 0
            ? `<button type="button" class="divs-clear-dismissed" data-hustle-action="restore">Restore dismissed (${dismissedCount})</button>`
            : '';

    if (active.length === 0) {
        el.innerHTML = `<div class="hustle-item hustle-mantra">
                <p style="font-size:13px;">${HUSTLE_MANTRAS[hustleMantraIndex % HUSTLE_MANTRAS.length]}</p>
                <button type="button" class="action-btn mt-2" data-hustle-action="mantra">Another one</button>
            </div>${restore}`;
        return;
    }

    hustleIndex =
        ((hustleIndex % active.length) + active.length) % active.length;
    const h = active[hustleIndex];
    el.innerHTML = `<div class="hustle-item" data-hustle-id="${h.id}">
            <div class="hustle-item-head">
                <h4>${h.icon} ${h.title}</h4>
                <button type="button" class="divs-tile-dismiss" data-hustle-action="dismiss" aria-label="Dismiss ${h.title}">✕</button>
            </div>
            <p>${h.text}</p>
            <div class="divs-tile-links mt-2">${h.links
                .map(
                    (l) =>
                        `<a href="${l.url}" target="_blank" rel="noopener noreferrer" class="divs-tile-link">${l.label} ↗</a>`,
                )
                .join('')}</div>
            <div class="hustle-nav">
                <button type="button" class="action-btn" data-hustle-action="prev" aria-label="Previous idea">‹</button>
                <span class="text-muted" style="font-size:11px;">${hustleIndex + 1} / ${active.length}</span>
                <button type="button" class="action-btn" data-hustle-action="next" aria-label="Next idea">›</button>
            </div>
        </div>${restore}`;
}

function initHustleAccelerators() {
    const el = document.getElementById('hustle-accelerator');
    if (!el) return;
    el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-hustle-action]');
        if (!btn) return;
        const action = btn.dataset.hustleAction;
        if (action === 'next') hustleIndex++;
        else if (action === 'prev') hustleIndex--;
        else if (action === 'mantra') hustleMantraIndex++;
        else if (action === 'restore') saveDismissedHustles([]);
        else if (action === 'dismiss') {
            const id = btn.closest('[data-hustle-id]')?.dataset.hustleId;
            const dismissed = getDismissedHustles();
            if (id && !dismissed.includes(id)) dismissed.push(id);
            saveDismissedHustles(dismissed);
        }
        renderHustleAccelerator();
    });
    // Auto-rotate, but never while someone is reading/interacting with it.
    el.addEventListener('mouseenter', () => (hustlePaused = true));
    el.addEventListener('mouseleave', () => (hustlePaused = false));
    el.addEventListener('focusin', () => (hustlePaused = true));
    el.addEventListener('focusout', () => (hustlePaused = false));
    setInterval(() => {
        if (hustlePaused || document.hidden || !el.offsetParent) return;
        if (activeHustles().length > 1) {
            hustleIndex++;
            renderHustleAccelerator();
        }
    }, 12000);
    renderHustleAccelerator();
}
