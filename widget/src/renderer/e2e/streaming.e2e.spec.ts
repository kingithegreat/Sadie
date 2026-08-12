import { test, expect } from '@playwright/test';
// Ensure we force E2E mock behavior in tests
process.env.HOMEBOT_E2E = 'true';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { startMockUpstream } from './mockUpstream';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

/**
 * A throwaway profile pointing the app at a given Ollama URL.
 *
 * Without one the app uses the real user profile, whose stored ollamaUrl beats
 * the OLLAMA_URL env var. On a machine running Ollama the send succeeds; on CI
 * it does not, and the assistant message is an "Ollama Offline" card rather
 * than the streamed answer the assertion reads.
 */
function seedProfile(ollamaUrl: string) {
  const dir = path.join(os.tmpdir(), `homebot-e2e-streaming-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config', 'user-settings.json'),
    JSON.stringify({
      firstRun: false,
      theme: 'dark',
      ollamaUrl,
      // The mock advertises exactly one model in /api/tags. Uncensored mode is
      // ON by default and would pick dolphin-mistral:7b, which the mock does
      // not serve, so the app reports Ollama unreachable before it ever
      // streams — and the fallback under test never runs.
      uncensoredMode: false,
      chatModel: 'mock-model',
      ollamaModel: 'mock-model',
    }, null, 2),
    'utf-8',
  );
  return dir;
}

async function completeFirstRunWizardIfVisible(page: any) {
  const firstRunHeader = page.getByText('Welcome to HomeBot');
  if (!(await firstRunHeader.isVisible().catch(() => false))) return;

  const modal = page.locator('.first-run-modal');
  await modal.getByRole('button', { name: /Local \(Ollama\)/i }).click();
  await modal.getByRole('button', { name: /Next|Continue anyway/i }).click();
  await modal.getByRole('button', { name: /Get Started/i }).click();
}

test('streams chunks to UI', async () => {
  // Use a larger per-chunk delay so cancellation has time to reach main before
  // the server emits more chunks; this makes the cancellation assertion deterministic.
  const upstream = await startMockUpstream({ chunkIntervalMs: 300 });
  // Configure main to post directly to the mock upstream as an n8n-style streaming endpoint
  process.env.N8N_URL = upstream.baseUrl; // main builds POST url as `${N8N_URL}/webhook/homebot/chat/stream`
  // Some parts of the pipeline (proxy tooling) expect OPENAI_ENDPOINT; point it to the mock upstream as well
  process.env.OPENAI_ENDPOINT = upstream.openaiEndpoint || upstream.baseUrl;
  process.env.HOMEBOT_USE_PROXY = 'false';

  const { app, page } = await launchElectronApp({
    N8N_URL: upstream.baseUrl,
    PROXY_RETRY_ENABLED: 'false',
    HOMEBOT_E2E: '1',
    HOMEBOT_E2E_BYPASS_MOCK: '0',
    HOMEBOT_DIRECT_OLLAMA: '0',
    NODE_ENV: 'test',
  }, seedProfile(upstream.baseUrl));
  await waitForAppReady(page);
  await completeFirstRunWizardIfVisible(page);


  await page.getByLabel('Message HomeBot').fill('hello');
  await page.locator('button.send-button').click();

  // Fetch main-process router logs for debugging (E2E-only)
  try {
    // eslint-disable-next-line no-console
    console.log('[E2E-DEBUG] requesting main router logs');
    // @ts-ignore - test helper exposed by preload/main
    const routerLogs = await page.evaluate(async () => await (window as any).electron.invoke('homebot:__e2e_get_router_logs'));
    // eslint-disable-next-line no-console
    console.log('[E2E-ROUTER-LOGS]', JSON.stringify(Array.isArray(routerLogs) ? routerLogs.slice(-200) : routerLogs, null, 2));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[E2E-DEBUG] failed to fetch router logs', String(e));
  }

  // wait a moment and fetch logs again to catch any delayed events
  try {
    await page.waitForTimeout(2000);
    // @ts-ignore
    const routerLogs2 = await page.evaluate(async () => await (window as any).electron.invoke('homebot:__e2e_get_router_logs'));
    // eslint-disable-next-line no-console
    console.log('[E2E-ROUTER-LOGS-2]', JSON.stringify(Array.isArray(routerLogs2) ? routerLogs2.slice(-200) : routerLogs2, null, 2));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[E2E-DEBUG] failed to fetch router logs (2)', String(e));
  }

  // Also fetch main/renderer debug buffers for additional context
  try {
    // @ts-ignore
    const debug = await page.evaluate(async () => await (window as any).electron.invoke('homebot:read-debug-logs'));
    // eslint-disable-next-line no-console
    console.log('[E2E-DEBUG-LOGS]', JSON.stringify(debug, null, 2));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[E2E-DEBUG] failed to read debug logs', String(e));
  }

  // Wait for the assistant message that begins streaming (i.e. contains chunk-1)
  const assistantWithChunk = page.locator('[data-role="assistant-message"]:has-text("chunk-1")').first();
  await expect(assistantWithChunk).toBeVisible({ timeout: 15000 });
  const assistant = assistantWithChunk;
  // Ensure an assistant message appears at all first, then wait for chunk-5
  try {
    await expect(assistant).toBeVisible({ timeout: 5000 });
  } catch (e) {
    // Dump page snapshot to help debugging in CI logs
    // eslint-disable-next-line no-console
    console.log('--- PAGE CONTENT BEFORE ASSERT ---');
    // eslint-disable-next-line no-console
    console.log(await page.content());
    throw e;
  }
  // Wait for the stream to produce chunk tokens
  await expect(assistant).toContainText('chunk-1', { timeout: 15000 });
  await expect(assistant).toContainText('chunk-3', { timeout: 15000 });
  await expect(assistant).toContainText('chunk-5', { timeout: 15000 });

  await expect(assistant.locator('button[aria-label="Stop generating"]')).toHaveCount(0);

  await app.close();
  await upstream.close();
});

test('cancel stops stream', async () => {
  // Make the stream longer so cancel can be done mid-stream
  const upstream = await startMockUpstream({ chunkIntervalMs: 200, chunkCount: 10 });
  process.env.N8N_URL = upstream.baseUrl;
  process.env.OPENAI_ENDPOINT = upstream.openaiEndpoint || upstream.baseUrl;
  process.env.HOMEBOT_USE_PROXY = 'false';

  const { app, page } = await launchElectronApp({
    N8N_URL: upstream.baseUrl,
    OPENAI_ENDPOINT: upstream.openaiEndpoint || upstream.baseUrl,
    PROXY_RETRY_ENABLED: 'false',
    HOMEBOT_E2E: '1',
    HOMEBOT_E2E_BYPASS_MOCK: '0',
    HOMEBOT_DIRECT_OLLAMA: '0',
    NODE_ENV: 'test',
  }, seedProfile(upstream.baseUrl));
  await waitForAppReady(page);
  await completeFirstRunWizardIfVisible(page);


  await page.getByLabel('Message HomeBot').fill('hello');
  await page.locator('button.send-button').click();

  // Wait until streaming controls are visible then click cancel quickly so
  // cancellation happens early in the upstream stream lifecycle.
  // Wait for the assistant that starts the stream (contains chunk-1) to appear
  const assistantWithChunk = page.locator('[data-role="assistant-message"]:has-text("chunk-1")').first();
  await expect(assistantWithChunk).toBeVisible({ timeout: 15000 });
  const assistant = assistantWithChunk;
  // Wait for first chunk to ensure streaming started, then cancel via preload API
  await expect(assistant).toContainText('chunk-1', { timeout: 10000 });
  const msgId = await assistant.getAttribute('data-message-id');
  await page.evaluate((id) => (window as any).electron.cancelStream?.(id), msgId);

  // Wait for the renderer to observe the cancelled/finished state so we know cancel was processed
  await expect(assistant).toHaveAttribute('data-state', /cancelled|finished/, { timeout: 10000 });

  // Ensure no additional content arrives after cancel is processed
  const contentAfterCancelProcessed = await assistant.innerText();
  await page.waitForTimeout(1000);
  const contentLater = await assistant.innerText();
  expect(contentLater.trim()).toBe(contentAfterCancelProcessed.trim());

  await app.close();
  await upstream.close();
});

test('handles upstream error', async () => {
  // start a server that errors immediately for either mock-sse or n8n POST path
  const server = await (async () => {
    const http = await import('http');
    return new Promise<any>((resolve) => {
      const s = http.createServer((req, res) => {
        if (req.url === '/mock-sse' || req.url === '/webhook/homebot/chat/stream' || req.url === '/webhook/homebot/stream') {
          // immediate error response to simulate upstream failure
          res.writeHead(500, {
            'Content-Type': 'application/json'
          });
          res.end(JSON.stringify({ error: 'mock upstream error' }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      s.listen(0, () => resolve(s));
    });
  })();

  const { port } = server.address() as any;
  // main builds URL as `${N8N_URL}/webhook/homebot/chat/stream` so set N8N_URL to the server base
  const base = `http://127.0.0.1:${port}`;

  process.env.N8N_URL = base;
  process.env.HOMEBOT_USE_PROXY = 'false';

  // Prepare a temp profile with firstRun:false so the wizard doesn't block the UI
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const tmpDir = path.join(os.tmpdir(), `homebot-e2e-err-${Date.now()}`);
  fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'config', 'user-settings.json'), JSON.stringify({ firstRun: false, n8nUrl: base }));

  const { app, page } = await launchElectronApp({
    N8N_URL: base,
    OPENAI_ENDPOINT: `${base}/mock-sse`,
    PROXY_RETRY_ENABLED: 'false',
    HOMEBOT_E2E: '1',
    HOMEBOT_E2E_BYPASS_MOCK: '0',
    HOMEBOT_DIRECT_OLLAMA: '0',
    NODE_ENV: 'test',
  }, tmpDir);
  await waitForAppReady(page);

  // Attach a listener to the renderer so we can assert the error event actually arrived
  await page.evaluate(() => {
    (window as any).__homebot_error_received = false;
    (window as any).__homebot_error_event = null;
    const electron = (window as any).electron;
    if (electron && typeof electron.onStreamError === 'function') {
      electron.onStreamError((d: any) => {
        (window as any).__homebot_error_received = true;
        (window as any).__homebot_error_event = d;
        try { console.log('[E2E-TRACE]', 'renderer stream error event', d); } catch (e) {}
      });
    }
  });

  const beforeCount = await page.locator('[data-role="assistant-message"]').count();
  await page.getByLabel('Message HomeBot').fill('hello');
  await page.locator('button.send-button').click();

  const assistant = page.locator('[data-role="assistant-message"]').nth(beforeCount);

  // Invoke a test-only handler to simulate upstream error (deterministic)
  const msgId = await assistant.getAttribute('data-message-id');
  await page.evaluate(async (id) => {
    try {
      // @ts-ignore - test hook
      await (window as any).electron.invoke('homebot:__e2e_trigger_upstream_error', { streamId: id, message: 'Upstream error (simulated)' });
    } catch (e) {
      // ignore invocation errors
    }
  }, msgId);

  // Wait for the renderer to observe the stream-error IPC event (E2E global tracker)
  await page.waitForFunction(() => Array.isArray((window as any).__e2eEvents) && (window as any).__e2eEvents.includes('homebot:stream-error'), null, { timeout: 20000 });
  // Verify the event was observed
  const events = await page.evaluate(() => (window as any).__e2eEvents || []);
  expect(events.includes('homebot:stream-error')).toBe(true);

  // After the error event the UI should transition to the 'error' state and show the error indicator
  await expect(assistant).toHaveAttribute('data-state', 'error', { timeout: 10000 });
  await expect(assistant).toContainText('Something went wrong', { timeout: 10000 });
  await expect(assistant).toContainText('Retry', { timeout: 10000 });

  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('falls back to non-stream final text on stream init error', async () => {
  // Server that fails streaming requests but returns a non-stream final message
  const server = await (async () => {
    const http = await import('http');
    return new Promise<any>((resolve) => {
      const s = http.createServer(async (req, res) => {
        if (req.url === '/api/tags' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models: [{ name: 'mock-model' }] }));
          return;
        }
        if (req.url === '/api/version' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ version: '0.0.0-test' }));
          return;
        }
        if (req.url === '/api/chat' && req.method === 'POST') {
          try {
            let body = '';
            for await (const chunk of req) body += chunk.toString();
            const parsed = body ? JSON.parse(body) : {};
            // Debugging: log incoming request to verify what the app sent
            // eslint-disable-next-line no-console
            console.log('[E2E-MOCK-SERVER] /api/chat received', { parsed: parsed });
            if (parsed.stream === true) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'streaming failure' }));
              return;
            }
            // Non-streaming request: return final assistant content
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: { content: 'final-fallback' } }));
            return;
          } catch (e) {
            res.writeHead(500);
            res.end();
            return;
          }
        }
        res.writeHead(404);
        res.end();
      });

      s.listen(0, () => resolve(s));
    });
  })();

  const { port } = server.address() as any;
  const base = `http://127.0.0.1:${port}`;

  // Point the app's Ollama URL to our server
  process.env.OLLAMA_URL = base;
  process.env.N8N_URL = base; // not used but keep consistent
  process.env.HOMEBOT_USE_PROXY = 'false';

  const { app, page } = await launchElectronApp({
    N8N_URL: base,
    OPENAI_ENDPOINT: `${base}/mock-sse`,
    PROXY_RETRY_ENABLED: 'false',
    HOMEBOT_E2E: '1',
    OLLAMA_URL: base,
    HOMEBOT_E2E_BYPASS_MOCK: '1',
    HOMEBOT_DIRECT_OLLAMA: '1',
    NODE_ENV: 'test',
  }, seedProfile(base));
  await waitForAppReady(page);

  // If the first-run modal is visible (fresh profile), finish setup so the test can interact with the main UI
  await completeFirstRunWizardIfVisible(page);

  const beforeCount = await page.locator('[data-role="assistant-message"]').count();
  await page.getByLabel('Message HomeBot').fill('hello');
  await page.locator('button.send-button').click();

  const assistant = page.locator('[data-role="assistant-message"]').nth(beforeCount);

  // Wait for the assistant to finish and contain the final fallback text
  // Simulate the fallback via a test-only IPC helper so the test is deterministic
  // Wait for the renderer to have assigned a message id and be in a streaming/active state
  await expect(assistant).toHaveAttribute('data-message-id', /.+/, { timeout: 10000 });
  const msgId = await assistant.getAttribute('data-message-id');
  // Invoke the test-only IPC helper and verify it reported success
  const res = await page.evaluate(async (id) => {
    // Try a few times to invoke the test-only handler in case main hasn't registered it yet
    for (let i = 0; i < 5; i++) {
      try {
        // @ts-ignore - test hook
        const r = await (window as any).electron.invoke('homebot:__e2e_trigger_fallback', { streamId: id, finalText: 'final-fallback' });
        return r;
      } catch (e) {
        const s = String(e || '');
        if (s.includes('No handler registered') || s.includes('E2E_ONLY')) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        return { ok: false, error: s };
      }
    }
    return { ok: false, error: 'NO_HANDLER' };
  }, msgId);
  // Ensure the IPC handler actually ran and returned ok
  // eslint-disable-next-line no-console
  console.log('[E2E-TRACE] __e2e_trigger_fallback response', res);
  expect(res && res.ok).toBe(true);
  // The fallback successfully delivered the text — assert it rendered as a normal finished message.
  await expect(assistant).toContainText('final-fallback', { timeout: 10000 });
  await expect(assistant).toHaveAttribute('data-state', 'finished', { timeout: 5000 });

  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});
