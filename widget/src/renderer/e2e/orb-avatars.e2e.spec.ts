import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { dismissFirstRun } from './helpers/firstRun';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The orb avatars and the atmosphere layer must actually composite.
 *
 * jsdom cannot see any of this: it does no layout and applies no CSS. The orb
 * pass shipped CSS that reads correctly in the file — but so did the quiet
 * glyphs and the 13 captured overlays, all of which shipped visually broken
 * while their tests were green. These probes assert the computed styles in the
 * real renderer:
 *
 *   - both avatars are true circles (border-radius 50% wins the specificity
 *     fight — the assistant rule at (0,2,0) previously beat the base (0,1,0)
 *     rule and left the orb a rounded square);
 *   - the decorative pseudo-elements exist (::before sweep, ::after specular);
 *   - the glyph svg rides above them (z-index 3);
 *   - the grain overlay is below every functional overlay (8000 < 9000/9998/9999).
 */

async function open(prefix: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
  await dismissFirstRun(page);
  return { app, page, tmp };
}

async function mountBothAvatars(page: any) {
  // Send a message so both avatar roles mount in the DOM.
  const composer = page.locator('textarea[aria-label="Message HomeBot"]').first();
  await composer.fill('Hello');
  await composer.press('Enter');
  // The user avatar mounts immediately; the assistant reply may take longer,
  // but the assistant avatar div renders with the message shell, not the reply.
  await expect(page.locator('.message-avatar.user')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.message-avatar.assistant').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('orb avatars and atmosphere — real renderer', () => {
  test('assistant and user avatars are true circles with decorative layers', async () => {
    const { app, page, tmp } = await open('homebot-orb-');
    try {
      await mountBothAvatars(page);

      for (const selector of ['.message-avatar.assistant', '.message-avatar.user']) {
        const avatar = page.locator(selector).first();

        // The circle: this is what the rounded-square bug broke.
        const radius = await avatar.evaluate((el: Element) => getComputedStyle(el).borderRadius);
        const isCircle = radius === '50%' ||
          (radius.endsWith('%') && parseFloat(radius) >= 49) ||
          // A large fixed radius on a 32px box also reads as a circle.
          parseFloat(radius) >= 14;
        expect(isCircle, `border-radius ${radius} is not a circle`).toBe(true);

        // Overflow hidden so the sweep clips to the ball.
        const overflow = await avatar.evaluate((el: Element) => getComputedStyle(el).overflow);
        expect(overflow).toBe('hidden');

        // The glyph rides above the decorative layers.
        const svgZ = await avatar.evaluate((el: Element) => {
          const svg = el.querySelector('svg');
          return svg ? getComputedStyle(svg).zIndex : null;
        });
        expect(svgZ).toBe('3');

        // The conic sweep exists as a background on ::before.
        const sweepBg = await avatar.evaluate((el: Element) => {
          const before = getComputedStyle(el, '::before');
          return { content: before.content, bg: before.backgroundImage };
        });
        expect(sweepBg.content).toContain('""');
        expect(sweepBg.bg).toContain('conic-gradient');
      }

      // The specular highlight and halo ring on the assistant's ::after.
      const specular = await page
        .locator('.message-avatar.assistant')
        .first()
        .evaluate((el: Element) => {
          const after = getComputedStyle(el, '::after');
          return { pos: after.position, radius: after.borderRadius, shadow: after.boxShadow };
        });
      expect(specular.pos).toBe('absolute');
      expect(specular.radius).toContain('%');
      expect(specular.shadow).toContain('inset');
    } finally {
      await app.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('grain overlay sits below functional overlays', async () => {
    const { app, page, tmp } = await open('homebot-grain-');
    try {
      const grainZ = await page.evaluate(() => {
        const el = document.querySelector('.app-container');
        if (!el) return null;
        const after = getComputedStyle(el, '::after');
        return { content: after.content, z: parseInt(after.zIndex, 10) };
      });

      expect(grainZ).not.toBeNull();
      expect(grainZ!.content).toContain('""');
      // Below shortcuts-overlay (9999), notification-history (9998), settings (9000).
      expect(grainZ!.z).toBeLessThan(9000);
    } finally {
      await app.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
