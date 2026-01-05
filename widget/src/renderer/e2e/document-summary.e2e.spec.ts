import { test, expect } from '@playwright/test';
// Ensure we force E2E mock behavior in tests
process.env.SADIE_E2E = 'true';
import { startMockUpstream } from './mockUpstream';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

test('generates a document summary via streaming', async () => {
  // Start a deterministic mock upstream that emits a few chunks
  const upstream = await startMockUpstream({ chunkIntervalMs: 200, chunkCount: 5 });
  process.env.N8N_URL = upstream.baseUrl;
  process.env.OPENAI_ENDPOINT = upstream.openaiEndpoint || upstream.baseUrl;
  process.env.SADIE_USE_PROXY = 'false';

  const { app, page } = await launchElectronApp({
    N8N_URL: upstream.baseUrl,
    OPENAI_ENDPOINT: upstream.openaiEndpoint || upstream.baseUrl,
    PROXY_RETRY_ENABLED: 'false',
    SADIE_E2E: '1',
    NODE_ENV: 'test',
  });

  // Gate test on canonical readiness
  await waitForAppReady(page);

  // Send a summarize request through the chat UI
  const beforeCount = await page.locator('[data-role="assistant-message"]').count();
  await page.getByLabel('Message SADIE').fill('Summarize: The quick brown fox jumped over the lazy dog.');
  await page.getByRole('button', { name: /send/i }).click();

  // Wait for streaming assistant message and verify chunks arrived
  const assistantWithChunk = page.locator('[data-role="assistant-message"]:has-text("chunk-1")').first();
  await expect(assistantWithChunk).toBeVisible({ timeout: 15000 });
  await expect(assistantWithChunk).toContainText('chunk-1', { timeout: 15000 });
  await expect(assistantWithChunk).toContainText('chunk-3', { timeout: 15000 });
  await expect(assistantWithChunk).toContainText('chunk-5', { timeout: 15000 });

  await app.close();
  await upstream.close();
});
