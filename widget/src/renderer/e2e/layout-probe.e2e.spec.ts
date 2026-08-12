/**
 * Layout probe — where does the vertical space actually go?
 *
 * Screenshots said "something is too tall"; only a measurement says WHICH
 * element. Written after I mis-read a DPI-scaled screenshot and reported the
 * chrome as ~920px when it is 196px in chat.
 *
 * Reports every child of .app-header in both chat and a non-chat mode, because
 * the header measures 134px in chat and 451px in Studio and the difference has
 * to be one of its children.
 *
 * Diagnostic, not an assertion — run it when the layout looks wrong.
 */

import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-probe-${Date.now()}`);
  fs.mkdirSync(path.join(base, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(base, 'config', 'user-settings.json'),
    JSON.stringify({ firstRun: false, telemetryEnabled: false, theme: 'dark' }, null, 2),
    'utf-8',
  );
  return base;
}

/** Measure the header and each of its children, in whatever mode is active. */
const MEASURE = `(() => {
  const out = [];
  const box = (label, el) => {
    if (!el) { out.push(label.padEnd(30) + ' (absent)'); return; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out.push(
      label.padEnd(30) +
      ' y=' + String(Math.round(r.top)).padStart(4) +
      ' h=' + String(Math.round(r.height)).padStart(4) +
      ' flex=' + cs.flex +
      ' display=' + cs.display +
      ' gap=' + cs.gap
    );
  };
  const app = document.querySelector('.app-container');
  box('.app-container', app);
  if (app) {
    Array.from(app.children).forEach((c, i) => {
      const cls = (c.className || '').toString().split(' ')[0].slice(0, 22);
      box('  top[' + i + '] ' + (cls || c.tagName.toLowerCase()), c);
    });
  }
  const header = document.querySelector('.app-header');
  box('.app-header', header);
  if (header) {
    Array.from(header.children).forEach((c, i) => {
      const cls = (c.className || '').toString().split(' ')[0].slice(0, 20);
      box('  child[' + i + '] ' + (cls || c.tagName.toLowerCase()), c);
    });
  }
  return out.join('\\n');
})()`;

test('what makes the header tall outside chat', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchElectronApp(
    { HOMEBOT_E2E: '1', NODE_ENV: 'test' }, makeTempProfile(),
  );
  await waitForAppReady(page);

  const chat = await page.evaluate(MEASURE);
  // eslint-disable-next-line no-console
  console.log('\n===== CHAT =====\n' + chat);

  await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
  await page.waitForTimeout(1200);
  const studio = await page.evaluate(MEASURE);
  // eslint-disable-next-line no-console
  console.log('\n===== STUDIO =====\n' + studio + '\n=====\n');

  await app.close();
});
