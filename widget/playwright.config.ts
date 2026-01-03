import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // Ensure shards retry independently in CI
  retries: 1,
  // Ensure Playwright always writes the artifacts we expect in CI and locally
  reporter: [
    ['list'],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    env: { SADIE_E2E: 'true' },
    // Retain traces/videos/screenshots only on failure to save CI storage
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
      use: {
        // Electron tests will launch the app from the repo root
        launchOptions: {
          args: ['.'],
        },
      },
    }
  ]
});

