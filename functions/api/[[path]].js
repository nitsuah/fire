// Cloudflare Pages Function for every /api/* request. Static files in app/
// are served by Pages itself; this only runs for the API paths that
// netlify.toml rewrites to Netlify Functions.
import { dispatch } from '../../cloudflare/router.mjs';

export async function onRequest({ request, env, next }) {
    const response = await dispatch(request, env);
    return response || next();
}
