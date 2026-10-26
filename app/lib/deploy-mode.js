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

    function deferred() {
        return new Promise((resolve) => {
            settle = resolve;
        });
    }

    // Called by state.js once its /api/state probe has a definitive answer.
    // First answer wins: a later visibility re-sync must not flip the mode.
    function resolve(hasServer) {
        if (hosted !== null) return hosted;
        hosted = !hasServer;
        settle(hosted);
        return hosted;
    }

    // Resolves to hosted-or-not, waiting for the first probe at most
    // timeoutMs. Resolves to null when nothing has reported yet, so callers
    // can fall back instead of guessing.
    function whenKnown(timeoutMs = WAIT_MS) {
        if (hosted !== null) return Promise.resolve(hosted);
        return Promise.race([
            probed,
            new Promise((done) => root.setTimeout(() => done(null), timeoutMs)),
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

    // Test seam: forget the answer and any waiters.
    function reset() {
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
