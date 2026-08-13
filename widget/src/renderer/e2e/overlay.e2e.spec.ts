import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
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
  await dismissFirstRun(page);
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

test('a toast floats in the corner and does not push the page down', async () => {
  const { app, page } = await open('homebot-e2e-toast-');

  const headerBefore = Math.round((await page.locator('.app-header').boundingBox())!.y);

  // Fired from the MAIN process, so this travels the real IPC path into real
  // React state — not an element injected into the DOM.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(
      'homebot:model-fallback', { from: 'llama3', to: 'phi3' }
    );
  });
  await page.waitForTimeout(800);

  const toast = page.locator('.toast-container');
  await expect(toast).toBeVisible();

  const info = await toast.evaluate((el) => ({
    portalled: el.parentElement === document.body,
    position: getComputedStyle(el).position,
    right: Math.round(el.getBoundingClientRect().right),
    top: Math.round(el.getBoundingClientRect().top),
    viewportWidth: window.innerWidth,
    headerTop: Math.round(document.querySelector('.app-header')!.getBoundingClientRect().top),
  }));

  // Out of .app-container, so the (0,10,0) blanket rule cannot force it back
  // into flow — which is what beat the old `.app-container > .toast-container`
  // override and made every toast shift the UI down by its own height.
  expect(info.portalled).toBe(true);
  expect(info.position).toBe('fixed');
  // Pinned to the top-right, 16px in.
  expect(info.viewportWidth - info.right).toBeLessThan(24);
  expect(info.top).toBeLessThan(24);
  // The point of the whole thing: the page must not move.
  expect(info.headerTop).toBe(headerBefore);

  await app.close();
});

/**
 * The full-window panels. Each of these is authored as `position: fixed` and
 * each was being laid out as a page row instead, because the blanket
 * `.app-container > *:not(...)` rule is (0,10,0) and their own rule is (0,1,0).
 *
 * .settings-overlay is in that rule's :not() list and so was always correct —
 * it is included here deliberately as the control case. The rule is a blocklist:
 * it works for the handful of overlays someone remembered to name and silently
 * captures every one they did not.
 */
const PANELS = [
  { label: 'Workspace', sel: '.workspace-shell' },
  { label: 'Analytics', sel: '.td-overlay' },
  { label: 'Notifications', sel: '.notification-history-overlay' },
];

