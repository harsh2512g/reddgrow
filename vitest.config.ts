import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Bound concurrent jsdom workers on laptops and the personal service runner.
    // Keep assertion deadlines unchanged; avoid CPU contention between UI suites.
    maxWorkers: 2,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/**/tests/**/*.test.ts',
            'apps/worker/tests/**/*.test.ts',
            'apps/extension/tests/**/*.test.ts',
            'tests/tooling/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
      {
        resolve: { alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) } },
        oxc: { jsx: { runtime: 'automatic' } },
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: ['./apps/web/tests/setup.ts'],
          include: ['apps/web/tests/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/e2e/**'],
        },
      },
    ],
  },
});
