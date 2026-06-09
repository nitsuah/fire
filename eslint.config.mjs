import js from '@eslint/js';
import globals from 'globals';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
    js.configs.recommended,

    // Node.js files (server + lib)
    {
        files: ['app/server.js', 'app/lib/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },

    // Test files (vitest globals are a superset of jest globals)
    {
        files: ['**/*.test.js'],
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
            'app/app.js',
        ],
    },
];
