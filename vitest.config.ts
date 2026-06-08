import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Enable global APIs like `describe`, `it`, `expect`
    globals: true,
    // Set the test environment to Node.js, suitable for backend/API server projects
    environment: 'node',
    // Configure coverage collection
    coverage: {
      // Use the 'v8' provider for fast and accurate coverage
      provider: 'v8',
      // Specify reporters for coverage output (e.g., console, JSON file, HTML report)
      reporter: ['text', 'json', 'html'],
      // Define coverage thresholds to enforce code quality standards
      thresholds: {
        statements: 80, // Minimum statement coverage
        branches: 80,   // Minimum branch coverage
        functions: 80,  // Minimum function coverage
        lines: 80,      // Minimum line coverage
      },
      // Exclude common directories and test files from coverage reports
      exclude: [
        'node_modules/', // Standard exclusion for installed packages
        'dist/',         // Standard exclusion for build output
        '**/*.test.js',  // Exclude test files themselves from coverage analysis
        '**/*.spec.js',  // Another common pattern for test files
      ],
    },
  },
});