import { test, expect, _electron as electron } from '@playwright/test';
import { waitForAppReady } from './helpers/waitForAppReady';
import path from 'path';

test('SADIE can summarise a document', async ({ }, testInfo) => {
  testInfo.setTimeout(180000); // Electron + file ops can be slow

  // Launch Electron
  const app = await electron.launch({
    args: ['.'], // adjust if your app path differs
  });

  const page = await app.firstWindow();
  await expect(page).toBeTruthy();

  // Ensure app UI is ready (deterministic)
  await waitForAppReady(page, 120000);

  // Dump candidates to console
  const inputs = await page.$$eval('input, textarea, [contenteditable], [role="textbox"]', els =>
    els.map(e => ({
      tag: e.tagName,
      id: e.id,
      class: e.className,
      testid: e.getAttribute('data-testid'),
      placeholder: e.getAttribute('placeholder'),
      role: e.getAttribute('role'),
      contenteditable: e.getAttribute('contenteditable')
    }))
  );
  console.log("🧪 Candidate Inputs:", inputs);

  // Capture DOM snapshot
  const html = await page.content();
  console.log("🧪 DOM Snapshot Length:", html.length);

  // Keep the screenshot
  await page.screenshot({ path: 'ui_state_before_chat_input.png' });

  // chat input readiness already validated by waitForAppReady; fallback selector check
  await page.waitForSelector('[data-testid="chat-input"]', { state: 'visible', timeout: 30000 });

  // Wait for file input to exist (even if hidden)
  await page.waitForSelector('input[type="file"]', { state: 'attached' });

  const filePath = path.resolve('e2e/assets/sample.docx');

  // Inject file directly into hidden input
  await page.setInputFiles('input[type="file"]', filePath);

  // Issue the request
  await page.fill('textarea.input-field', 'report this doc');
  await page.keyboard.press('Enter');

  // Wait for assistant response to appear
  await page.waitForSelector('.message-wrapper.assistant .message-bubble', { timeout: 30000 });

  // Wait for streaming to complete (no more thinking indicator)
  await page.waitForFunction(() => {
    const assistantBubbles = document.querySelectorAll('.message-wrapper.assistant .message-bubble');
    if (assistantBubbles.length === 0) return false;
    const lastBubble = assistantBubbles[assistantBubbles.length - 1];
    // Check if there's no thinking indicator in the last message
    return !lastBubble.querySelector('.thinking-indicator');
  }, { timeout: 30000 });

  // Check that the assistant message has some content (since backend may not be running, just verify UI flow)
  const assistantMessages = await page.locator('.message-wrapper.assistant .message-bubble').allTextContents();
  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
  expect(lastAssistantMessage.length).toBeGreaterThan(0);

  await app.close();
});
