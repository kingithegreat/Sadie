import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { launchFocusedStudioApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

test('Storyboard source QA rejects blank shots and persists explicit picture intent without losing the good movie', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_SOURCE_QA_LIVE !== '1', 'Opt-in actual FFmpeg and Electron, CPU only; no voices/providers.');
  test.setTimeout(240_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  expect(ffmpeg).toBeTruthy();
  expect(fs.existsSync(ffmpeg)).toBe(true);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-source-qa-'));
  const projectId = 'source-qa';
  const projects = path.join(profile, 'projects');
  const project = path.join(projects, projectId);
  const scene = path.join(project, 'scenes', 'scene_01');
  const apFixture = path.join(profile, 'empty-ap');
  fs.mkdirSync(apFixture, { recursive: true });
  fs.writeFileSync(path.join(apFixture, 'run_pipeline.py'), '# Isolated marker; never executed.');
  const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, timeout: 60_000 });
  const frame = (id: string) => path.join(scene, id, 'image', 'frame.png');
  const ids = ['shot_001', 'shot_002', 'shot_003'];
  for (const id of ids) {
    fs.mkdirSync(path.dirname(frame(id)), { recursive: true });
    run(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-frames:v', '1', '-threads', '1', frame(id)]);
    fs.writeFileSync(path.join(scene, id, 'prompt.json'), JSON.stringify({ prompt: 'Authored diagnostic picture', durationSec: 2, movement: 'static' }));
    fs.writeFileSync(path.join(scene, id, 'script.txt'), '');
  }
  fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ sceneId: 'scene_01', shots: ids }));
  fs.writeFileSync(path.join(project, 'project.json'), JSON.stringify({ projectId, title: 'Source picture QA', burnSubtitles: false }));
  const env = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_MOVIE_PROJECTS_DIR: projects, HOMEBOT_FFMPEG: ffmpeg,
    HOME: profile, USERPROFILE: profile, ANCIENT_PATHWAYS_DIR: apFixture };
  let { app, page } = await launchFocusedStudioApp(env, profile);
  const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const metadata = () => JSON.parse(fs.readFileSync(path.join(project, 'project.json'), 'utf8'));
  const openBoard = async () => {
    await waitForAppReady(page);
    await dismissFirstRun(page);
    const apStatus = await page.evaluate(() => window.electron.mediaAncientPathwaysStatus!());
    expect(apStatus.dir).toBe(apFixture);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Storyboard/ }).click();
    await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption(projectId);
    await expect(page.locator('.ms-storyboard-meta-path')).toContainText(projectId);
    await page.getByRole('combobox', { name: 'Video encoder for this export' }).selectOption('cpu');
  };
  const render = () => page.getByRole('button', { name: /Render Movie/ }).click();
  const settled = async () => {
    await expect(page.getByRole('region', { name: 'Visual Storyboard Deck' }).getByRole('status')).toContainText('Successfully rendered', { timeout: 90_000 });
    await expect(page.getByRole('button', { name: /Render Movie/ })).toBeEnabled();
  };
  const close = async (phase: string) => {
    console.log(`[SOURCE-QA] close ${phase} start`);
    await app.close();
    console.log(`[SOURCE-QA] close ${phase} complete`);
  };
  try {
    await openBoard();
    await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false, permissions: { media_render_storyboard: true } }));
    await render();
    await expect.poll(() => metadata().latestSuccessfulOutput?.filename, { timeout: 90_000 }).toBeTruthy();
    console.log('[SOURCE-QA] detailed output saved');
    await settled();
    console.log('[SOURCE-QA] detailed UI settled');
    const first = metadata().latestSuccessfulOutput;
    const firstMovie = path.join(project, 'renders', first.filename);
    const firstHash = digest(firstMovie);
    await close('detailed');
    for (const [id, color] of [['shot_002', 'gray'], ['shot_003', 'black']]) {
      run(['-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30`, '-frames:v', '1', '-threads', '1', frame(id)]);
    }
    ({ app, page } = await launchFocusedStudioApp(env, profile));
    await openBoard();
    console.log('[SOURCE-QA] replaced shots reopened');
    await render();
    const alert = () => page.getByRole('region', { name: 'Visual Storyboard Deck' }).getByRole('alert');
    await expect(alert()).toContainText('scene_01 / shot_002');
    expect(metadata().latestSuccessfulOutput.filename).toBe(first.filename);
    expect(digest(firstMovie)).toBe(firstHash);
    await page.getByRole('checkbox', { name: 'Use a plain background for shot_002' }).check();
    await render();
    await expect(alert()).toContainText('scene_01 / shot_003');
    await page.getByRole('checkbox', { name: 'Use a plain background for shot_003' }).check();
    await render();
    await expect.poll(() => metadata().latestSuccessfulOutput?.filename, { timeout: 90_000 }).not.toBe(first.filename);
    await settled();
    console.log('[SOURCE-QA] explicit plain output saved and UI settled');
    const accepted = metadata().latestSuccessfulOutput;
    const acceptedMovie = path.join(project, 'renders', accepted.filename);
    const acceptedHash = digest(acceptedMovie);
    const ffprobe = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    const facts = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', acceptedMovie],
      { windowsHide: true, timeout: 30_000 }).toString());
    expect(facts.streams.find((stream: any) => stream.codec_type === 'video')).toMatchObject({ width: 1920, height: 1080 });
    expect(facts.streams.some((stream: any) => stream.codec_type === 'audio')).toBe(true);
    expect(Math.abs(Number(facts.format.duration) - 6)).toBeLessThan(0.15);
    run(['-i', acceptedMovie, '-vf', 'fps=1/2,scale=320:180,tile=3x1', '-frames:v', '1', testInfo.outputPath('explicit-plain-contact.png')]);
    expect(digest(firstMovie)).toBe(firstHash);
    await close('accepted');
    ({ app, page } = await launchFocusedStudioApp(env, profile));
    await openBoard();
    await expect(page.getByRole('checkbox', { name: 'Use a plain background for shot_002' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Use a plain background for shot_003' })).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath('plain-background-reopened.png') });
    const video = page.getByLabel('Exported storyboard video');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    expect(await video.evaluate((element: HTMLVideoElement) => !!element.error)).toBe(false);
    await video.evaluate((element: HTMLVideoElement) => element.play());
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    await close('reopened');
    run(['-f', 'lavfi', '-i', 'color=c=white:s=640x360:r=30', '-frames:v', '1', '-threads', '1', frame('shot_002')]);
    ({ app, page } = await launchFocusedStudioApp(env, profile));
    await openBoard();
    await expect(page.getByRole('checkbox', { name: 'Use a plain background for shot_002' })).not.toBeChecked();
    await render();
    await expect(alert()).toContainText('scene_01 / shot_002');
    expect(digest(acceptedMovie)).toBe(acceptedHash);
    fs.writeFileSync(testInfo.outputPath('source-qa-evidence.json'), JSON.stringify({ profile, sourceProject: project,
      original: { path: firstMovie, sha256: firstHash }, accepted: { path: acceptedMovie, sha256: acceptedHash, facts },
      rejectedShotIds: ['shot_002', 'shot_003'], reopenedIntent: true, previousMoviePreserved: true,
      replacedBytesClearedIntent: true, playerPlayed: true,
      scope: 'Authored diagnostic, CPU, silence/no provider requests; not creative or audio quality acceptance.' }, null, 2));
  } finally { await close('cleanup'); }
});
