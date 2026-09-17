/* ==========================================================================
   fetch-utils.js — defensive JSON fetch helper
   Guards callers against the classic "Unexpected token '<' ... is not valid
   JSON" crash: a non-JSON response (an HTML 404/error page, a proxy error
   page, etc.) is turned into a structured {ok:false, status, data:{error}}
   result instead of letting res.json() throw a raw SyntaxError.
   ========================================================================== */

async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const text = await res.text().catch(() => '');
        return {
            ok: false,
            status: res.status,
            data: {
                error: `Server returned a non-JSON response (HTTP ${res.status}).${
                    text ? ` ${text.slice(0, 200)}` : ''
                }`,
            },
        };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}
