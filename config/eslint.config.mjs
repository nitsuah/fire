import js from '@eslint/js';
import globals from 'globals';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
    js.configs.recommended,

    // Node.js files (server + CommonJS finance modules)
    {
        files: [
            'app/server.js',
            'app/lib/finance-core.js',
            'app/lib/finance-calcs.js',
            'app/lib/finance-parsing.js',
            'app/lib/finance-platforms.js',
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

    // Test files (vitest globals are a superset of jest globals)
    {
        files: ['**/*.test.{js,mjs}'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
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
