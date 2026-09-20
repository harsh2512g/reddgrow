import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/extension',
  outputDir: '.threadsignal/extension-test-results',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'pnpm --filter @threadsignal/web start',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'pnpm --filter @threadsignal/worker start',
      url: 'http://127.0.0.1:3001/api/health/ready',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
