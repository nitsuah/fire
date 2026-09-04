import js from '@eslint/js';
import globals from 'globals';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
    js.configs.recommended,

    // Node.js files (server, routes, CommonJS lib modules, and ESM MCP server)
    {
        files: [
            'app/server.js',
            'app/mcp-server.mjs',
            'app/routes/**/*.js',
            'app/lib/db.js',
            'app/lib/server-utils.js',
            'app/lib/crypto-utils.js',
            'app/lib/webhook-integration.js',
            'app/lib/yahoo-prices.js',
            'app/lib/finance-core.js',
            'app/lib/finance-calcs.js',
            'app/lib/finance-parsing.js',
            'app/lib/finance-platforms.js',
            'app/lib/web3-prices.js',
            'app/lib/ebay-connector.js',
            'app/lib/gdrive-backup.js',
            'app/lib/prices-provider.js',
            'app/lib/vehicle-api.js',
            'app/lib/crypto-balance.js',
            'app/lib/ens-resolver.js',
            'app/lib/ens-wallet-lookup.js',
        ],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },

    // Browser-side lib scripts (classic multi-file, cross-script globals)
    {
        files: [
            // Legacy monolithic files (may still exist on older branches)
            'app/lib/charts.js',
            'app/lib/managers.js',
            'app/lib/state.js',
            'app/lib/prices.js',
            'app/lib/csv-import.js',
            'app/lib/expenses.js',
            'app/lib/side-gig.js',
            'app/lib/projections.js',
            'app/lib/tables-assets.js',
            'app/lib/tables-positions.js',
            // Shared browser utilities (loaded as <script> globals)
            'app/lib/html-utils.js',
            'app/lib/privacy.js',
            'app/lib/notifications.js',
            // Modular components (refactored structure)
            'app/lib/charts/**/*.js',
            'app/lib/managers/**/*.js',
            'app/lib/tables/**/*.js',
        ],
        languageOptions: {
            globals: {
                ...globals.browser,
                Chart: 'readonly',
            },
        },
        rules: {
            'no-undef': 'off',
            'no-unused-vars': 'off',
        },
    },

    // Test files and scripts (vitest globals are a superset of jest globals)
    {
        files: ['**/*.test.{js,mjs}', 'scripts/**/*.mjs'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
    },

    // Service worker (worker globals: self, caches, fetch, clients, etc.)
    {
        files: ['app/sw.js'],
        languageOptions: {
            globals: {
                ...globals.serviceworker,
            },
        },
    },

    // Browser-side application code
    {
        files: ['app/app.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                Chart: 'readonly',
            },
        },
    },

    // Prettier integration
    {
        plugins: {
            prettier: prettierPlugin,
        },
        rules: {
            'prettier/prettier': 'error',
        },
    },

    prettierConfig,

    {
        ignores: [
            'dist/',
            'node_modules/',
            'build/',
            '.next/',
            'out/',
            '.claude/',
            'app/app.js',
        ],
    },
];
