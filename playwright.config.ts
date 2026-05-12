import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for KitchFix Ops Hub e2e tests.
 *
 * The dev server is NOT managed here — start it manually before running tests:
 *   TEST_MODE=true npm run dev
 * (TEST_MODE wiring is handled in Step 4 of the Playwright setup plan.)
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
