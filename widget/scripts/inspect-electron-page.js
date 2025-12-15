const path = require('path');
const { _electron: electron } = require('playwright');

(async () => {
  const env = { ...process.env };
  env.SADIE_E2E = env.SADIE_E2E || '1';
  env.SADIE_DIRECT_OLLAMA = env.SADIE_DIRECT_OLLAMA || '1';
  env.NODE_ENV = 'test';

  const args = [path.join(__dirname, '../dist/main/index.js')];
  const app = await electron.launch({ args, env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const windows = await app.windows();
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    try {
      const title = await w.title();
      const content = await w.content();
      console.log(`--- WINDOW ${i} TITLE: ${title} ---`);
      console.log(content.substring(0, 800));
      console.log('--- END WINDOW ---');
      const hasInput = await w.$('label:has-text("Message SADIE")');
      console.log('Has Message input label:', !!hasInput);
      const hasFirstRun = await w.$('label:has-text("Telemetry")');
      console.log('Has first-run telemetry label:', !!hasFirstRun);
      const finishBtn = await w.$('button:has-text("Finish")');
      console.log('Has Finish button:', !!finishBtn);
    } catch (e) {
      console.log('Error reading window', i, e?.message || e);
    }
  }

  await app.close();
})();
