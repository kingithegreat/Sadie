import { test, expect } from '@playwright/test';
process.env.HOMEBOT_E2E = 'true';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

/**
 * A throwaway profile pointing the app at this spec's mock server.
 *
 * Without one the app uses the real user profile, and the stored ollamaUrl
 * wins over the OLLAMA_URL env var. On a dev box that points at a running
 * Ollama so the send goes through; on CI there is none, the app shows "Ollama
 * Offline", no /api/chat POST is ever made, and the recorded request is
 * undefined. The test was passing here for a reason that had nothing to do
 * with what it asserts.
 */
function seedProfile(ollamaUrl: string) {
  const dir = path.join(os.tmpdir(), `homebot-e2e-sysprompt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config', 'user-settings.json'),
    JSON.stringify({ firstRun: false, theme: 'dark', ollamaUrl }, null, 2),
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
        if (req.url === '/webhook/homebot/chat' && req.method === 'POST') {
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
    HOMEBOT_E2E: '1',
    HOMEBOT_E2E_BYPASS_MOCK: '1',
    HOMEBOT_DIRECT_OLLAMA: '1',
    NODE_ENV: 'test'
  }, seedProfile(base));
  await waitForAppReady(page);

  // Ensure first-run modal (if any) is dismissed so we can interact with main UI
  await completeFirstRunWizardIfVisible(page);

  // Set a conversation system prompt via the new UI element (Chat guidelines)
  const convPrompt = 'You are a terse assistant that replies in one sentence.';
  await page.locator('.guidelines-toggle-btn').click();
  await page.getByLabel('Conversation system prompt').fill(convPrompt);
  await page.waitForTimeout(1000); // Wait for the system prompt to be saved

  // Send a normal message
  await page.getByLabel('Message HomeBot').fill('Hello, how are you?');
  console.log('[E2E-TEST] About to click send button');
  const sendButton = page.locator('button.send-button');
  const isEnabled = await sendButton.isEnabled();
  console.log('[E2E-TEST] Send button enabled:', isEnabled);
  await sendButton.click();

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

  // Wait for the renderer -> main -> /api/chat POST to actually arrive rather
  // than sleeping a fixed 600ms: a CI runner is slower than a dev box, so the
  // fixed wait made the result depend on the machine.
  const postDeadline = Date.now() + 15_000;
  while (!(server as any)._lastApiChat && Date.now() < postDeadline) {
    await page.waitForTimeout(200);
  }

  // Grab the captured /api/chat request body from the mock server
  const recorded = (server as any)._lastApiChat;
  expect(recorded).toBeDefined();
  // messages should be an array and the first system message should equal the conversation prompt
  expect(Array.isArray(recorded.messages)).toBe(true);
  expect(recorded.messages.length).toBeGreaterThan(0);
  const firstSystem = recorded.messages.find((m: any) => m.role === 'system');
  expect(firstSystem).toBeDefined();
  // Since conversation prompt is prepended, it should appear before the global HomeBot prompt
  expect(firstSystem.content).toContain('terse assistant');

  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
});