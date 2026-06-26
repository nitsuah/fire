import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'app/**/*.test.{js,ts}',
      'tests/**/*.test.{js,ts}',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'app/server.js',
        'app/lib/finance-calcs.js',
        'app/lib/finance-core.js',
        'app/lib/finance-parsing.js',
        'app/lib/finance-platforms.js',
      ],
      exclude: [
        'app/app.js',
        'node_modules/**',
        '**/*.test.*',
        '**/*.spec.*',
        'dist/**',
      ],
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
