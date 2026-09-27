import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { createStudioOutputSpec } from '../../shared/media-output';
import { buildScenePrompt, sceneCacheKey, seedForVideo } from '../../main/media-visuals';
import { focusStudioWindow } from './helpers/focusStudioWindow';

test('ordinary Make the video refuses an actually corrupt staged movie and preserves last-good', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_DECODE_LIVE !== '1', 'Disposable actual FFmpeg/output corruption proof; no providers.');
  test.setTimeout(180_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  const corrupt = process.env.HOMEBOT_DECODE_CORRUPT_MOVIE!;
  const detailed = process.env.HOMEBOT_DECODE_DETAILED_IMAGE!;
  for (const input of [ffmpeg, corrupt, detailed]) expect(fs.existsSync(input)).toBe(true);
  const entry = path.resolve('out/main/index.js');
  expect(fs.readFileSync(entry, 'utf8')).toContain('validateCompleteMediaDecode');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-decode-live-'));
  const profile = path.join(home, 'profile');
  const config = path.join(profile, 'config');
  const ap = path.join(home, 'ap-fixture');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(ap);
  fs.writeFileSync(path.join(ap, 'run_pipeline.py'), '# disposable marker, never executed');
  fs.writeFileSync(path.join(config, 'mcp-servers.json'), '[]');
  fs.writeFileSync(path.join(config, 'user-settings.json'), JSON.stringify({ firstRun: false, useCustomLLM: false,
    mediaMusicEnabled: false, permissions: { media_render: true }, alwaysOnTop: false,
    chatModel: 'fixture-local:latest', ollamaUrl: 'http://127.0.0.1:1', n8nUrl: 'http://127.0.0.1:2', telemetryEnabled: false }));
  const id = 'media_complete_decode_qa';
  const title = 'Ordinary decoder QA';
  const text = 'Ordinary narration over an intended scene picture.';
  const audio = path.join(profile, 'audio.wav');
  const captions = path.join(profile, 'captions.srt');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', audio], { windowsHide: true, timeout: 30_000 });
  fs.writeFileSync(captions, `1\n00:00:00,000 --> 00:00:06,000\n${text}\n`);
  const cacheDir = path.join(profile, 'media-assets', '_scene-image-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.copyFileSync(detailed, path.join(cacheDir, `${sceneCacheKey(buildScenePrompt(text, title), 1024, 576, seedForVideo(id))}.png`));
  const jobsFile = path.join(profile, 'media-jobs.json');
  fs.writeFileSync(jobsFile, JSON.stringify([{ id, title, format: 'short', state: 'media_production', narrationPath: audio,
    captionsPath: captions, burnSubtitles: true, durationSeconds: 6, outputSpec: createStudioOutputSpec('16:9', 'short', '720p'),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [] }]));
  const job = () => JSON.parse(fs.readFileSync(jobsFile, 'utf8')).find((item: any) => item.id === id);
  const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const guard = path.join(home, 'offline-bootstrap.cjs');
  fs.writeFileSync(guard, `
const state = globalThis.decodeAcceptanceNetwork = { controls: 0, blocked: [], inventoryFixtures: 0 };
let control = true;
function deny(channel) { if(control) state.controls++; else state.blocked.push(channel); throw new Error('Decode proof blocks network: '+channel); }
globalThis.fetch = () => deny('fetch');
for(const name of ['http','https']) { const transport=require(name); for(const method of ['get','request']) transport[method]=()=>deny(name+'.'+method); }
for(const invoke of [()=>globalThis.fetch('https://decode-control.invalid'),()=>require('http').get('http://decode-control.invalid'),()=>require('http').request('http://decode-control.invalid'),()=>require('https').get('https://decode-control.invalid'),()=>require('https').request('https://decode-control.invalid')]) { try{invoke();}catch{} }
control=false;
const widgetRequire=require('module').createRequire(${JSON.stringify(path.resolve('package.json'))});
widgetRequire('axios').get=async function(url) { if(String(url)==='http://127.0.0.1:1/api/tags') { state.inventoryFixtures++; return {data:{models:[{name:'fixture-local:latest'}]},status:200}; } return deny('axios.get'); };
const cp=require('child_process');
for(const name of ['spawn','exec']) { const original=cp[name]; cp[name]=function(command,...args) { if(/ollama|npx/i.test(String(command))) throw new Error('Decode proof refuses model/MCP launch'); return original.call(this,command,...args); }; }
const electron=require('electron');
electron.app.whenReady().then(()=>electron.session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{state.blocked.push('renderer');callback({cancel:true});}));
globalThis.decodeInstallCorruption=function(jobDir,corrupt) {
  const ownFs=require('fs'); const ownPath=require('path'); const original=ownFs.statSync;
  const state=globalThis.decodeCorruption={matched:0,restored:false,stagedPath:null,restore:()=>{ownFs.statSync=original;state.restored=true;}};
  ownFs.statSync=function(target,...args) {
    if(typeof target==='string' && ownPath.dirname(target)===jobDir && /^video\\.rendering-[a-f0-9-]+\\.mp4$/.test(ownPath.basename(target))) {
      const result=original.call(this,target,...args);
      if(result.size>10000) { state.restore();state.matched++;state.stagedPath=target;ownFs.copyFileSync(corrupt,target);return original.call(this,target,...args); }
      return result;
    }
    return original.call(this,target,...args);
  };
};
`);
  const shim = path.join(path.dirname(entry), `decode-proof-entry-${process.pid}.cjs`);
  fs.writeFileSync(shim, `require(${JSON.stringify(guard)});\nrequire(${JSON.stringify(entry)});\n`, { flag: 'wx' });
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env,
    HOMEBOT_E2E: '1', HOMEBOT_E2E_BYPASS_MOCK: '1', NODE_ENV: 'test', HOMEBOT_FFMPEG: ffmpeg,
    HOMEBOT_E2E_USER_DATA_DIR: profile, HOME: home, USERPROFILE: home,
    APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'),
    ANCIENT_PATHWAYS_DIR: ap, HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'projects'),
  }).filter((item): item is [string, string] => typeof item[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const app = await electron.launch({ executablePath: require('electron') as string, args: [shim], env });
  const page = await app.firstWindow();
  const make = async () => {
    const oldAttempt = job().latestExportAttempt?.id;
    await page.getByRole('button', { name: 'Make the video', exact: true }).click();
    const prompt = page.getByRole('dialog', { name: 'Choose where images are made' });
    await expect.poll(async () => await prompt.isVisible() || job().latestExportAttempt?.id !== oldAttempt).toBe(true);
    if (await prompt.isVisible()) await prompt.getByRole('button', { name: 'Continue with online instead' }).click();
  };
  try {
    await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
    await focusStudioWindow(app, page);
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
    expect(await app.evaluate(() => (globalThis as any).decodeAcceptanceNetwork.controls)).toBe(5);
    expect((await page.evaluate(() => window.electron.mediaAncientPathwaysStatus!())).dir).toBe(ap);
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await make();
    await expect.poll(() => job().latestExportAttempt?.status, { timeout: 90_000 }).toBe('succeeded');
    await expect(page.getByText(`Rendered "${title}"`, { exact: false })).toBeVisible();
    await expect(page.locator('.ms-working')).toHaveCount(0);
    const previousMovie = job().renderPath;
    const previousHash = hash(previousMovie);
    expect(job().renderInputs.scenePaths).toHaveLength(1);
    expect(hash(job().renderInputs.scenePaths[0])).toBe(hash(detailed));
    const probe = path.join(path.dirname(ffmpeg), 'ffprobe.exe');
    const encoded = JSON.parse(execFileSync(probe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', previousMovie], { windowsHide: true, timeout: 30_000 }).toString());
    const revisions = await page.evaluate(async jobId => {
      const first = await window.electron.mediaAdvance!(jobId, 'needs_revision');
      const second = await window.electron.mediaAdvance!(jobId, 'media_production');
      return { first, second };
    }, id);
    expect(revisions.first.ok).toBe(true); expect(revisions.second.ok).toBe(true);
    await page.locator('button.mode-btn', { hasText: /^Chat$/ }).click();
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    const jobDir = path.dirname(previousMovie);
    await app.evaluate((_electron, { jobDir, corrupt }) => {
      (globalThis as any).decodeInstallCorruption(jobDir, corrupt);
    }, { jobDir, corrupt });
    await make();
    await expect.poll(() => job().latestExportAttempt?.status, { timeout: 90_000 }).toBe('failed');
    await expect(page.getByRole('alert').filter({ hasText: 'The movie could not be checked completely.' })).toBeVisible();
    await expect(page.locator('.ms-working')).toHaveCount(0);
    const saved = job();
    expect(saved.renderPath).toBe(previousMovie); expect(hash(previousMovie)).toBe(previousHash);
    expect(saved.rejectedRenderPath).toBeTruthy(); expect(hash(saved.rejectedRenderPath)).toBe(hash(corrupt));
    expect(fs.readdirSync(jobDir).filter(name => name.includes('.rendering-'))).toEqual([]);
    const interception = await app.evaluate(() => { const state = (globalThis as any).decodeCorruption; return { matched: state.matched, restored: state.restored, stagedPath: state.stagedPath }; });
    expect(interception).toMatchObject({ matched: 1, restored: true });
    const player = page.getByTestId(`ms-video-${id}`);
    await expect(player).toBeVisible();
    await player.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
    await player.evaluate((video: HTMLVideoElement) => video.pause());
    const refusal = page.getByRole('alert').filter({ hasText: 'The movie could not be checked completely.' });
    await expect(refusal).toContainText('Retry the export. Any previous export is unchanged.');
    await expect(refusal).not.toContainText('Invalid NAL');
    await expect(refusal).not.toContainText('[h264');
    await refusal.screenshot({ path: testInfo.outputPath('decode-refusal.png') });
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', previousMovie, '-vf', 'fps=1/2,scale=320:180,tile=3x1', '-frames:v', '1', testInfo.outputPath('previous-movie-contact.png')], { windowsHide: true, timeout: 30_000 });
    fs.writeFileSync(testInfo.outputPath('decode-live-evidence.json'), JSON.stringify({ home, profile,
      sourceHead: process.env.HOMEBOT_DECODE_SOURCE_HEAD, buildSha256: hash(entry), corruptSha256: hash(corrupt),
      detailedImageSha256: hash(detailed), narrationSha256: hash(audio), captionsSha256: hash(captions),
      previousMovie, previousHash, encoded, rejectedPath: saved.rejectedRenderPath, failedAttempt: saved.latestExportAttempt,
      interception, previousPlayerPlayed: true, network: await app.evaluate(() => (globalThis as any).decodeAcceptanceNetwork),
      emptyMcpConfiguration: fs.readFileSync(path.join(config, 'mcp-servers.json'), 'utf8'),
      scope: 'Actual normal UI + unchanged real IPC/handler/FFmpeg; precisely scoped one-shot filesystem fixture corrupts only this job staged output after encoding. No product hook/provider/model/voice/AP call.' }, null, 2));
  } finally {
    await app.evaluate(() => (globalThis as any).decodeCorruption?.restore()).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([app.close(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { app.process().kill(); reject(new Error('Own decode fixture app did not close within ten seconds.')); }, 10_000);
      })]);
    } finally {
      if (timer) clearTimeout(timer);
      fs.unlinkSync(shim);
    }
  }
});
