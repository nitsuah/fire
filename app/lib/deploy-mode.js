/* ==========================================================================
   deploy-mode.js — the one place the app decides whether this deploy has a
   server behind it.

   `isBrowserOnlyMode()` used to answer that from `syncedRevision === null`,
   which is also true for a self-hosted tab whose /api/state has not
   resolved yet. So a slow hydration made a self-hosted deploy briefly look
   hosted, and every provider status card painted from localStorage — a
   connected eBay/Etsy/Drive integration rendered as "Disconnected" (#292).

   state.js reports the answer of its first /api/state probe here. Callers
   that paint a status card await `whenKnown()` first, which is bounded so a
   probe that never settles can still not leave a card blank forever.
   Loads as-is under Node (module.exports) and in the browser (global).
   ========================================================================== */
/* global module */

(function (root) {
    'use strict';

    // Upper bound on waiting for the probe. Past this callers fall back to
    // the old heuristic rather than never rendering the card at all.
    const WAIT_MS = 2000;

    // null = not known yet, true = hosted, false = has a server.
    let hosted = null;
    let settle;
    let probed = deferred();
    // Every pending wait timer, so a probe answer can clear them. A race that
    // the probe wins must not leave a timer armed to fire later.
    const timers = new Set();

    function deferred() {
        return new Promise((resolve) => {
            settle = resolve;
        });
    }

    // Called by state.js once its /api/state probe has a definitive answer.
    // A confirmed server is final — a later visibility re-sync must not flip
    // it. A hosted answer can come from a request that merely failed (see the
    // catch in state.js), so a later probe that does reach a server replaces
    // it. Re-reporting the same answer is a no-op.
    function resolve(hasServer) {
        const answer = !hasServer;
        if (hosted === false || hosted === answer) return hosted;
        hosted = answer;
        settle(hosted);
        for (const t of timers) root.clearTimeout(t);
        timers.clear();
        return hosted;
    }

    // Resolves to hosted-or-not, waiting for the probe at most timeoutMs.
    // Resolves to null when nothing has reported yet, so callers can fall back
    // instead of guessing.
    function whenKnown(timeoutMs = WAIT_MS) {
        if (hosted !== null) return Promise.resolve(hosted);
        return Promise.race([
            probed,
            new Promise((done) => {
                const t = root.setTimeout(() => {
                    timers.delete(t);
                    done(null);
                }, timeoutMs);
                timers.add(t);
            }),
        ]);
    }

    function isHosted() {
        return hosted === true;
    }

    function isUnknown() {
        return hosted === null;
    }

    // Synchronous read: true / false, or null when no probe has answered yet.
    function known() {
        return hosted;
    }

    // Test seam: forget the answer, any waiters, and their timers.
    function reset() {
        // Wake callers waiting on the previous probe before clearing its timeout.
        settle(null);
        for (const t of timers) root.clearTimeout(t);
        timers.clear();
        hosted = null;
        probed = deferred();
    }

    const api = {
        WAIT_MS,
        resolve,
        whenKnown,
        isHosted,
        isUnknown,
        known,
        reset,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FireDeployMode = api;
})(globalThis);
