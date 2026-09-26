'use strict';

// Helpers shared by the Netlify Functions in ../functions (v1 handler
// signature: event → {statusCode, headers, body}). Lives outside the
// functions directory so Netlify doesn't deploy it as a function itself.

function json(statusCode, body, headers = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...headers,
        },
        body: JSON.stringify(body),
    };
}

function redirect(location, headers = {}) {
    return {
        statusCode: 302,
        headers: {
            Location: location,
            'Cache-Control': 'no-store',
            ...headers,
        },
        body: '',
    };
}

function methodNotAllowed(allowed) {
    return json(405, { error: 'Method not allowed.' }, { Allow: allowed });
}

// Names of required env vars that are unset/empty. Callers log the list
// (names only, never values) and fail closed.
function missingEnv(names) {
    return names.filter((name) => !process.env[name]);
}

// Exact raw request bytes (needed for eBay signature verification).
function rawBody(event) {
    return Buffer.from(
        event.body || '',
        event.isBase64Encoded ? 'base64' : 'utf8',
    );
}

function header(event, name) {
    const headers = event.headers || {};
    const wanted = name.toLowerCase();
    const key = Object.keys(headers).find((k) => k.toLowerCase() === wanted);
    return key === undefined ? undefined : headers[key];
}

function cookie(event, name) {
    for (const part of (header(event, 'cookie') || '').split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return v.join('=');
    }
    return undefined;
}

module.exports = {
    json,
    redirect,
    methodNotAllowed,
    missingEnv,
    rawBody,
    header,
    cookie,
};
