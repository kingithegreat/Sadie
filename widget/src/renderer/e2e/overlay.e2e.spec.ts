import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Floating overlays must actually float.
 *
 * Three separate overlays in this app were shipped broken in the same way, and
 * every unit test for them passed the whole time. jsdom does no layout, so it
 * cannot see that:
 *
 *   - .app-header, .chat-interface and .messages-container clip with
 *     overflow:hidden/auto;
 *   - .app-header and .chat-interface set `container-type: inline-size` and
 *     `backdrop-filter`, EITHER of which makes them the containing block for
 *     `position: fixed` descendants — so `position: fixed` alone does not
 *     escape them;
 *   - `.app-container > *:not(...)` forces `position: relative; z-index: 1` at
 *     specificity (0,9,0), which beats an overlay's own `position: fixed` and
 *     lays it out as a grid row. The context menu was rendering 1202px wide,
 *     117px from the click.
 *
 * The only reliable escape is leaving the tree: portal to document.body. These
 * tests assert that outcome against the real renderer.
 */

async function open(prefix: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
  await waitForAppReady(page);
  const skip = page.getByRole('button', { name: /Skip setup/i });
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(400);
  }
  return { app, page };
}


test('right-click menu lands at the cursor and is not laid out as a page row', async () => {
  const { app, page } = await open('homebot-e2e-ctx-');

  const burger = page.locator('.menu-btn, [aria-label*="menu" i]').first();
  if (await burger.count()) {
    await burger.click();
    await page.waitForTimeout(500);
  }

  const item = page.locator('.conversation-item, .conv-item, .sidebar li').first();
  test.skip(!(await item.count()), 'no conversation to right-click in this profile');

  const box = (await item.boundingBox())!;
  await item.click({ button: 'right' });
  await page.waitForTimeout(300);

  const menu = page.locator('.context-menu').first();
  await expect(menu).toBeVisible();

  const info = await menu.evaluate((el) => ({
    portalled: el.parentElement === document.body,
    position: getComputedStyle(el).position,
    width: Math.round(el.getBoundingClientRect().width),
    clippedBy: (() => { const out: string[] = []; let p = el.parentElement; while (p && p !== document.body) { const s = getComputedStyle(p); if (s.overflow !== "visible" || s.overflowX !== "visible" || s.overflowY !== "visible") out.push(p.className || p.tagName); p = p.parentElement; } return out; })(),
    viewportWidth: window.innerWidth,
  }));

  // Out of .app-container, so the blanket `position: relative` rule cannot match.
  expect(info.portalled).toBe(true);
  expect(info.position).toBe('fixed');
  expect(info.clippedBy).toEqual([]);
  // A menu that got captured as a grid row stretches the full container width.
  // 180px is its min-width; anything near the viewport width means it is back
  // in the layout flow.
  expect(info.width).toBeLessThan(info.viewportWidth / 2);

  // And it appears near where the user actually clicked.
  const rect = (await menu.boundingBox())!;
  expect(Math.abs(rect.x - (box.x + box.width / 2))).toBeLessThan(80);

  await app.close();
});

test('no open overlay is trapped inside a clipping container', async () => {
  const { app, page } = await open('homebot-e2e-ovl-');
  await page.addInitScript(() => {});

  // Tooltip is the overlay reachable without app state, and it exercises the
  // shared useAnchoredPosition/OverlayPortal path that the popover, the
  // reaction picker and the context menu all now use.
  const chat = page.locator('.mode-btn', { hasText: 'Chat' }).first();
  await chat.hover();
  await page.waitForTimeout(700);

  const trapped = await page.evaluate(() => {
    const clippers = (el: Element) => {
      const out: string[] = [];
      let p = el.parentElement;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible')
          out.push(`${p.className || p.tagName}`);
        p = p.parentElement;
      }
      return out;
    };
    const sel = '[role="tooltip"], .context-menu, .backend-popover, .reaction-picker, .model-dropdown';
    return Array.from(document.querySelectorAll(sel))
      .map((el) => ({ what: el.className || el.getAttribute('role'), clippedBy: clippers(el) }))
      .filter((r) => r.clippedBy.length > 0);
  });

  expect(trapped).toEqual([]);
  await app.close();
});
