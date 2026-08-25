import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Tooltips, checked in a real browser.
 *
 * The unit tests (tooltip.test.tsx) cover behaviour — focus, Escape, ARIA — and
 * they all passed while the tooltip was INVISIBLE in the running app. jsdom does
 * no layout and paints nothing, so it cannot see that .app-header and
 * .mode-switcher clip with overflow:hidden/auto, and that nothing absolutely
 * positioned escapes that however high its z-index goes.
 *
 * That is what this file is for: the part only a real renderer can answer.
 */

async function open(userDataPrefix: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), userDataPrefix));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
  await waitForAppReady(page);
  await dismissFirstRun(page);
  return { app, page };
}

test('a tooltip is actually visible, not merely in the DOM', async () => {
  const { app, page } = await open('homebot-tt-vis-');

  const chat = page.locator('.mode-btn', { hasText: 'Chat' }).first();
  await chat.hover();
  await page.waitForTimeout(700); // past the 350ms hover delay

  const tip = page.getByRole('tooltip').first();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(/Talk to the AI/);

  // The actual regression: no ancestor may clip it. Playwright's toBeVisible()
  // does NOT account for overflow clipping, so it has to be asserted directly.
  const clippers = await tip.evaluate((el) => {
    const out: string[] = [];
    let p = el.parentElement;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        out.push(`${p.className || p.tagName} overflow=${s.overflow}`);
      }
      p = p.parentElement;
    }
    return out;
  });
  expect(clippers).toEqual([]);

  // And it must be on screen.
  const box = (await tip.boundingBox())!;
  const vp = page.viewportSize() ?? { width: 1280, height: 800 };
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);

  await app.close();
});

test('keyboard focus alone shows help on an icon-only control', async () => {
  const { app, page } = await open('homebot-tt-kbd-');

  // The attach buttons' entire visible label is an emoji. This is the case a
  // native `title` cannot serve at all.
  // Named on purpose: ".attach-button" first() would land on the prompt-improve
  // button, which is disabled while the textarea is empty — and a disabled
  // control cannot take focus at all, so this test would see no tooltip.
  const attach = page.getByRole('button', { name: 'Attach images to this message' });
  await attach.evaluate((el: HTMLElement) => el.focus());
  await page.waitForTimeout(250); // focus is deliberately delay-free

  const tip = page.getByRole('tooltip').first();
  await expect(tip).toBeVisible();

  // Escape dismisses without taking focus off the control.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect(await attach.evaluate((el) => el === document.activeElement)).toBe(true);

  await app.close();
});
