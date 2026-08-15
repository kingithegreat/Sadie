import { test, expect } from '@playwright/test';
// Ensure we force E2E mock behavior in tests
process.env.HOMEBOT_E2E = 'true';
import { startMockUpstream } from './mockUpstream';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('generates a document summary via streaming', async () => {
  // Start a deterministic mock upstream that emits a few chunks
  const upstream = await startMockUpstream({ chunkIntervalMs: 200, chunkCount: 5 });
  process.env.N8N_URL = upstream.baseUrl;
  process.env.OPENAI_ENDPOINT = upstream.openaiEndpoint || upstream.baseUrl;
  process.env.HOMEBOT_USE_PROXY = 'false';

  const { app, page } = await launchElectronApp({
    N8N_URL: upstream.baseUrl,
    OPENAI_ENDPOINT: upstream.openaiEndpoint || upstream.baseUrl,
    PROXY_RETRY_ENABLED: 'false',
    HOMEBOT_E2E: '1',
    NODE_ENV: 'test',
  });

  // Gate test on canonical readiness
  await waitForAppReady(page);

  // The first-run modal covers the composer on any profile that has not been
  // through onboarding — which is every CI runner. Without this the fill lands
  // on an unreachable input, Send stays disabled, and the click below waits the
  // full 30s for an element it can never reach. That single timeout has failed
  // this shard on ubuntu and macOS for 28 consecutive runs, taking the whole
  // e2e gate red with it while the other 10 tests in the shard passed.
  //
  // It passed on a developer machine the entire time, because that profile
  // already had firstRun:false saved. The test was describing one computer.
  await dismissFirstRun(page);

  // Send a summarize request through the chat UI
  await page.getByLabel('Message HomeBot').fill('Summarize: The quick brown fox jumped over the lazy dog.');
  await page.locator('button.send-button').click();

  // Wait for streaming assistant message and verify chunks arrived
  const assistantWithChunk = page.locator('[data-role="assistant-message"]:has-text("chunk-1")').first();
  await expect(assistantWithChunk).toBeVisible({ timeout: 15000 });
  await expect(assistantWithChunk).toContainText('chunk-1', { timeout: 15000 });
  await expect(assistantWithChunk).toContainText('chunk-3', { timeout: 15000 });
  await expect(assistantWithChunk).toContainText('chunk-5', { timeout: 15000 });

  await app.close();
  await upstream.close();
});
