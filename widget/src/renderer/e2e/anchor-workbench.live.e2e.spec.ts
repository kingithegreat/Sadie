import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchFocusedStudioApp as launchElectronApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

// Opt-in: drives the Character Anchor Workbench in the real app against a
// disposable Ancient Pathways fixture. The app's home is the fixture home, so
// an owner's real checkout (and its hand-placed anchors) cannot be reached.
test('Workbench replaces a hand-placed mouth anchor only after explicit confirmation', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_ANCHOR_WORKBENCH_LIVE !== '1', 'Opt-in live Workbench check.');
  test.setTimeout(180_000);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-anchor-live-'));
  const ap = path.join(home, 'Desktop', 'Ancient Pathways');
  const charDir = path.join(ap, 'workspace', 'branding', 'characters', 'leila');
  fs.mkdirSync(path.join(charDir, 'pose_a'), { recursive: true });
  fs.writeFileSync(path.join(ap, 'run_pipeline.py'), '# fixture marker');
  fs.copyFileSync(path.resolve('resources/icon.png'), path.join(charDir, 'pose_a', 'idle.png')); // 512×512
  const manifestPath = path.join(charDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    pose_a: { idle: 'pose_a/idle.png' },
    _mouth_anchors: { pose_a: { idle: [200, 300, 60, 40] } },
    _head_boxes: { pose_a: { idle: [150, 100, 200, 260] } },
  }, null, 2));
  const original = fs.readFileSync(manifestPath);
  const userData = path.join(home, 'AppData', 'HomeBot');
  fs.mkdirSync(userData, { recursive: true });
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test', USERPROFILE: home, HOME: home, ANCIENT_PATHWAYS_DIR: ap }, userData);
  const out = (name: string) => testInfo.outputPath(name);
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Ancient Pathways/ }).first().click();
    await page.getByRole('tab', { name: /Character Anchor Workbench/ }).click();
    await expect(page.getByText('Leila').first()).toBeVisible({ timeout: 20_000 });
    const mouthX = page.getByLabel('Mouth anchor X');
    await expect(mouthX).toHaveValue('200', { timeout: 20_000 });
    await mouthX.fill('210');
    const save = page.getByRole('button', { name: 'Save Mouth Anchor to Manifest' });

    // 1. Save → the owner is asked, and "Keep" leaves the manifest byte-for-byte.
    await save.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('placed by hand at x 200, y 300, 60×40');
    await expect(dialog).toContainText('Saving puts it at x 210, y 300, 60×40');
    const keep = page.getByRole('button', { name: 'Keep the hand-placed one' });
    const hit = await keep.evaluate((el: HTMLElement) => {
      const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!top && (top === el || el.contains(top));
    });
    expect(hit, 'confirmation dialog is on top and clickable').toBe(true);
    await page.screenshot({ path: out('workbench-confirm.png') });
    await keep.click();
    await expect(dialog).toHaveCount(0);
    expect(fs.readFileSync(manifestPath)).toEqual(original);
    expect(fs.existsSync(path.join(charDir, '.backups'))).toBe(false);

    // 2. Save again → Replace → written, with the previous manifest backed up.
    await save.click();
    await page.getByRole('button', { name: 'Replace the mouth anchor' }).click();
    await expect.poll(() => JSON.parse(fs.readFileSync(manifestPath, 'utf8'))._mouth_anchors.pose_a.idle, { timeout: 15_000 }).toEqual([210, 300, 60, 40]);
    const backups = fs.readdirSync(path.join(charDir, '.backups'));
    expect(backups).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(charDir, '.backups', backups[0]), 'utf8'))._mouth_anchors.pose_a.idle).toEqual([200, 300, 60, 40]);
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))._head_boxes.pose_a.idle).toEqual([150, 100, 200, 260]);
    await page.screenshot({ path: out('workbench-replaced.png') });
  } finally {
    await app.close();
  }
});
