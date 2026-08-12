/**
 * Layout probe — where does the vertical space actually go?
 *
 * Screenshots showed mode content starting ~920px down a ~975px window, but a
 * screenshot cannot say WHICH element is tall. This reports the measured box
 * of every top-level chrome element so the answer is a number, not a guess.
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

test('where the vertical space goes', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchElectronApp(
    { HOMEBOT_E2E: '1', NODE_ENV: 'test' }, makeTempProfile(),
  );
  await waitForAppReady(page);

  // Measure in Studio mode too — that is where the chrome looked worst.
  await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
  await page.waitForTimeout(1200);

  const report = await page.evaluate(() => {
    const out: string[] = [];
    out.push(`window: ${window.innerWidth} x ${window.innerHeight}`);

    // Walk the top of the tree: anything tall and near the top is the suspect.
    const seen = new Set<Element>();
    const note = (label: string, el: Element | null) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out.push(
        `${label.padEnd(24)} y=${Math.round(r.top).toString().padStart(4)} ` +
        `h=${Math.round(r.height).toString().padStart(4)} ` +
        `pad=${cs.paddingTop}/${cs.paddingBottom} margin=${cs.marginTop}/${cs.marginBottom} ` +
        `minH=${cs.minHeight} flex=${cs.flex}`,
      );
    };

    note('body', document.body);
    note('#root', document.getElementById('root'));

    const root = document.getElementById('root');
    if (root) {
      Array.from(root.children).forEach((c, i) =>
        note(`root>child[${i}] ${c.className.toString().slice(0, 18)}`, c));
      const first = root.firstElementChild;
      if (first) {
        Array.from(first.children).forEach((c, i) =>
          note(`  L2[${i}] ${c.className.toString().slice(0, 18)}`, c));
      }
    }

    for (const sel of ['.app-header', 'header', '.mode-switcher', '.toolbar', '.chat-container', '.media-studio']) {
      document.querySelectorAll(sel).forEach(el => note(sel, el));
    }
    return out.join('\n');
  });

  // eslint-disable-next-line no-console
  console.log('\n===== LAYOUT =====\n' + report + '\n==================\n');
  await app.close();
});