for (const p of PANELS) {
  test(`${p.label} opens as a real overlay and closes with Escape`, async () => {
    const { app, page } = await open(`homebot-e2e-${p.label.toLowerCase()}-`);

    const headerBefore = Math.round((await page.locator('.app-header').boundingBox())!.y);

    const btn = page.locator(`[aria-label="${p.label}"]`).first();
    await expect(btn).toBeVisible();
    await btn.click();
    await page.waitForTimeout(500);

    const panel = page.locator(p.sel).first();
    await expect(panel).toBeVisible();

    const info = await panel.evaluate((el) => ({
      portalled: el.parentElement === document.body,
      position: getComputedStyle(el).position,
      rect: el.getBoundingClientRect().toJSON(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      headerTop: Math.round(document.querySelector('.app-header')!.getBoundingClientRect().top),
    }));

    expect(info.portalled).toBe(true);
    expect(info.position).toBe('fixed');
    // It must actually cover the window, not sit in a row of it.
    expect(Math.round(info.rect.width)).toBe(info.viewport.w);
    expect(Math.round(info.rect.height)).toBe(info.viewport.h);
    expect(Math.round(info.rect.top)).toBe(0);
    // ...and opening it must not move the page underneath.
    expect(info.headerTop).toBe(headerBefore);

    // A panel that fills the window must have an exit that is not one specific
    // button. Analytics had only a Close button, which was survivable while it
    // was an inert page row and became a trap once it genuinely covered things.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page.locator(p.sel)).toHaveCount(0);

    await app.close();
  });
}

/**
 * The two overlays reachable only by keyboard or by IPC. Both are direct
 * children of .app-container — Suspense and ErrorBoundary render no DOM node of
 * their own, so nesting inside them does not change that — and both were
 * therefore captured by the blanket rule.
 *
 * The permission modal is the one that matters most here: it is the security
 * prompt asking whether HomeBot may touch your files, and a prompt laid out as
 * a page row rather than a modal is a prompt people answer without reading.
 */
test('the keyboard shortcuts panel covers the window', async () => {
  const { app, page } = await open('homebot-e2e-shortcuts-');
  const headerBefore = Math.round((await page.locator('.app-header').boundingBox())!.y);

  await page.keyboard.press('Control+/');
  await page.waitForTimeout(500);

  const panel = page.locator('.shortcuts-overlay').first();
  await expect(panel).toBeVisible();
  const info = await panel.evaluate((el) => ({
    portalled: el.parentElement === document.body,
    position: getComputedStyle(el).position,
    w: Math.round(el.getBoundingClientRect().width),
    vw: window.innerWidth,
    headerTop: Math.round(document.querySelector('.app-header')!.getBoundingClientRect().top),
  }));
  expect(info.portalled).toBe(true);
  expect(info.position).toBe('fixed');
  expect(info.w).toBe(info.vw);
  expect(info.headerTop).toBe(headerBefore);

  await app.close();
});

test('the permission prompt renders as a modal, not a page row', async () => {
  const { app, page } = await open('homebot-e2e-perm-');
  const headerBefore = Math.round((await page.locator('.app-header').boundingBox())!.y);

  // Real IPC from the main process, through the real preload bridge.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('homebot:permission-request', {
      requestId: 'e2e-1',
      missingPermissions: ['files.write'],
      reason: 'Save a report to your Documents folder',
    });
  });
  await page.waitForTimeout(700);

  const modal = page.locator('.hb-modal-overlay').first();
  await expect(modal).toBeVisible();
  const info = await modal.evaluate((el) => ({
    portalled: el.parentElement === document.body,
    position: getComputedStyle(el).position,
    w: Math.round(el.getBoundingClientRect().width),
    h: Math.round(el.getBoundingClientRect().height),
    vw: window.innerWidth,
    vh: window.innerHeight,
    headerTop: Math.round(document.querySelector('.app-header')!.getBoundingClientRect().top),
  }));
  expect(info.portalled).toBe(true);
  expect(info.position).toBe('fixed');
  expect(info.w).toBe(info.vw);
  expect(info.h).toBe(info.vh);
  expect(info.headerTop).toBe(headerBefore);

  await app.close();
});

test('conversation search replaces the sidebar without falling into the page flow', async () => {
  const { app, page } = await open('homebot-e2e-search-');
  const headerBefore = Math.round((await page.locator('.app-header').boundingBox())!.y);

  const burger = page.locator('.menu-btn, [aria-label*="menu" i]').first();
  await burger.click();
  await page.waitForTimeout(500);

  // The sidebar swaps its own root for this panel, which is how the panel lost
  // the `.conversation-sidebar` exemption in the blanket rule's :not() list.
  const searchBtn = page.locator('[aria-label*="search" i], .search-btn, .sidebar-search').first();
  test.skip(!(await searchBtn.count()), 'no search trigger in the sidebar');
  await searchBtn.click();
  await page.waitForTimeout(500);

  const panel = page.locator('.conversation-search-overlay').first();
  await expect(panel).toBeVisible();
  const info = await panel.evaluate((el) => ({
    portalled: el.parentElement === document.body,
    position: getComputedStyle(el).position,
    w: Math.round(el.getBoundingClientRect().width),
    vw: window.innerWidth,
    headerTop: Math.round(document.querySelector('.app-header')!.getBoundingClientRect().top),
  }));
  expect(info.portalled).toBe(true);
  expect(info.position).toBe('fixed');
  expect(info.headerTop).toBe(headerBefore);

  // Escape returns to the conversation list — a search box without Escape is
  // the least expected thing in the app.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await expect(page.locator('.conversation-search-overlay')).toHaveCount(0);

  await app.close();
});
