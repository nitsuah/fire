import js from '@eslint/js';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Apply recommended ESLint rules for JavaScript
  js.configs.recommended,

  // Configure Prettier as an ESLint plugin
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      // Add any additional JavaScript-specific rules or overrides here
      // For example:
      // 'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
      // 'indent': ['error', 2],
      // 'linebreak-style': ['error', 'unix'],
      // 'quotes': ['error', 'single'],
      // 'semi': ['error', 'always'],
    },
  },

  // Disable ESLint rules that conflict with Prettier
  // This must be the last configuration in the array to ensure it overrides all other configs
  prettierConfig,

  // Global ignore patterns
  {
    ignores: ['dist/', 'node_modules/', 'build/', '.next/', 'out/'],
  },
];