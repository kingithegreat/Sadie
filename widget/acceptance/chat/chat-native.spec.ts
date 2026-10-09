import { test, expect, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import { describeFailure, openFirstUserFixture } from '../first-user/first-user-native-bootstrap';

const firstPrompt = 'The secret phrase is Tui-47. Acknowledge it.';
const contextPrompt = 'Repeat the secret phrase from our previous turn.';
const failurePrompt = 'Produce the failure example now.';
const stopPrompt = 'Keep describing a meadow until stopped.';
const resumedPrompt = 'Give a short greeting after the stopped response.';
const firstAnswer = 'I have the secret phrase Tui-47 🌈 ready for our next turn.';
const contextAnswer = 'The secret phrase from our previous turn is Tui-47.';
const recoveredAnswer = 'The Retry succeeded and this response is complete.';
const resumedAnswer = 'Hello again. Chat remains usable after Stop.';
const customModel = 'homebot-chat-fixture';
const conversationTitle = 'Secret Phrase Memory Check';
const titleMessages = [
  { role: 'system', content: 'Generate a short conversation title (4-6 words max, no punctuation, no quotes) that captures what this exchange is about.' },
  { role: 'user', content: `User: ${firstPrompt}\nAssistant: ${firstAnswer}\nTitle:` },
];

async function paintedControl(control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  expect(await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return box.width > 24 && box.height > 24 && box.left >= 0 && box.top >= 0
      && box.right <= innerWidth && box.bottom <= innerHeight && !!top && (top === element || element.contains(top));
  }), 'The real control must have a visible clickable center').toBe(true);
}

