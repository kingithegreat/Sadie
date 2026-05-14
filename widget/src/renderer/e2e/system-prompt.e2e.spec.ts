import { test, expect } from '@playwright/test';
process.env.SADIE_E2E = 'true';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

async function completeFirstRunWizardIfVisible(page: any) {
  const firstRunHeader = page.getByText('Welcome to SADIE');
  if (!(await firstRunHeader.isVisible().catch(() => false))) return;

  const modal = page.locator('.first-run-modal');
  await modal.getByRole('button', { name: /Local \(Ollama\)/i }).click();
  await modal.getByRole('button', { name: /Next|Continue anyway/i }).click();
  await modal.getByRole('button', { name: /Get Started/i }).click();
}

// Verifies that a per-conversation system prompt (Chat guidelines) is included
// in the model input (the /api/chat POST body sent to Ollama).
test('conversation system prompt is sent to model (prepended)', async () => {
  // Start a small HTTP server that captures the POST body for /api/chat
  const server = await (async () => {
    const http = await import('http');
    return new Promise<any>((resolve) => {
      const s = http.createServer(async (req, res) => {
        if (req.url === '/api/chat' && req.method === 'POST') {
          try {
            let body = '';
            for await (const chunk of req) body += chunk.toString();
            const parsed = body ? JSON.parse(body) : {};
            // Return a streaming response like Ollama
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.write(JSON.stringify({ message: { role: 'assistant', content: 'Hello' }, done: false }) + '\n');
            res.write(JSON.stringify({ message: { role: 'assistant', content: '!' }, done: true }) + '\n');
            res.end();

            // Attach the parsed request to the server instance so the test can assert on it
            (s as any)._lastApiChat = parsed;
            return;
          } catch (e) {
            res.writeHead(500);
            res.end();
            return;
          }
        }
        if (req.url === '/webhook/sadie/chat' && req.method === 'POST') {
          // Handle n8n webhook path as well
          try {
            let body = '';
            for await (const chunk of req) body += chunk.toString();
            const parsed = body ? JSON.parse(body) : {};
            // Return a simple response
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: { content: 'ok from n8n' } }));

            // For n8n path, also set _lastApiChat for the test
            (s as any)._lastApiChat = parsed;
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

  // Point the app's Ollama URL to our mock server so message-router will POST to /api/chat
  process.env.OLLAMA_URL = base;
  process.env.N8N_URL = base; // not used by this test but keep consistent

  const { app, page } = await launchElectronApp({
    OLLAMA_URL: base,
    N8N_URL: base,
    SADIE_E2E: '1',
    SADIE_E2E_BYPASS_MOCK: '1',
    SADIE_DIRECT_OLLAMA: '1',
    NODE_ENV: 'test'
  });
  await waitForAppReady(page);

  // Ensure first-run modal (if any) is dismissed so we can interact with main UI
  await completeFirstRunWizardIfVisible(page);

  // Set a conversation system prompt via the new UI element (Chat guidelines)
  const convPrompt = 'You are a terse assistant that replies in one sentence.';
  await page.locator('.guidelines-toggle-btn').click();
  await page.getByLabel('Conversation system prompt').fill(convPrompt);
  await page.waitForTimeout(1000); // Wait for the system prompt to be saved

  // Send a normal message
  await page.getByLabel('Message SADIE').fill('Hello, how are you?');
  console.log('[E2E-TEST] About to click send button');
  const sendButton = page.getByRole('button', { name: /send/i });
  const isEnabled = await sendButton.isEnabled();
  console.log('[E2E-TEST] Send button enabled:', isEnabled);
  await sendButton.click();

  // Fetch main-process router logs for debugging (E2E-only)
  try {
    // eslint-disable-next-line no-console
    console.log('[E2E-DEBUG] requesting main router logs');
    // @ts-ignore - test helper exposed by preload/main
    const routerLogs = await page.evaluate(async () => await (window as any).electron.invoke('sadie:__e2e_get_router_logs'));
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
    const routerLogs2 = await page.evaluate(async () => await (window as any).electron.invoke('sadie:__e2e_get_router_logs'));
    // eslint-disable-next-line no-console
    console.log('[E2E-ROUTER-LOGS-2]', JSON.stringify(Array.isArray(routerLogs2) ? routerLogs2.slice(-200) : routerLogs2, null, 2));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[E2E-DEBUG] failed to fetch router logs (2)', String(e));
  }

  // Also fetch main/renderer debug buffers for additional context
  try {
    // @ts-ignore
    const debug = await page.evaluate(async () => await (window as any).electron.invoke('sadie:read-debug-logs'));
    // eslint-disable-next-line no-console
    console.log('[E2E-DEBUG-LOGS]', JSON.stringify(debug, null, 2));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[E2E-DEBUG] failed to read debug logs', String(e));
  }

  // Wait a short time for the renderer -> main -> /api/chat POST to be made
  await page.waitForTimeout(600);

  // Grab the captured /api/chat request body from the mock server
  const recorded = (server as any)._lastApiChat;
  expect(recorded).toBeDefined();
  // messages should be an array and the first system message should equal the conversation prompt
  expect(Array.isArray(recorded.messages)).toBe(true);
  expect(recorded.messages.length).toBeGreaterThan(0);
  const firstSystem = recorded.messages.find((m: any) => m.role === 'system');
  expect(firstSystem).toBeDefined();
  // Since conversation prompt is prepended, it should appear before the global SADIE prompt
  expect(firstSystem.content).toContain('terse assistant');

  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});