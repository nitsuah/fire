// Helpers shared by the Netlify Functions in ../functions. They use the
// modern (v2) signature, Request → Response. The Lambda-compatible
// `exports.handler` format caps the site's env vars at 4KB, which this site
// exceeds. Lives outside the functions directory so Netlify doesn't deploy
// it as a function itself.

export function json(status, body, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...headers,
        },
    });
}

export function redirect(location, headers = {}) {
    return new Response(null, {
        status: 302,
        headers: {
            Location: location,
            'Cache-Control': 'no-store',
            ...headers,
        },
    });
}

export function methodNotAllowed(allowed) {
    return json(405, { error: 'Method not allowed.' }, { Allow: allowed });
}

// Names of required env vars that are unset/empty. Callers log the list
// (names only, never values) and fail closed.
export function missingEnv(names) {
    return names.filter((name) => !process.env[name]);
}

// Appends each Set-Cookie value (falsy ones skipped) to a Response.
export function withCookies(res, cookies = []) {
    for (const c of cookies) if (c) res.headers.append('Set-Cookie', c);
    return res;
}

export function cookie(req, name) {
    for (const part of (req.headers.get('cookie') || '').split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return v.join('=');
    }
    return undefined;
}

// Where the eBay grant cookie lives (app/lib/grant-cookie.js).
export const EBAY_GRANT = { name: 'ebay_grant', path: '/api/sync/ebay' };

export const OAUTH_ENV = [
    'EBAY_CLIENT_ID',
    'EBAY_CLIENT_SECRET',
    'EBAY_REDIRECT_URI',
    'SYNC_MASTER_KEY',
];