for (const provider of ['local', 'custom'] as const) {
  test(`${provider} chat preserves context, recovers with Retry and stops through real controls`, async ({}, testInfo) => {
    test.skip(process.env.HOMEBOT_FIRST_USER_NATIVE !== '1', 'Opt-in isolated compiled production runtime.');
    test.skip(process.platform !== 'win32', 'Requires exact native/launcher Windows identities.');
    const generation: Array<{ body: any; provider: string }> = [];
    const titleRequests: Array<{ body: any; provider: string }> = [];
    let heartbeatEvents = 0;
    let failureCount = 0;
    const failureControl = { finish: null as (() => void) | null };
    let stopClosed = false;
    const serverErrors: string[] = [];
    const runtime = await openFirstUserFixture({ testInfo, firstRun: false, inventory: 'installed',
      customModel: provider === 'custom' ? customModel : undefined,
      chatHandler: async ({ body, response, provider: actualProvider }) => {
        try {
          if (actualProvider !== provider) throw Error('Chat reached the wrong provider.');
          // The ordinary first exchange also starts best-effort title creation.
          // Recognize only its exact fixture-bound transcript, keep its actual
          // HTTP request separately, and still require all six user chat calls.
          if (provider === 'custom' && body.model === customModel && body.stream === true
            && JSON.stringify(body.messages) === JSON.stringify(titleMessages)) {
            expect(body.tools).toBeUndefined();
            titleRequests.push({ body, provider: actualProvider });
            response.setHeader('Content-Type', 'text/event-stream');
            response.end('data: ' + JSON.stringify({ choices: [{ index: 0,
              delta: { content: conversationTitle }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
            return;
          }
          generation.push({ body, provider: actualProvider });
          const prompt = body.messages.filter((message: any) => message.role === 'user').at(-1)?.content;
          if (![firstPrompt, contextPrompt, failurePrompt, stopPrompt, resumedPrompt].includes(prompt)) throw Error('Unexpected generation prompt.');
          expect(body.messages.filter((message: any) => message.role === 'user' && message.content === prompt),
            'The current user turn must be sent exactly once').toHaveLength(1);
          const frame = (content: string, done = false) => provider === 'local'
            ? JSON.stringify({ model: 'qwen2.5:3b', message: { role: 'assistant', content }, done }) + '\n'
            : 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: done ? 'stop' : null }] }) + '\n\n';
          const finish = (content: string) => {
            response.write(frame(content));
            response.end(provider === 'local' ? frame('', true) : 'data: [DONE]\n\n');
          };
          response.setHeader('Content-Type', provider === 'local' ? 'application/x-ndjson' : 'text/event-stream');
          response.setHeader('Cache-Control', 'no-cache');
          if (prompt === firstPrompt) {
            if (provider === 'custom') {
              response.write('data:\n\ndata: \r\n\r\ndata: \ndata: \n\n');
              heartbeatEvents += 3;
            }
            // Real socket fragments split both a JSON record and a UTF-8 emoji.
            const bytes = Buffer.from(frame(firstAnswer));
            const emoji = bytes.indexOf(Buffer.from('🌈'));
            response.write(bytes.subarray(0, 11));
            await new Promise(resolve => setTimeout(resolve, 35));
            response.write(bytes.subarray(11, emoji + 2));
            await new Promise(resolve => setTimeout(resolve, 35));
            response.write(bytes.subarray(emoji + 2));
            response.end(provider === 'local' ? frame('', true) : 'data: [DONE]\n\n');
          } else if (prompt === contextPrompt) {
            expect(body.messages).toEqual(expect.arrayContaining([
              expect.objectContaining({ role: 'user', content: firstPrompt }),
              expect.objectContaining({ role: 'assistant', content: firstAnswer }),
            ]));
            finish(contextAnswer);
          } else if (prompt === failurePrompt && failureCount++ === 0) {
            // Deliver actual visible text before an actual provider error. This
            // intentionally exercises user Retry instead of automatic empty-output recovery.
            response.write(frame('A partial answer arrived before the fixture failure.'));
            failureControl.finish = () => response.end(provider === 'local'
              ? JSON.stringify({ error: 'Intentional chat fixture failure' }) + '\n'
              : 'data: ' + JSON.stringify({ error: { message: 'Invalid API key: intentional chat fixture failure' } }) + '\n\n');
          } else if (prompt === failurePrompt) finish(recoveredAnswer);
          else if (prompt === stopPrompt) {
            response.on('close', () => { stopClosed = !response.writableEnded; });
            response.write(frame('A quiet meadow continues while this real response remains open.'));
          } else finish(resumedAnswer);
        } catch (error: any) {
          serverErrors.push(error?.message || String(error));
          response.destroy();
        }
      },
    });
    const { app, page } = runtime;
    const failures: unknown[] = [];
    let proof: any;
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(item => item.getTitle().includes('HomeBot'));
        if (!window) throw Error('Owned HomeBot window missing');
        window.setSize(1000, 800); window.show(); window.focus();
      });
      await page.bringToFront();
      expect((await page.evaluate(() => window.electron.getEnv!())).isE2E).toBe(false);
      expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([]);
      await page.getByRole('button', { name: 'Explore HomeBot', exact: true }).click();
      await page.getByRole('button', { name: 'Start with chat', exact: true }).click();
      if (provider === 'custom') {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
        const cloud = settings.locator('.custom-llm-section');
        await cloud.getByRole('combobox', { name: 'Cloud API provider', exact: true }).selectOption('custom');
        await cloud.getByPlaceholder('https://your-api.com/v1', { exact: true }).fill(runtime.customUrl!);
        await cloud.getByRole('button', { name: 'Connect', exact: true }).click();
        await expect(cloud.getByRole('button', { name: customModel, exact: true })).toBeVisible();
        await expect(settings.getByTestId('privacy-switch')).toBeEnabled();
        await settings.getByTestId('privacy-switch').check();
        await expect(settings.getByText('Allowed to use the online AI', { exact: true })).toBeVisible();
        await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
        await expect(settings).toHaveCount(0);
        const saved = await page.evaluate(() => window.electron.getSettings());
        expect(saved.useCustomLLM).toBe(true);
        expect(saved.customLLM).toMatchObject({ provider: 'custom', model: customModel, apiUrl: runtime.customUrl, enabled: true });
        expect(saved.customLLM?.apiKey || '').toBe('');
      }
      if (provider === 'local') expect((await page.evaluate(() => window.electron.getSettings())).chatModel).toBe('qwen2.5:3b');
      expect(generation).toEqual([]);
      await runtime.setPhase('chat');
      const composer = page.getByRole('textbox', { name: 'Message HomeBot', exact: true });
      const send = page.getByRole('button', { name: 'Send', exact: true });
      async function sendPrompt(prompt: string) {
        await composer.fill(prompt);
        await paintedControl(send);
        await send.click();
      }
      const assistant = page.locator('.message-content .message-bubble');
      await sendPrompt(firstPrompt);
      await expect(assistant.filter({ hasText: firstAnswer })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`${provider}-fragmented-answer.png`) });
      await sendPrompt(contextPrompt);
      await expect(assistant.filter({ hasText: contextAnswer })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toHaveCount(0);
      await sendPrompt(failurePrompt);
      await expect(assistant.filter({ hasText: 'A partial answer arrived before the fixture failure.' })).toBeVisible();
      expect(failureControl.finish).not.toBeNull();
      // Complete the real loopback response only after the production renderer
      // has shown its partial text; no simulated IPC or timing assumption.
      failureControl.finish!();
      const retry = page.getByRole('button', { name: 'Retry', exact: true });
      await paintedControl(retry);
      await page.screenshot({ path: testInfo.outputPath(`${provider}-provider-error.png`) });
      await retry.click();
      await expect(assistant.filter({ hasText: recoveredAnswer })).toBeVisible();
      await expect(retry).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toHaveCount(0);
      await sendPrompt(stopPrompt);
      await expect(assistant.filter({ hasText: 'A quiet meadow continues' })).toBeVisible();
      const stop = page.getByRole('button', { name: 'Stop generating', exact: true });
      await paintedControl(stop);
      await page.screenshot({ path: testInfo.outputPath(`${provider}-stop-control.png`) });
      await stop.click();
      await expect.poll(() => stopClosed).toBe(true);
      await expect(stop).toHaveCount(0);
      await sendPrompt(resumedPrompt);
      await expect(assistant.filter({ hasText: resumedAnswer })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toHaveCount(0);
      if (provider === 'custom') {
        await expect.poll(async () => {
          const store = await page.evaluate(() => window.electron.loadConversations!());
          return store.data?.conversations.find(item => item.id === store.data?.activeConversationId)?.title;
        }).toBe(conversationTitle);
      }
      expect(generation.map(item => item.provider)).toEqual(Array(6).fill(provider));
      expect(generation.map(item => item.body.messages.filter((message: any) => message.role === 'user').at(-1)?.content))
        .toEqual([firstPrompt, contextPrompt, failurePrompt, failurePrompt, stopPrompt, resumedPrompt]);
      expect(serverErrors).toEqual([]);
      expect(titleRequests).toHaveLength(provider === 'custom' ? 1 : 0);
      expect(heartbeatEvents).toBe(provider === 'custom' ? 3 : 0);
      proof = await runtime.evidence();
      expect(proof.requests.filter((request: any) => request.method === 'POST' && request.phase === 'chat'
        && request.path === (provider === 'custom' ? '/v1/chat/completions' : '/api/chat')))
        .toHaveLength(generation.length + titleRequests.length);
      expect(proof.rejected).toEqual([]);
      expect(proof.currentRag).toBe(proof.initialRag);
      expect(proof.transport.rendererDenied).toEqual([]);
      expect(proof.transport.processAttempts.every((attempt: any) => attempt.method === 'execFile' && attempt.command === 'nvidia-smi'
        && JSON.stringify(attempt.args) === JSON.stringify(['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']))).toBe(true);
      expect(proof.transport.denied.every((attempt: any) => {
        if (!attempt.url) return false;
        const url = new URL(attempt.url);
        return (attempt.method === 'POST' && attempt.url === `${runtime.ollamaUrl}/api/generate` && attempt.phase === 'chat')
          || (attempt.method === 'GET' && ((['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '6333' && ['/', '/healthz'].includes(url.pathname))
            || (url.hostname === '127.0.0.1' && url.port === '4' && url.pathname === '/system_stats')));
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${provider}-chat-complete.png`) });
    } catch (error) { failures.push(error); }
    finally {
      if (!proof) { try { proof = await runtime.evidence(); } catch (error) { failures.push(error); } }
      try {
        fs.writeFileSync(testInfo.outputPath('chat-request-proof.json'), JSON.stringify({ provider, generation, titleRequests, heartbeatEvents, stopClosed, serverErrors, proof,
          failures: failures.map(error => describeFailure(error)) }, null, 2));
      } catch (error) { failures.push(error); }
      try {
        const receipt = await runtime.close();
        expect(receipt).toMatchObject({ closeOutcome: 'closed', forced: false, closeError: null, refusal: null,
          nativeProbeSucceeded: true, launcherProbeSucceeded: true, nativeSameIdentityAlive: false,
          launcherSameIdentityAlive: false, safeToCloseServers: true });
      } catch (error) { failures.push(error); }
    }
    if (failures.length) {
      const details = failures.map(error => describeFailure(error));
      fs.writeFileSync(testInfo.outputPath('chat-failures.json'), JSON.stringify(details, null, 2));
      throw new AggregateError(failures, `${provider} production chat acceptance failed: ${failures.map(error => (error as any)?.message || String(error)).join('; ')}`);
    }
  });
}
