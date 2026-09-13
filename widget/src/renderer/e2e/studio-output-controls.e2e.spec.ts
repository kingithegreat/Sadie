import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createStudioOutputSpec } from '../../shared/media-output';
import { launchFocusedStudioApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('job output controls remain usable while image setup is open', async ({}, testInfo) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-output-layout-'));
  const title = 'Output controls layout';
  fs.writeFileSync(path.join(profile, 'media-jobs.json'), JSON.stringify([{
    id: 'output-layout', title, format: 'short', state: 'media_production',
    narrationPath: path.join(profile, 'narration.wav'),
    outputSpec: createStudioOutputSpec('16:9', 'short', '720p'),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
  }]));
  const { app, page } = await launchFocusedStudioApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, profile);
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('button', { name: 'Make the video', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Choose where images are made' })).toBeVisible();
    const measurements = await page.locator('[data-job-id="output-layout"]').evaluate(card => ({
      cardWidth: card.getBoundingClientRect().width,
      columns: getComputedStyle(card).gridTemplateColumns,
      fields: [...card.querySelectorAll('fieldset, select, .ms-job-actions')].map(element => ({
        name: element.getAttribute('aria-label') || element.className,
        width: element.getBoundingClientRect().width,
      })),
    }));
    fs.writeFileSync(testInfo.outputPath('layout.json'), JSON.stringify(measurements, null, 2));
    await page.screenshot({ path: testInfo.outputPath('setup-open.png'), animations: 'disabled' });
    expect(measurements.fields.find(field => field.name === `${title} output settings`)!.width).toBeGreaterThan(400);
    for (const field of measurements.fields.filter(field => /selection|resolution|framing|shape/.test(field.name))) expect(field.width).toBeGreaterThan(120);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Choose where images are made' })).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(path.join(profile, 'media-jobs.json'), 'utf8'))[0].latestExportAttempt).toBeUndefined();
  } finally { await app.close(); }
});
