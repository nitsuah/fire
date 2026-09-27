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
