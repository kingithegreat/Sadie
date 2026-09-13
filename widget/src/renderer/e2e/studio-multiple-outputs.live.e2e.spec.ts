import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createStudioOutputSpec } from '../../shared/media-output';
import { launchFocusedStudioApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('both formats keep landscape after real portrait QA failure, then retry only portrait after restart', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_EXPORT_LIVE !== '1', 'Installed FFmpeg and local diagnostic inputs only.');
  test.setTimeout(240_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  expect(ffmpeg).toBeTruthy();
  const ffprobe = path.join(path.dirname(ffmpeg), 'ffprobe.exe');
  const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout: 60_000 });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-multiple-outputs-proof-'));
  const image = path.join(profile, 'wide-diagnostic.png');
  const audio = path.join(profile, 'audio.wav');
  // Landscape shows both colours. Centered portrait crop contains only white,
  // so the real existing placeholder QA rejects it; no renderer/QA mocks.
  run(['-y', '-f', 'lavfi', '-i', 'color=c=0x164E80:s=1280x720:d=1,drawbox=x=400:y=0:w=480:h=720:color=white:t=fill', '-frames:v', '1', image]);
  run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '48000', audio]);
  const id = 'multiple-output-proof';
  const title = 'Independent output proof';
  const jobsFile = path.join(profile, 'media-jobs.json');
  fs.writeFileSync(jobsFile, JSON.stringify([{
    id, title, format: 'short', state: 'media_production', narrationPath: audio, durationSeconds: 3,
    burnSubtitles: false, outputSpec: createStudioOutputSpec('16:9', 'short', '720p'),
    renderInputs: { imagePath: image, scenePaths: [], musicPath: null, zoom: false, visuals: 'plain' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
  }]));
  const readJobs = () => JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const read = () => readJobs().find((job: any) => job.id === id);
  const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const env = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_FFMPEG: ffmpeg };
  let { app, page } = await launchFocusedStudioApp(env, profile);
  const inspect = (file: string) => {
    run(['-v', 'error', '-xerror', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    return JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { windowsHide: true }).toString());
  };
  const playSelected = async () => {
    const player = page.getByTestId(`ms-video-${id}`);
    await player.scrollIntoViewIfNeeded();
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
    await player.evaluate((video: HTMLVideoElement) => { video.currentTime = 0; return video.play(); });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => ({ ended: video.ended, error: video.error?.code ?? null })), { timeout: 10_000 })
      .toEqual({ ended: true, error: null });
  };
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false, mediaMusicEnabled: false,
      permissions: { media_render: true, media_set_output: true } }));
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByLabel(`${title} output selection`, { exact: true }).selectOption('both');
    await expect.poll(() => read().outputSpec.variants.length).toBe(2);
    await page.getByLabel(`${title} portrait resolution`, { exact: true }).selectOption('720p');
    await page.getByLabel(`${title} portrait image framing`, { exact: true }).selectOption('crop');
    await expect.poll(() => read().outputSpec.variants[1].framing.mode).toBe('crop');
    const layout = await page.locator(`[data-job-id="${id}"]`).evaluate(card => ({
      cardWidth: card.getBoundingClientRect().width,
      columns: getComputedStyle(card).gridTemplateColumns,
      fields: [...card.querySelectorAll('fieldset, select, .ms-job-main, .ms-job-actions')].map(element => ({
        name: element.getAttribute('aria-label') || element.className,
        width: element.getBoundingClientRect().width,
      })),
    }));
    fs.writeFileSync(testInfo.outputPath('output-controls-layout.json'), JSON.stringify(layout, null, 2));
    expect(layout.fields.find(field => field.name === `${title} output settings`)!.width).toBeGreaterThan(400);
    for (const field of layout.fields.filter(field => /selection|resolution|framing|shape/.test(field.name))) expect(field.width).toBeGreaterThan(120);
    await page.locator(`[data-job-id="${id}"]`).getByRole('button', { name: 'Make the video', exact: true }).click();
    await expect.poll(() => read().latestExportAttempt?.status, { timeout: 90_000 }).toBe('failed');
    const failed = read();
    expect(failed.variantExportAttempts.landscape.status).toBe('succeeded');
    expect(failed.variantExportAttempts.portrait).toMatchObject({ status: 'failed', error: expect.stringMatching(/flat|placeholder/i) });
    const landscape = failed.renderedOutput;
    const landscapePath = failed.renderPath;
    const landscapeHash = digest(landscapePath);
    const landscapeReview = readJobs().find((job: any) => job.id === `jobexport_${landscape.exportId}`);
    expect(landscapeReview).toMatchObject({ state: 'awaiting_approval', renderPath: landscapePath });
    expect(readJobs()).toHaveLength(2);
    await expect(page.getByRole('button', { name: 'Retry portrait', exact: true })).toBeVisible();
    await playSelected();
    const initialState = await page.evaluate(id => window.electron.mediaGetExportState!(id), id);
    await page.screenshot({ path: testInfo.outputPath('partial-success.png'), animations: 'disabled' });
    fs.writeFileSync(testInfo.outputPath('partial-evidence.json'), JSON.stringify({ profile, failed, landscapeReview, initialState, landscapeHash }, null, 2));
    await app.close();
    ({ app, page } = await launchFocusedStudioApp(env, profile));
    await waitForAppReady(page);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await expect(page.getByLabel(`${title} output selection`, { exact: true })).toHaveValue('both');
    await expect(page.getByRole('button', { name: 'Retry portrait', exact: true })).toBeVisible();
    await playSelected();
    await page.getByLabel(`${title} portrait image framing`, { exact: true }).selectOption('fit');
    await expect.poll(() => read().outputSpec.variants[1].framing.mode).toBe('fit');
    const changed = await page.evaluate(id => window.electron.mediaGetExportState!(id), id);
    expect(changed.variantRevisions?.landscape).toBe(initialState.variantRevisions?.landscape);
    await page.getByRole('button', { name: 'Retry portrait', exact: true }).click();
    await expect.poll(() => read().variantExportAttempts.portrait.status, { timeout: 90_000 }).toBe('succeeded');
    const history = await page.evaluate(id => window.electron.mediaGetExportState!(id), id);
    expect(history.outputs).toHaveLength(2);
    const portrait = history.outputs.find(output => output.outputSpec.variants[0].id === 'portrait')!;
    expect(portrait.moviePath).not.toBe(landscapePath);
    expect(digest(landscapePath)).toBe(landscapeHash);
    expect(read().variantExportAttempts.landscape.id).toBe(failed.variantExportAttempts.landscape.id);
    expect(readJobs().find((job: any) => job.id === landscapeReview.id)).toEqual(landscapeReview);
    expect(readJobs()).toHaveLength(3);
    const streams = [inspect(landscapePath), inspect(portrait.moviePath)];
    expect(streams[0].streams.find((stream: any) => stream.codec_type === 'video')).toMatchObject({ width: 1280, height: 720 });
    expect(streams[1].streams.find((stream: any) => stream.codec_type === 'video')).toMatchObject({ width: 720, height: 1280 });
    for (const info of streams) expect(Math.abs(Number(info.format.duration) - 3)).toBeLessThan(0.15);
    await page.getByRole('button', { name: 'View portrait', exact: true }).click();
    await playSelected();
    await page.getByRole('button', { name: 'View landscape', exact: true }).click();
    await playSelected();
    await page.getByRole('button', { name: 'Review selected format', exact: true }).click();
    const reviewCard = page.locator(`[data-job-id="${landscapeReview.id}"]`);
    await expect(reviewCard.getByTestId(`ms-video-${landscapeReview.id}`)).toHaveAttribute('src', new RegExp(landscape.filename.replace(/\./g, '\\.')));
    const wrongApproval = await page.evaluate(({ id, other }) => window.electron.mediaApprove!(id, undefined, other), { id: landscapeReview.id, other: portrait.moviePath });
    expect(wrongApproval.ok).toBe(false);
    expect(wrongApproval.error).toMatch(/current movie changed/i);
    expect(readJobs().every((job: any) => job.state !== 'approved' && !job.videoId)).toBe(true);
    await reviewCard.screenshot({ path: testInfo.outputPath('exact-landscape-review.png'), animations: 'disabled' });
    fs.writeFileSync(testInfo.outputPath('multiple-output-evidence.json'), JSON.stringify({ profile, failed, history,
      landscapeReview, landscapeHash, portraitHash: digest(portrait.moviePath), streams, wrongApproval,
      source: 'Local diagnostic colours and three-second sine audio; no providers, approvals or publication.' }, null, 2));
  } catch (error) {
    fs.writeFileSync(testInfo.outputPath('failure-jobs.json'), JSON.stringify({ profile, jobs: readJobs() }, null, 2));
    await page.screenshot({ path: testInfo.outputPath('failure-surface.png'), timeout: 5000 }).catch(() => {});
    throw error;
  } finally { await app.close(); }
});
