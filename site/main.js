// Hero video controls, scenario toggle, and copy buttons.
(() => {
    const vid = document.getElementById('hero-vid');
    const play = document.getElementById('hero-play');
    const mute = document.getElementById('hero-mute');
    const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
    ).matches;

    const syncPlay = () => {
        const paused = vid.paused;
        play.dataset.state = paused ? 'paused' : 'playing';
        play.setAttribute('aria-label', paused ? 'Play video' : 'Pause video');
    };
    const syncMute = () => {
        mute.setAttribute('aria-pressed', String(!vid.muted));
        mute.setAttribute(
            'aria-label',
            vid.muted ? 'Unmute video' : 'Mute video',
        );
    };
    // play() rejects when the browser blocks playback; keep the controls
    // truthful instead of leaving an unhandled rejection.
    const tryPlay = () =>
        vid.play().catch(() => {
            vid.muted = true;
            syncMute();
            syncPlay();
        });

    vid.addEventListener('play', syncPlay);
    vid.addEventListener('pause', syncPlay);
    // No autoplay attribute: start only once we know motion is welcome.
    if (!reduceMotion) tryPlay();
    syncPlay();

    play.addEventListener('click', () =>
        vid.paused ? tryPlay() : vid.pause(),
    );
    mute.addEventListener('click', () => {
        vid.muted = !vid.muted;
        if (!vid.muted) vid.currentTime = 0;
        syncMute();
        if (!vid.muted) tryPlay();
    });

    // Chaos-mode demo: play only while on screen, and never under reduced
    // motion (the poster and the still below it carry the same content).
    const chaosVid = document.getElementById('chaos-vid');
    if (chaosVid && !reduceMotion && 'IntersectionObserver' in window) {
        new IntersectionObserver(
            (entries) =>
                entries.forEach((e) =>
                    e.isIntersecting
                        ? chaosVid.play().catch(() => {})
                        : chaosVid.pause(),
                ),
            { threshold: 0.4 },
        ).observe(chaosVid);
    }

    // Real chart captures for each scenario; preload so the swap is instant.
    const img = document.getElementById('scn-img');
    const labels = {
        bear: 'bear (−2%)',
        base: 'base-rate',
        bull: 'bull (+2%)',
    };
    Object.keys(labels).forEach((k) => {
        new Image().src = `assets/proj-${k}.webp`;
    });
    document.querySelectorAll('[data-scn]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const k = btn.dataset.scn;
            document
                .querySelectorAll('[data-scn]')
                .forEach((b) =>
                    b.setAttribute('aria-pressed', String(b === btn)),
                );
            img.src = `assets/proj-${k}.webp`;
            img.alt = `Retirement growth path chart, ${labels[k]} scenario`;
        });
    });

    // Lightbox: tap/click any screenshot (or the Chaos video) to see it
    // full size. Inside, tapping an image toggles fit-to-screen and actual
    // size; Esc, the ✕ button or the backdrop close it.
    const box = document.getElementById('lightbox');
    const media = document.getElementById('lightbox-media');
    const caption = document.getElementById('lightbox-caption');
    const open = (el) => {
        media.innerHTML = '';
        media.classList.remove('is-actual');
        let node;
        if (el.tagName === 'VIDEO') {
            node = document.createElement('video');
            node.src = el.currentSrc || el.src;
            node.poster = el.poster;
            Object.assign(node, {
                controls: true,
                loop: true,
                muted: true,
                playsInline: true,
            });
            if (!reduceMotion) node.autoplay = true;
            el.pause();
        } else {
            node = document.createElement('img');
            node.src = el.currentSrc || el.src;
            node.alt = el.alt;
            // Click, Enter or Space toggles fit-to-screen / actual size.
            node.tabIndex = 0;
            node.setAttribute('role', 'button');
            node.setAttribute('aria-label', `Toggle actual size: ${el.alt}`);
            const toggleSize = () => media.classList.toggle('is-actual');
            node.addEventListener('click', toggleSize);
            node.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSize();
                }
            });
        }
        media.appendChild(node);
        caption.textContent =
            el.getAttribute('alt') || el.getAttribute('aria-label') || '';
        box.showModal();
    };
    box.addEventListener('click', (e) => {
        if (e.target === box || e.target.closest('.lightbox-close'))
            box.close();
    });
    box.addEventListener('close', () => {
        media.innerHTML = '';
    });
    document
        .querySelectorAll(
            '.shot img, .tile-shot img, .chart-shot img, #chaos-vid',
        )
        .forEach((el) => {
            el.classList.add('zoomable');
            el.parentElement.classList.add('zoom-wrap');
            el.setAttribute('tabindex', '0');
            el.setAttribute('role', 'button');
            el.setAttribute(
                'aria-label',
                `Enlarge: ${el.getAttribute('alt') || el.getAttribute('aria-label') || 'image'}`,
            );
            el.addEventListener('click', () => open(el));
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open(el);
                }
            });
        });

    document.querySelectorAll('.copy').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(btn.dataset.copy);
                btn.textContent = 'Copied';
            } catch {
                // Clipboard blocked (permissions / insecure context): select
                // the commands so a manual copy grabs exactly the right text.
                const code = btn.parentElement.querySelector('code');
                const range = document.createRange();
                range.selectNodeContents(code);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                btn.textContent = 'Selected: press Ctrl+C';
            }
            setTimeout(() => (btn.textContent = 'Copy'), 2400);
        });
    });
})();
