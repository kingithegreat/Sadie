import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { focusStudioWindow } from './helpers/focusStudioWindow';

test('real Studio decoders coordinate, report missing media, and keep transport in fullscreen', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_PLAYBACK_LIVE !== '1', 'Opt-in real decoder proof, no providers');
  test.setTimeout(120_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  expect(fs.existsSync(ffmpeg)).toBe(true);
  const entry = process.env.HOMEBOT_STUDIO_PLAYBACK_ENTRY || path.resolve('out/main/index.js');
  expect(path.isAbsolute(entry)).toBe(true);
  expect(fs.existsSync(entry)).toBe(true);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-playback-live-'));
  const profile = path.join(home, 'profile');
  const config = path.join(profile, 'config');
  const ap = path.join(home, 'ap-fixture');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(ap);
  fs.writeFileSync(path.join(ap, 'run_pipeline.py'), '# isolated fixture');
  fs.writeFileSync(path.join(config, 'mcp-servers.json'), JSON.stringify({ servers: [] }));
  fs.writeFileSync(path.join(config, 'user-settings.json'), JSON.stringify({ firstRun: false, useCustomLLM: false,
    mediaMusicEnabled: false, alwaysOnTop: false, chatModel: 'fixture-local:latest',
    ollamaUrl: 'http://127.0.0.1:1', n8nUrl: 'http://127.0.0.1:2', telemetryEnabled: false }));
  const movie = path.join(home, 'fixture.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', movie],
  { windowsHide: true, timeout: 30_000 });
  const voice = path.join(home, 'voice.wav');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', movie, '-vn', voice], { windowsHide: true, timeout: 30_000 });
  const storyboard = {
    project: { projectId: 'playback-board', name: 'Playback board', notes: 'Offline playback fixture' },
    scenes: [{ sceneId: 'scene_01', title: 'Clock fixture', shots: [1, 2].map(index => ({
      shotId: `shot_${index}`, order: index, prompt: `Fixture shot ${index}`, framing: 'wide',
      lens: '24mm', movement: 'static', durationSec: 10, narration: `Fixture narration ${index}`,
      status: 'PLANNED', frameImagePath: null,
    })) }], projectDir: path.join(home, 'projects', 'playback-board'),
  };
  fs.writeFileSync(path.join(profile, 'media-jobs.json'), JSON.stringify(['first', 'second', 'missing', 'sample'].map(id => ({
    id, title: `Playback ${id}`, format: 'short', state: id === 'sample' ? 'script_qa' : 'awaiting_approval', durationSeconds: 20,
    script: id === 'sample' ? 'Offline sample fixture.' : undefined,
    renderPath: id === 'sample' ? undefined : id === 'missing' ? path.join(home, 'missing.mp4') : movie,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
  }))));
  // Install before importing the real main bundle, rather than trusting NODE_OPTIONS.
  const guard = path.join(home, 'offline.cjs');
  fs.writeFileSync(guard, `
const state = globalThis.playbackNetwork = { controls: 0, denied: [] };
const fixture = globalThis.playbackFixture = { installed: [], samples: 0 };
const fullscreen = globalThis.playbackFullscreen = { permissions: [], events: [] };
require('electron').app.on('browser-window-created', (_event, win) => {
  for(const name of ['enter-full-screen','leave-full-screen','enter-html-full-screen','leave-html-full-screen','resize'])
    win.on(name, () => fullscreen.events.push({name,bounds:win.getBounds(),native:win.isFullScreen()}));
});
const ipc = require('electron').ipcMain;
const handle = ipc.handle.bind(ipc);
ipc.handle = function(channel, listener) {
  if(channel === 'homebot:tts-sample-voice') {
    fixture.installed.push(channel);
    return handle(channel, () => { fixture.samples++; return {success:true,path:${JSON.stringify(voice)}}; });
  }
  if(channel === 'homebot:media:storyboard:list') return handle(channel, () => ({ok:true,storyboards:[{
    projectId:'playback-board',title:'Playback board',totalShots:2,renderedFrames:0,totalDurationSec:20,
    projectDir:${JSON.stringify(storyboard.projectDir)}
  }]}));
  if(channel === 'homebot:media:storyboard:get') return handle(channel, () => ({ok:true,result:${JSON.stringify(storyboard)}}));
  return handle(channel, listener);
};
let control=true;
function deny(channel) { if(control) state.controls++; else state.denied.push(channel); throw Error('Offline playback proof: '+channel); }
globalThis.fetch=()=>deny('fetch');
for(const name of ['http','https']) for(const method of ['get','request']) require(name)[method]=()=>deny(name+'.'+method);
for(const f of [()=>fetch('https://control.invalid'),()=>require('http').get('http://control.invalid'),()=>require('http').request('http://control.invalid'),()=>require('https').get('https://control.invalid'),()=>require('https').request('https://control.invalid')]) {try{f();}catch{}}
control=false;
const cp=require('child_process'); for(const key of ['spawn','exec']) {const old=cp[key];cp[key]=function(command,...args){if(/ollama|npx/i.test(String(command)))throw Error('No model or connector launch');return old.call(this,command,...args);};}
require('electron').app.whenReady().then(()=>{
  const session=require('electron').session.defaultSession;
  const set=session.setPermissionRequestHandler.bind(session);
  session.setPermissionRequestHandler = handler => set(handler && ((wc, permission, callback, details) => {
    const receipt={permission,called:false,requestingUrl:details?.requestingUrl,isMainFrame:details?.isMainFrame,url:wc?.getURL()};fullscreen.permissions.push(receipt);
    return handler(wc,permission,allowed=>{receipt.called=true;receipt.allowed=allowed;callback(allowed);},details);
  }));
  session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{state.denied.push('renderer');callback({cancel:true});});
});
`);
  const shim = path.join(path.dirname(entry), `playback-proof-${process.pid}.cjs`);
  fs.writeFileSync(shim, `require(${JSON.stringify(guard)});\nrequire(${JSON.stringify(entry)});\n`, { flag: 'wx' });
  const env = Object.fromEntries(Object.entries({ ...process.env, HOMEBOT_E2E: '1', HOMEBOT_E2E_BYPASS_MOCK: '1', NODE_ENV: 'test',
    HOMEBOT_E2E_USER_DATA_DIR: profile, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'),
    ANCIENT_PATHWAYS_DIR: ap, HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'projects'), OLLAMA_URL: 'http://127.0.0.1:1', COMFY_ENDPOINT: 'http://127.0.0.1:4',
    HOMEBOT_ENABLE_AUTO_UPDATE: '0', HOMEBOT_TIER: 'free',
  }).filter((item): item is [string, string] => typeof item[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const app = await electron.launch({ executablePath: require('electron') as string, args: [shim], env,
    cwd: path.resolve(path.dirname(entry), '../..') });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
    await focusStudioWindow(app, page);
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
    expect(await app.evaluate(() => (globalThis as any).playbackNetwork.controls)).toBe(5);
    expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([]);
    expect((await page.evaluate(() => window.electron.mediaAncientPathwaysStatus!())).dir).toBe(ap);
    // Fixture installed before the app's duplicate-registration guard.
    expect(await app.evaluate(() => (globalThis as any).playbackFixture.installed)).toContain('homebot:tts-sample-voice');
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    // First verify actual audio coordination before exercising the new lazy UI.
    // This reaches the autoplay/overlap regression on the unchanged baseline too.
    const first = page.getByTestId('ms-video-first');
    const second = page.getByTestId('ms-video-second');
    await first.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => first.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
    await page.locator('[data-job-id="sample"]').getByRole('button', { name: /Sample/ }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).playbackFixture.samples)).toBe(1);
    const sample = page.locator('audio.ms-audio');
    await expect.poll(() => sample.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
    expect(await sample.evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, autoplay: audio.autoplay }))).toEqual({ paused: true, autoplay: false });
    await expect(sample).toBeVisible();
    await sample.evaluate((audio: HTMLAudioElement) => audio.play());
    await expect.poll(() => sample.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.2);
    await expect.poll(() => first.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    await first.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => sample.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    const firstHandle = await first.elementHandle();
    await page.getByRole('button', { name: 'Open Movie preview: Playback second', exact: true }).click();
    expect(await firstHandle!.evaluate((video: HTMLVideoElement) => ({ paused: video.paused, source: video.getAttribute('src') }))).toEqual({ paused: true, source: null });
    await second.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => second.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
    await page.getByRole('button', { name: 'Open Movie preview: Playback missing', exact: true }).click();
    await expect(page.locator('[data-job-id="missing"]').getByRole('alert')).toBeVisible();
    await page.locator('[data-job-id="first"]').getByRole('button', { name: /Timeline/ }).click();
    await page.getByRole('button', { name: 'Enter timeline fullscreen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid'))).toBe('studio-monitor');
    const play = page.getByRole('button', { name: 'Play timeline preview' });
    await play.click();
    await expect.poll(() => page.locator('video[aria-label="Timeline video preview"]').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
    await expect(page.getByRole('button', { name: 'Pause timeline preview' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('fullscreen.png') });
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(page.getByRole('button', { name: 'Enter timeline fullscreen' })).toBeVisible();
    await page.getByRole('tab', { name: /Director Console/ }).click();
    await expect(sample).toBeVisible();
    await expect.poll(() => sample.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
    expect(await sample.evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, autoplay: audio.autoplay, time: audio.currentTime }))).toEqual({ paused: true, autoplay: false, time: 0 });
    await page.getByRole('tab', { name: /Storyboard/ }).click();
    await page.getByRole('button', { name: /Play Animatic/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Storyboard Animatic Player' });
    const narration = dialog.locator('audio');
    const scrubber = dialog.getByRole('slider', { name: 'Animatic timeline scrubber' });
    await expect.poll(() => narration.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.3);
    await dialog.getByRole('button', { name: /Pause/ }).click();
    const pausedAt = await narration.evaluate((audio: HTMLAudioElement) => audio.currentTime);
    expect(pausedAt).toBeGreaterThan(0.3);
    expect(await narration.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    // Native keyboard seeking exercises the actual range's change handler.
    await scrubber.press('Home');
    await scrubber.press('PageUp');
    const sought = Number(await scrubber.inputValue());
    expect(sought).toBeGreaterThan(0);
    expect(sought).toBeLessThan(10);
    await expect.poll(() => narration.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeCloseTo(sought, 1);
    await dialog.getByRole('button', { name: /Play$/, exact: false }).click();
    await expect.poll(() => narration.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(sought + 0.2);
    const clockDelta = await dialog.evaluate(element => Math.abs(
      (element.querySelector('audio') as HTMLAudioElement).currentTime -
      Number((element.querySelector('input[type="range"]') as HTMLInputElement).value)));
    expect(clockDelta).toBeLessThan(0.2);
    await dialog.getByRole('button', { name: /Next/ }).click();
    await expect(dialog.getByText('Shot 2 of 2', { exact: true })).toBeVisible();
    await expect.poll(() => narration.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.2);
    await page.screenshot({ path: testInfo.outputPath('animatic.png') });
    const narrationHandle = await narration.elementHandle();
    await dialog.getByRole('button', { name: 'Close Animatic Player', exact: true }).click();
    expect(await narrationHandle!.evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, source: audio.getAttribute('src') }))).toEqual({ paused: true, source: null });
    fs.writeFileSync(testInfo.outputPath('playback-evidence.json'), JSON.stringify({ home,
      mainSha256: createHash('sha256').update(fs.readFileSync(entry)).digest('hex'),
      movieSha256: createHash('sha256').update(fs.readFileSync(movie)).digest('hex'),
      network: await app.evaluate(() => (globalThis as any).playbackNetwork),
    }, null, 2));
  } finally {
    try {
      const page = app.windows()[0];
      fs.writeFileSync(testInfo.outputPath('playback-diagnostic.json'), JSON.stringify({ home,
        fixture: await app.evaluate(() => (globalThis as any).playbackFixture),
        network: await app.evaluate(() => (globalThis as any).playbackNetwork),
        fullscreen: await app.evaluate(({ BrowserWindow }) => ({...((globalThis as any).playbackFullscreen), windows:BrowserWindow.getAllWindows().map(win=>({bounds:win.getBounds(),native:win.isFullScreen(),fullscreenable:win.isFullScreenable()}))})),
        fullscreenDom: page ? await page.evaluate(() => ({enabled:document.fullscreenEnabled,element:document.fullscreenElement?.outerHTML.slice(0,300),button:document.querySelector('[aria-label="Enter timeline fullscreen"]')?.outerHTML})) : null,
        alerts: page ? await page.getByRole('alert').allTextContents() : [],
        media: page ? await page.locator('video,audio').evaluateAll(elements => elements.map(element => {
          const media = element as HTMLMediaElement;
          const rect = media.getBoundingClientRect(); const style = getComputedStyle(media);
          const ancestors = []; let parent = media.parentElement;
          while(parent && ancestors.length < 5) { const box = parent.getBoundingClientRect(); const css = getComputedStyle(parent);
            ancestors.push({tag:parent.tagName,className:parent.className,width:box.width,height:box.height,display:css.display,overflow:css.overflow}); parent=parent.parentElement; }
          return { tag: media.tagName, label: media.getAttribute('aria-label'), src: media.getAttribute('src'), paused: media.paused, time: media.currentTime, error: media.error?.code,
            width:rect.width,height:rect.height,display:style.display,visibility:style.visibility,flexShrink:style.flexShrink,ancestors };
        })) : [],
      }, null, 2));
    } finally { await app.close(); fs.unlinkSync(shim); }
  }
});
