import { test, expect } from '@playwright/test';
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

  await page.getByLabel('Message SADIE').fill('hello');
  await page.getByRole('button', { name: /send/i }).click();

  const assistant = page.locator('[data-role="assistant-message"]').last();
  await expect(assistant).toContainText('chunk-1');
  await expect(assistant).toContainText('chunk-3');
  await expect(assistant).toContainText('chunk-5');

  await expect(page.getByRole('button', { name: /stop generating/i })).toHaveCount(0);

  await app.close();
  await upstream.close();
});

test('cancel stops stream', async () => {
  const upstream = await startMockUpstream();
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

  await page.getByLabel('Message SADIE').fill('hello');
  await page.getByRole('button', { name: /send/i }).click();

  // Wait until streaming controls are visible then click cancel quickly so
  // cancellation happens early in the upstream stream lifecycle.
  await page.getByRole('button', { name: /stop generating/i }).waitFor({ state: 'visible' });
  const assistant = page.locator('[data-role="assistant-message"]').last();
  // Click the cancel (stop generating) button immediately
  await page.getByRole('button', { name: /stop generating/i }).click();

  // Cancelled badge should appear
  await expect(assistant).toContainText(/cancelled/i);

  // Ensure no chunks were appended after the cancelled marker. We allow some
  // chunks to have arrived before cancel, but after the cancelled badge appears
  // no additional chunk-* tokens should be appended.
  const contentAfterCancel = await assistant.innerText();
  await page.waitForTimeout(300);
  const contentLater = await assistant.innerText();
  // Allow at most one additional in-flight chunk to arrive after cancel.
  const extractMaxChunk = (s: string) => {
    const matches = s.match(/chunk-(\d+)/g) || [];
    return matches.length ? Math.max(...matches.map(m => parseInt(m.split('-')[1], 10))) : 0;
  };
  const maxBefore = extractMaxChunk(contentAfterCancel);
  const maxAfter = extractMaxChunk(contentLater);
  // Tolerate a single in-flight chunk but ensure cancellation prevents further chunks
  await expect(maxAfter).toBeLessThanOrEqual(maxBefore + 1);

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
          // open an SSE connection then immediately destroy it to simulate an upstream error
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.destroy();
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
    SADIE_E2E: '1',
    NODE_ENV: 'test',
  });

  await page.getByLabel('Message SADIE').fill('hello');
  await page.getByRole('button', { name: /send/i }).click();

  const assistant = page.locator('[data-role="assistant-message"]').last();

  // Error badge should appear (app converts stream errors into message.error)
  await expect(assistant).toContainText(/error/i);

  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});
