/**
 * Media Studio panel — drive it and capture what it actually says.
 *
 * This is the debugging loop that found three defects today which 2,689 unit
 * tests could not: run the real app, click the real buttons, and record the
 * renderer console, page errors and failed IPC calls. A unit test asserts a
 * function returns; it cannot see a React error, a missing preload method, or
 * a button that does nothing.
 *
 * Deliberately does NOT run the model or TTS stages — those need Ollama and
 * network and take a minute each. It exercises the panel's own behaviour:
 * create, render, act, report.
 *
 *   npx playwright test media-panel-debug
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

const OUT = path.resolve(__dirname, '../../../test-results/visual');

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-media-debug-${Date.now()}`);
  fs.mkdirSync(path.join(base, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(base, 'config', 'user-settings.json'),
    JSON.stringify({ firstRun: false, telemetryEnabled: false, theme: 'dark' }, null, 2),
    'utf-8',
  );
  return base;
}

test('the Studio panel does what its buttons say', async () => {
  test.setTimeout(180_000);
  fs.mkdirSync(OUT, { recursive: true });

  const { app, page } = await launchElectronApp(
    { HOMEBOT_E2E: '1', NODE_ENV: 'test' }, makeTempProfile(),
  );

  // The three channels a unit test cannot see.
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  await waitForAppReady(page);
  await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
  await page.waitForTimeout(800);

  // 1. Does the preload actually expose what the panel calls? A missing method
  //    is silently undefined — the optional-chaining call just does nothing.
  const api = await page.evaluate(() => {
    const e = (window as any).electron || {};
    return ['mediaList', 'mediaCreate', 'mediaAdvance', 'mediaRun', 'mediaApprove', 'mediaReject']
      .map(k => `${k}=${typeof e[k]}`).join(' ');
  });
  console.log('\npreload surface:', api);
  expect(api).not.toContain('undefined');

  // 2. Create a video and confirm it appears.
  await page.locator('.ms-input').fill('Debug: One-Minute Bible');
  await page.locator('.ms-btn--primary', { hasText: 'Add video' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'media-1-created.png') });

  const rows = await page.locator('.ms-job').count();
  console.log('rows after create:', rows);
  expect(rows).toBeGreaterThan(0);

  // 3. The row must offer the stage that does real work, not only a state hop.
  const actions = await page.locator('.ms-job .ms-job-actions').first().innerText();
  console.log('row actions:', JSON.stringify(actions));
  expect(actions).toMatch(/Write script/i);

  // 4. Pressing it must show a working state rather than appearing dead. The
  //    stage will fail without a model configured — that is fine and is the
  //    point: it must report the failure, not sit silent.
  await page.locator('.ms-job .ms-btn', { hasText: 'Write script' }).click();
  await page.waitForTimeout(400);
  const working = await page.locator('.ms-working').count();
  console.log('working indicator visible:', working > 0);
  await page.screenshot({ path: path.join(OUT, 'media-2-working.png') });

  // Let it settle, then capture whatever it reported.
  await page.waitForTimeout(20_000);
  const outcome = await page.evaluate(() => ({
    error: document.querySelector('.ms-error')?.textContent ?? null,
    done: document.querySelector('.ms-done')?.textContent ?? null,
    state: document.querySelector('.ms-state')?.textContent ?? null,
  }));
  console.log('outcome:', JSON.stringify(outcome, null, 2));
  await page.screenshot({ path: path.join(OUT, 'media-3-outcome.png') });

  console.log('\nconsole errors:', consoleErrors.length ? consoleErrors.slice(0, 8) : 'none');
  console.log('page errors   :', pageErrors.length ? pageErrors : 'none');

  // A React crash in the panel is never acceptable, whatever the stage did.
  expect(pageErrors).toEqual([]);

  await app.close();
});
