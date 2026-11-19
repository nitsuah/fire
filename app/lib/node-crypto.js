'use strict';

// Node's crypto module, taken from the runtime when it can hand it over.
// The Cloudflare Pages build bundles the hosted functions with a Wrangler
// whose `crypto` polyfill lacks createCipheriv (AES-GCM sealing throws "not
// implemented"), even though the Workers runtime itself has it.
// process.getBuiltinModule (Node 20.16+/22.3+, Workers with nodejs_compat)
// returns the runtime's real module, so every caller gets the same native
// crypto on Node, Netlify and Cloudflare.
const fromRuntime =
    typeof process !== 'undefined' &&
    typeof process.getBuiltinModule === 'function'
        ? process.getBuiltinModule('node:crypto')
        : null;

module.exports = fromRuntime || require('crypto');
