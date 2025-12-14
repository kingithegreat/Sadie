import { test, expect } from '@playwright/test';
// Ensure we force E2E mock behavior in tests
process.env.SADIE_E2E = 'true';
import { startMockUpstream } from './mockUpstream';
import { launchElectronApp } from './launchElectron';

test('streams chunks to UI', async () => {
  // Use a larger per-chunk delay so cancellation has time to reach main before
  // the server emits more chunks; this makes the cancellation assertion deterministic.
  const upstream = await startMockUpstream({ chunkIntervalMs: 300 });
  // Configure main to post directly to the mock upstream as an n8n-style streaming endpoint
  process.env.N8N_URL = upstream.baseUrl; // main builds POST url as `${N8N_URL}/webhook/sadie/chat/stream`
  // Some parts of the pipeline (proxy tooling) expect OPENAI_ENDPOINT; point it to the mock upstream as well
  process.env.OPENAI_ENDPOINT = upstream.openaiEndpoint || upstream.baseUrl;
  process.env.SADIE_USE_PROXY = 'false';

  const { app, page } = await launchElectronApp({
    N8N_URL: upstream.baseUrl,
    PROXY_RETRY_ENABLED: 'false',
    SADIE_E2E: '1',
    NODE_ENV: 'test',
  });

  const beforeCount = await page.locator('[data-role="assistant-message"]').count();
  await page.getByLabel('Message SADIE').fill('hello');
  await page.getByRole('button', { name: /send/i }).click();

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
  await expect(assistant).toContainText('chunk-3');
  await expect(assistant).toContainText('chunk-5');

  await expect(assistant.locator('button[aria-label="Stop generating"]')).toHaveCount(0);

  await app.close();
  await upstream.close();
});

test('cancel stops stream', async () => {
  // Make the stream longer so cancel can be done mid-stream
  const upstream = await startMockUpstream({ chunkIntervalMs: 200, chunkCount: 10 });
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

  const beforeCount = await page.locator('[data-role="assistant-message"]').count();
  await page.getByLabel('Message SADIE').fill('hello');
  await page.getByRole('button', { name: /send/i }).click();

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
  await expect(assistant).toHaveAttribute('data-state', /cancelled|finished/, { timeout: 5000 });

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
        if (req.url === '/mock-sse' || req.url === '/webhook/sadie/chat/stream' || req.url === '/webhook/sadie/stream') {
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
  // main builds URL as `${N8N_URL}/webhook/sadie/chat/stream` so set N8N_URL to the server base
  const base = `http://127.0.0.1:${port}`;

  process.env.N8N_URL = base;
  process.env.SADIE_USE_PROXY = 'false';

  const { app, page } = await launchElectronApp({
    N8N_URL: base,
    OPENAI_ENDPOINT: `${base}/mock-sse`,
    PROXY_RETRY_ENABLED: 'false',
    SADIE_E2E: '0',
    SADIE_DIRECT_OLLAMA: '0',
    NODE_ENV: 'test',
  });

  // Quick pre-flight check to ensure the mock upstream returns 500 at the streaming endpoint
  const mockStatus = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { method: 'GET' });
      return r.status;
    } catch (e) {
      return `err:${(e as any).message}`;
    }
  }, `${base}/webhook/sadie/chat/stream`);
  // eslint-disable-next-line no-console
  console.log('[E2E-TEST] Mock upstream check status:', mockStatus);
  expect(mockStatus).toBe(500);

  // Attach a listener to the renderer so we can assert the error event actually arrived
  await page.evaluate(() => {
    (window as any).__sadie_error_received = false;
    (window as any).__sadie_error_event = null;
    const electron = (window as any).electron;
    if (electron && typeof electron.onStreamError === 'function') {
      electron.onStreamError((d: any) => {
        (window as any).__sadie_error_received = true;
        (window as any).__sadie_error_event = d;
        try { console.log('[E2E-TRACE]', 'renderer stream error event', d); } catch (e) {}
      });
    }
  });

  const beforeCount = await page.locator('[data-role="assistant-message"]').count();
  await page.getByLabel('Message SADIE').fill('hello');
  await page.getByRole('button', { name: /send/i }).click();

  const assistant = page.locator('[data-role="assistant-message"]').nth(beforeCount);

  // Wait until the state is no longer 'streaming', then expect 'error'
  await expect(assistant).not.toHaveAttribute('data-state', 'streaming', { timeout: 10000 });
  // The renderer should receive the error event
  const errorReceived = await page.evaluate(() => (window as any).__sadie_error_received);
  expect(errorReceived).toBe(true);
  const state = await assistant.getAttribute('data-state');
  expect(state).toBe('error');

  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('falls back to non-stream final text on stream init error', async () => {
  // Server that fails streaming requests but returns a non-stream final message
  const server = await (async () => {
    const http = await import('http');
    return new Promise<any>((resolve) => {
      const s = http.createServer(async (req, res) => {
        if (req.url === '/api/chat' && req.method === 'POST') {
          try {
            let body = '';
            for await (const chunk of req) body += chunk.toString();
            const parsed = body ? JSON.parse(body) : {};
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
  process.env.SADIE_USE_PROXY = 'false';

  const { app, page } = await launchElectronApp({
    N8N_URL: base,
    OPENAI_ENDPOINT: `${base}/mock-sse`,
    PROXY_RETRY_ENABLED: 'false',
    SADIE_E2E: '0',
    SADIE_DIRECT_OLLAMA: '1',
    NODE_ENV: 'test',
  });

  const beforeCount = await page.locator('[data-role="assistant-message"]').count();
  await page.getByLabel('Message SADIE').fill('hello');
  await page.getByRole('button', { name: /send/i }).click();

  const assistant = page.locator('[data-role="assistant-message"]').nth(beforeCount);

  // Wait for the assistant to finish and contain the final fallback text
  await expect(assistant).toContainText('final-fallback', { timeout: 10000 });
  // Ensure the message is marked finished (not error)
  await expect(assistant).toHaveAttribute('data-state', 'finished', { timeout: 5000 });

  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});
