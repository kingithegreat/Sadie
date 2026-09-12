import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { launchElectronApp } from './launchElectron';
import { dismissFirstRun } from './helpers/firstRun';

async function checkStudioPalette(page: Page) {
  const colours = await page.evaluate(() => {
    const style = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing reachable surface: ${selector}`);
      return getComputedStyle(element);
    };
    const heading = style('.ms-dcc-branding h2');
    const panel = style('.ms-dcc-bar');
    const luminance = (colour: string) => {
      const values = colour.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const fg = luminance(heading.color);
    const bg = luminance(panel.backgroundColor);
    return {
      contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
      fill: heading.webkitTextFillColor,
      headingImage: heading.backgroundImage,
      chrome: style('.app-header').backgroundColor,
      app: style('.app-container').backgroundColor,
      badges: Array.from(document.querySelectorAll('.ms-dcc-chip')).map(el => getComputedStyle(el).color),
    };
  });
  expect(colours.contrast).toBeGreaterThanOrEqual(4.5);
  expect(colours.fill).not.toBe('rgba(0, 0, 0, 0)');
  expect(colours.headingImage).toBe('none');
  expect(colours.chrome).toBe(colours.app);
  expect(colours.badges.length).toBeGreaterThan(3);
  expect(new Set(colours.badges).size).toBe(1);
}

test('theme remains coherent across reachable chat, settings and Studio', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ui-harmony-'));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, profile);
  try {
    await dismissFirstRun(page);
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('HomeBot'));
      win?.setSize(1280, 900);
    });
    const settings = page.getByRole('button', { name: 'Settings', exact: true }).first();
    await settings.click();
    await expect(page.locator('.settings-panel')).toBeVisible();
    await page.getByRole('button', { name: 'dark theme', exact: true }).click();
    await page.getByRole('button', { name: /^Save( changes)?$/ }).click();
    await expect(page.locator('.settings-panel')).not.toBeVisible();
    await expect(page.locator('[data-testid="homebot-app-root"]')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: testInfo.outputPath('chat-dark.png') });
    await settings.click();
    await page.screenshot({ path: testInfo.outputPath('settings-dark.png') });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Studio', exact: true }).click();
    await expect(page.locator('.media-studio')).toBeVisible();
    await checkStudioPalette(page);
    await page.screenshot({ path: testInfo.outputPath('studio-dark.png') });
    await settings.click();
    await page.getByRole('button', { name: 'light theme', exact: true }).click();
    await page.getByRole('button', { name: /^Save( changes)?$/ }).click();
    await expect(page.locator('[data-testid="homebot-app-root"]')).toHaveAttribute('data-theme', 'light');
    await checkStudioPalette(page);
    await page.screenshot({ path: testInfo.outputPath('studio-light.png') });
    await page.getByRole('button', { name: /Visual Storyboard Deck/ }).click();
    await expect(page.locator('.ms-storyboard-workspace')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('storyboard-light.png') });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('chat-light.png') });
    await page.getByRole('button', { name: 'Collapse to widget', exact: true }).click();
    await expect(page.locator('.app-container')).toHaveClass(/widget-mode/);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(700);
    const composer = page.getByRole('textbox', { name: 'Message HomeBot', exact: true });
    await expect(composer).toBeVisible();
    await composer.fill('A calmer place to create.');
    await expect(composer).toHaveValue('A calmer place to create.');
    const cards = page.locator('.daily-card');
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) {
      const bounds = await card.boundingBox();
      const width = await page.evaluate(() => window.innerWidth);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath('widget-light.png') });
    await settings.click();
    await expect(page.getByRole('button', { name: /^Save( changes)?$/ })).toBeInViewport();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await composer.focus();
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return { tag: element.tagName, outline: style.outlineStyle,
        physicalWidth: parseFloat(style.outlineWidth) * window.devicePixelRatio };
    });
    expect(focus.tag).toBe('BUTTON');
    expect(focus.outline).toBe('solid');
    expect(focus.physicalWidth).toBeGreaterThanOrEqual(2);
  } finally {
    await app.close();
  }
});
