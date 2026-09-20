import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  // Journeys share provider community context; concurrent refreshes correctly invalidate draft approval.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @threadsignal/web start',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    ...(process.env.THREADSIGNAL_SERVICES_READY === '1'
      ? [
          {
            command: 'pnpm --filter @threadsignal/worker start',
            url: 'http://127.0.0.1:3001/api/health/ready',
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
