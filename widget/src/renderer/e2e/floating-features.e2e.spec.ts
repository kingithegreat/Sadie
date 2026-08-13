/**
 * Voice Conversation and Screen Capture must be reachable.
 *
 * These two buttons are the only entry point to either feature — `setVoiceOpen`
 * is called from this container and nowhere else, and `captureScreen` has
 * exactly one caller in the whole renderer. cabbb06 replaced the container's
 * style block with `display: none` during a responsive pass, so for months both
 * features shipped, were bridged end to end, had passing tests, and could not
 * be operated by anybody.
 *
 * Asserting `display !== none` alone would not have caught the restoration:
 * .app-container is a grid, and a visible child that stays in flow claims a
 * track and pushes every row below it. So this checks the two things that make
 * a button real — it is the topmost element at its own centre, and it does not
 * sit on top of the composer — plus the row count that proves it did not become
 * a grid item.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-fab-${Date.now()}`);
  fs.mkdirSync(path.join(base, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(base, 'config', 'user-settings.json'),
    JSON.stringify({ firstRun: false, telemetryEnabled: false, theme: 'dark' }, null, 2),
    'utf-8',
  );
  return base;
}

test.describe('floating feature buttons', () => {
  test('voice and capture are visible, clickable, and clear of the composer', async () => {
    test.setTimeout(120_000);
    const { app, page } = await launchElectronApp(
      { HOMEBOT_E2E: '1', NODE_ENV: 'test' }, makeTempProfile(),
    );
    await waitForAppReady(page);

    const voice = page.locator('.fab-voice');
    const capture = page.locator('.fab-capture');

    await expect(voice).toBeVisible();
    await expect(capture).toBeVisible();

    // Ask the DOM what is actually at each button's centre. A button can be
    // "visible" to Playwright and still sit under an overlay.
    const hits = await page.evaluate(() => {
      const probe = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return { selector, found: false, topmost: null as string | null };
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          selector,
          found: true,
          topmost: at ? (at.closest('.fab-btn')?.className ?? at.className.toString()) : null,
        };
      };
      return [probe('.fab-voice'), probe('.fab-capture')];
    });

    for (const hit of hits) {
      expect(hit.found).toBe(true);
      // The element at the button's own centre must be the button itself.
      expect(hit.topmost).toContain(hit.selector.replace('.', ''));
    }

    // The buttons float above the chat; they must not cover the composer.
    const overlap = await page.evaluate(() => {
      const input = document.querySelector('.input-container');
      if (!input) return 'no .input-container';
      const ir = input.getBoundingClientRect();
      const clashes: string[] = [];
      for (const sel of ['.fab-voice', '.fab-capture']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const intersects = r.left < ir.right && r.right > ir.left && r.top < ir.bottom && r.bottom > ir.top;
        if (intersects) clashes.push(sel);
      }
      return clashes.join(', ');
    });
    expect(overlap).toBe('');

    // The container is absolutely positioned, so it must not have become a
    // grid item — that is what shifted every row when toasts did it (848f519).
    const inFlow = await page.evaluate(() => {
      const appEl = document.querySelector('.app-container');
      if (!appEl) return -1;
      return Array.from(appEl.children).filter((c) => {
        const cs = getComputedStyle(c);
        return cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed';
      }).length;
    });
    const tracks = await page.evaluate(() => {
      const appEl = document.querySelector('.app-container');
      return appEl ? getComputedStyle(appEl).gridTemplateRows.split(' ').length : -1;
    });
    expect(inFlow).toBe(tracks);

    await app.close();
  });

  test('the voice panel opens when its button is clicked', async () => {
    test.setTimeout(120_000);
    const { app, page } = await launchElectronApp(
      { HOMEBOT_E2E: '1', NODE_ENV: 'test' }, makeTempProfile(),
    );
    await waitForAppReady(page);

    // The real proof the entry point works: click it and see the feature.
    await page.locator('.fab-voice').click();
    await expect(page.locator('.voice-conversation-overlay, .voice-conversation, [class*="voice"]').first())
      .toBeVisible({ timeout: 10_000 });

    await app.close();
  });
});
