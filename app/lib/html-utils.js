/* ==========================================================================
   html-utils.js — Shared browser-side HTML encoding utility
   ========================================================================== */

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/* --------------------------------------------------------------------------
   OAuth return binding. Each connect attempt gets its own random nonce, kept
   in sessionStorage and sent to the authorize route, which seals it into the
   pending cookie and echoes it back in the result fragment
   (#<prefix>-connected=<value>&n=<nonce>). A result is accepted only when
   the echoed nonce equals the one this tab stored for this attempt.
   -------------------------------------------------------------------------- */

function oauthNewNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Stores a fresh nonce under pendingKey and navigates to the authorize URL.
// Returns false (without navigating) if the nonce cannot be kept.
function oauthStartFlow(pendingKey, authorizeUrl) {
    const nonce = oauthNewNonce();
    try {
        sessionStorage.setItem(pendingKey, nonce);
    } catch {
        return false;
    }
    window.location.assign(`${authorizeUrl}?n=${nonce}`);
    return true;
}

// Consumes the result fragment for `prefix` (e.g. 'etsy'). Returns null when
// the hash is not an OAuth result for that prefix; otherwise clears the hash
// and the stored nonce and returns { ok, kind, value }. ok is true only when
// the echoed nonce matches the stored one.
function oauthTakeResult(prefix, pendingKey) {
    const match = (window.location.hash || '').match(
        new RegExp(`^#${prefix}-(connected|error)=([^&]*)&n=([0-9a-f]{32})$`),
    );
    const anyResult = new RegExp(`^#${prefix}-(connected|error)=`).test(
        window.location.hash || '',
    );
    if (!match && !anyResult) return null;
    history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
    );
    let expected;
    try {
        expected = sessionStorage.getItem(pendingKey);
        sessionStorage.removeItem(pendingKey);
    } catch {
        expected = null;
    }
    if (!match || !expected || expected.length !== match[3].length) {
        return { ok: false };
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
        diff |= expected.charCodeAt(i) ^ match[3].charCodeAt(i);
    }
    if (diff !== 0) return { ok: false };
    let value;
    try {
        value = decodeURIComponent(match[2]);
    } catch {
        return { ok: false };
    }
    return { ok: true, kind: match[1], value };
}
