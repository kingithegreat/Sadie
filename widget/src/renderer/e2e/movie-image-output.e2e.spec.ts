import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

for (const format of ['png', 'jpeg', 'corrupt'] as const) {
  test(`Movie Router validates ${format} output through the local provider and persisted cache`, async ({}, testInfo) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-image-output-e2e-'));
    const projectsRoot = path.join(os.homedir(), 'Desktop', 'homebot-movie-projects');
    fs.mkdirSync(projectsRoot, { recursive: true });
    const projectDir = fs.mkdtempSync(path.join(projectsRoot, 'image-output-e2e-'));
    const projectId = path.basename(projectDir);
    const shotDir = path.join(projectDir, 'scenes', 'scene_01', 'shot_01');
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ projectId, name: projectId, freeOnly: true }));
    fs.writeFileSync(path.join(shotDir, 'prompt.json'), JSON.stringify({
      kind: 'image', prompt: 'Controlled image output fixture', shotId: 'shot_01', width: 256, height: 256,
    }));
    // A nonexistent override falls back to the installed engine. A real, locked
    // fixture makes discovery deterministic and prevents unrelated generation.
    const ancient = path.join(profile, 'ancient-fixture');
    fs.mkdirSync(path.join(ancient, 'workspace'), { recursive: true });
    fs.writeFileSync(path.join(ancient, 'run_pipeline.py'), '# Test fixture; never executed.');
    fs.writeFileSync(path.join(ancient, 'workspace', 'render.lock'), JSON.stringify({ pid: process.pid, ts: Date.now() / 1000 }));
    let imageBytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(1000)]);
    let generationRequests = 0;
    const server = http.createServer((request, response) => {
      if (request.url === '/system_stats' || request.url?.startsWith('/object_info')) { response.statusCode = 503; response.end('{}'); return; }
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        if (request.url === '/sdapi/v1/txt2img') {
          generationRequests++;
          const payload = JSON.parse(Buffer.concat(chunks).toString());
          if (payload.prompt !== 'Controlled image output fixture') { response.statusCode = 400; response.end('{}'); return; }
          response.end(JSON.stringify({ images: [imageBytes.toString('base64')] }));
        } else response.end('[]');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { app, page } = await launchElectronApp({
      HOMEBOT_E2E: '1', NODE_ENV: 'test', ANCIENT_PATHWAYS_DIR: ancient,
      COMFY_ENDPOINT: endpoint, LOCAL_SD_ENDPOINT: `${endpoint}/sdapi/v1/txt2img`,
    }, profile);
    try {
      await waitForAppReady(page);
      expect(await dismissFirstRun(page)).toBe(true);
      await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false }));
      if (format !== 'corrupt') {
        // Four colored regions: verify decoded pixels, not a solid placeholder.
        const base64 = await app.evaluate(({ nativeImage }, type) => {
          const bitmap = Buffer.alloc(256 * 256 * 4);
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            const i = (y * 256 + x) * 4;
            bitmap[i] = x < 128 ? 230 : 25;
            bitmap[i + 1] = y < 128 ? 30 : 220;
            bitmap[i + 2] = x < 128 ? 20 : 235;
            bitmap[i + 3] = 255;
          }
          const image = nativeImage.createFromBitmap(bitmap, { width: 256, height: 256 });
          return (type === 'jpeg' ? image.toJPEG(90) : image.toPNG()).toString('base64');
        }, format);
        imageBytes = Buffer.from(base64, 'base64');
      }
      await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
      await page.getByRole('tab', { name: /Movie Router/ }).click();
      const run = page.locator('.ms-movie-project-item').filter({ hasText: projectId })
        .getByRole('button', { name: /Route & Generate/ });
      await run.click();
      const statePath = path.join(shotDir, 'status.json');
      if (format === 'corrupt') {
        await expect(page.locator('.ms-runner--error')).toBeVisible();
        expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).status).toBe('FAILED');
        expect(fs.existsSync(path.join(shotDir, 'image', 'shot_01.png'))).toBe(false);
        expect(fs.existsSync(path.join(shotDir, 'image', 'shot_01.jpg'))).toBe(false);
      } else {
        await expect(page.locator('.ms-runner--ok')).toBeVisible();
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(state.status).toBe('IMAGE_GENERATED');
        expect(state.outputFiles).toHaveLength(1);
        const output = path.join(shotDir, state.outputFiles[0]);
        expect(fs.readFileSync(output)).toEqual(imageBytes);
        const decoded = await app.evaluate(({ nativeImage }, file) => {
          const image = nativeImage.createFromPath(file);
          const pixels = image.toBitmap();
          const values = [0, 200, 200 * 256, 200 * 256 + 200].map(i => [...pixels.subarray(i * 4, i * 4 + 3)].join(','));
          return { empty: image.isEmpty(), size: image.getSize(), colors: new Set(values).size };
        }, output);
        expect(decoded).toEqual({ empty: false, size: { width: 256, height: 256 }, colors: 4 });
        await testInfo.attach(`generated-${format}`, { body: imageBytes, contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png' });
        await run.click();
        await expect(page.locator('.ms-runner--ok')).toContainText('skipped');
        expect(generationRequests).toBe(1);
        // The same visible action must detect a saved file damaged after success.
        fs.writeFileSync(output, 'truncated image');
        await run.click();
        await expect(page.locator('.ms-runner--error')).toContainText('saved image');
        expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).status).toBe('FAILED');
        expect(generationRequests).toBe(1);
      }
      expect(generationRequests).toBe(1);
      expect(JSON.parse(fs.readFileSync(path.join(shotDir, 'decision.json'), 'utf8')).chosen).toBe('local-sd15');
      await page.screenshot({ path: testInfo.outputPath(`movie-image-${format}.png`) });
    } finally {
      await app.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
}
