import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src/renderer/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
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
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure'
  }
});

