import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test('SADIE can summarise a document', async ({ }, testInfo) => {
  testInfo.setTimeout(180000); // Electron + file ops can be slow

  // Launch Electron
  const app = await electron.launch({
    args: ['.'], // adjust if your app path differs
  });

  const page = await app.firstWindow();
  await expect(page).toBeTruthy();

  // Ensure app UI is ready
  await page.waitForLoadState('domcontentloaded');

  // Give UI time to fully settle
  await page.waitForTimeout(2000);

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

  // Wait up to 30s for chat input to be attached to DOM
  await page.waitForSelector('[data-testid="chat-input"]', {
    state: 'attached',
    timeout: 30000
  });

  // Wait for it to be visible / enabled
  await page.waitForSelector('[data-testid="chat-input"]', {
    state: 'visible',
    timeout: 30000
  });

  // Wait for file input to exist (even if hidden)
  await page.waitForSelector('input[type="file"]', { state: 'attached' });

  const filePath = path.resolve('e2e/assets/sample.docx');

  // Inject file directly into hidden input
  await page.setInputFiles('input[type="file"]', filePath);

  // Issue the request
  await page.fill('textarea.input-field', 'report this doc');
  await page.keyboard.press('Enter');

  // Wait for summary to appear
  await page.waitForSelector('text=Summary', { timeout: 30000 });

  const output = await page.innerText('[data-testid="assistant-output"]');
  expect(output.length).toBeGreaterThan(50);

  await app.close();
});
