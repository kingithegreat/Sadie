import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * REL-4: Settings → Report a problem writes a local report through the built
 * app, with recent logs, and without the API keys and tokens that the profile
 * and its logs really contain.
 */
test('Report a problem saves a report with logs and without the seeded secrets', async () => {
  const OPENAI = 'sk-proj-' + 'Q1w2E3r4T5y6U7i8O9p0'.repeat(2);
  const GEMINI = 'AIza' + 'SyE2eFakeGeminiKey0000000000000000'.slice(0, 35);
  const BEARER = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlMmUifQ.c2lnbmF0dXJlLWZvci1lMmUtdGVzdHMtb25seQ';

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-e2e-report-'));
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-e2e-reports-out-'));
  fs.mkdirSync(path.join(userData, 'config'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'config', 'user-settings.json'), JSON.stringify({
    openaiApiKey: OPENAI, geminiApiKey: GEMINI, providerApiKeys: { openai: OPENAI }, theme: 'light',
  }));
  fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'logs', 'e2e-seeded.log'), `seeded line one\nAuthorization: Bearer ${BEARER}\nkey was ${GEMINI}\nseeded last line\n`);

  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_PROBLEM_REPORT_DIR: reports }, userData);
  try {
    await waitForAppReady(page);
    await dismissFirstRun(page);
    await page.locator('button[aria-label="Settings"]').click();
    const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('🩺 Report a problem').fill(`The export froze. I had pasted ${OPENAI} somewhere.`);
    await dialog.getByRole('button', { name: 'Create report' }).click();
    await expect(dialog.getByRole('status')).toContainText('homebot-problem-report-', { timeout: 30_000 });

    const files = fs.readdirSync(reports).filter(f => f.startsWith('homebot-problem-report-'));
    expect(files).toHaveLength(1);
    const text = fs.readFileSync(path.join(reports, files[0]!), 'utf8');
    for (const part of ['HomeBot version:', 'Log: e2e-seeded.log', 'seeded last line', 'The export froze.', '"theme": "light"', 'Health checks']) {
      expect(text).toContain(part);
    }
    for (const secret of [OPENAI, GEMINI, BEARER]) expect(text).not.toContain(secret);
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(reports, { recursive: true, force: true });
  }
});
