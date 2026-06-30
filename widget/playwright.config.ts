import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src/renderer/e2e',
  // live-sanity.e2e.spec.ts requires a real running Ollama server and can never
  // pass in standard CI (status stays "disconnected"). It is run explicitly via
  // the `e2e:live` script, which sets HOMEBOT_E2E_LIVE=1 to opt back in.
  testIgnore: process.env.HOMEBOT_E2E_LIVE === '1' ? [] : ['**/live-sanity.e2e.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // Ensure shards retry independently in CI
  retries: 1,
  // Ensure Playwright always writes the artifacts we expect in CI and locally
  reporter: [
    ['list'],
    ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT || 'test-results/junit.xml' }],
    ['html', { outputFolder: process.env.PLAYWRIGHT_HTML_REPORT || 'playwright-report', open: 'never' }],
  ],
  use: {
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure'
  }
});

