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

export function cookie(req, name) {
    for (const part of (req.headers.get('cookie') || '').split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return v.join('=');
    }
    return undefined;
}

export const OAUTH_ENV = [
    'EBAY_CLIENT_ID',
    'EBAY_CLIENT_SECRET',
    'EBAY_REDIRECT_URI',
    'SYNC_MASTER_KEY',
];
