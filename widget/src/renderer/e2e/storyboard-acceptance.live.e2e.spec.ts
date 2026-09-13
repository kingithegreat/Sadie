import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { launchFocusedStudioApp as launchElectronApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

// Opt-in acceptance run of the user-facing Storyboard → frames → animatic →
// export path. Uses installed FFmpeg, a cached Kokoro model and a loopback
// ComfyUI-API fixture (deterministic textured frames, not a model). Online stays
// off; speech, model and paid image hosts are trapped with positive controls, so
// a paid or online call cannot happen silently. The app's home directory is the
// disposable profile, so an owner's Ancient Pathways checkout is not reachable.

const SHOTS = [
  { key: 'harbour at dawn', prompt: 'Wide establishing shot of an old stone harbour at dawn, fishing boats, lighthouse on the headland',
    narration: 'Dawn breaks over the old harbour.', durationSec: 4, color: '0x1E5AA0', kind: 'environment' },
  { key: 'spiral stairs', prompt: 'Medium shot of Mara, a lighthouse keeper in a red scarf, climbing the spiral stairs',
    narration: 'Mara climbs the tower.', durationSec: 3, color: '0xB0302A', kind: 'character' },
  { key: 'striking a match', prompt: "Close-up of Mara's hands striking a match to light the great lamp",
    narration: 'She strikes a match, and the wick catches.', durationSec: 5, color: '0xD8A020', kind: 'character' },
  { key: 'storm clouds', prompt: 'Wide shot of storm clouds rolling in over dark sea waves',
    narration: 'The storm arrives.', durationSec: 3, color: '0x6A3FA0', kind: 'environment' },
  { key: 'boats return', prompt: 'Wide final shot of the lighthouse beam cutting through rain as the boats return home',
    narration: 'The light holds. The boats come home.', durationSec: 4, color: '0x1F7A4A', kind: 'environment' },
];
const REGEN = [
  { key: 'lamp room door', prompt: 'Medium shot of Mara, a lighthouse keeper in a red scarf, pausing at the lamp room door', color: '0x20A0B0', format: 'jpg' as const },
  { key: 'lamp room door', prompt: '', color: '0xE070C0', format: 'png' as const },
  { key: 'lamp room door', prompt: '', color: '0x90D030', format: 'png' as const },
];
const TITLE = 'Harbour Lantern';
const TOTAL = SHOTS.reduce((sum, s) => sum + s.durationSec, 0);
const TRAPPED = /huggingface\.co|hf\.co|microsoft\.com|bing\.com|googleapis\.com|pollinations\.ai|acceptance-control\.invalid/;

test('Storyboard acceptance: create 5 shots, generate frames, animatic, 16:9 export, restart', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STORYBOARD_ACCEPTANCE !== '1', 'Requires installed FFmpeg and cached Kokoro; enable explicitly.');
  test.setTimeout(900_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  expect(ffmpeg && fs.existsSync(ffmpeg), 'Set HOMEBOT_FFMPEG').toBeTruthy();
  const ffprobe = path.join(path.dirname(ffmpeg), 'ffprobe.exe');
  const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
  const meanRgb = (input: string[], seek?: number) => [...run([...(seek !== undefined ? ['-ss', String(seek)] : []), ...input,
    '-vf', 'scale=1:1:flags=area', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']).subarray(0, 3)];
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const out = (name: string) => testInfo.outputPath(name);
  const evidence: Record<string, any> = { ux: [] as string[], findings: [] as string[] };
  const note = (kind: 'ux' | 'findings', text: string) => { evidence[kind].push(text); console.log(`[${kind.toUpperCase()}] ${text}`); };

  // Disposable home: userData, default movie-projects folder and Desktop live here.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-sb-accept-'));
  const userData = path.join(home, 'AppData', 'HomeBot');
  fs.mkdirSync(path.join(home, 'Desktop'), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  const projectsRoot = path.join(home, 'Desktop', 'homebot-movie-projects');
  evidence.home = home;

  // Loopback ComfyUI-API fixture. Each prompt maps to one known colour so an
  // exported frame can be attributed to exactly one shot.
  const icon = path.resolve('resources/icon.png');
  const fixtureDir = path.join(home, 'fixture-frames');
  fs.mkdirSync(fixtureDir);
  const served: Array<{ text: string; width: number; height: number; file: string; color: string; mean: number[] }> = [];
  const jobs = new Map<string, string>();
  let regenCount = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const send = (code: number, body: any, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
    if (url.pathname === '/system_stats') return send(200, { system: { os: 'fixture' } });
    if (url.pathname === '/object_info/CheckpointLoaderSimple') return send(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['fixture.safetensors']] } } } });
    if (url.pathname === '/prompt' && req.method === 'POST') {
      let raw = '';
      req.on('data', c => (raw += c));
      req.on('end', () => {
        const wf = JSON.parse(raw).prompt;
        const text: string = wf['6'].inputs.text;
        const width = wf['5'].inputs.width; const height = wf['5'].inputs.height;
        const base = SHOTS.find(s => text.includes(s.key));
        const regen = text.includes('lamp room door') ? REGEN[Math.min(regenCount++, REGEN.length - 1)] : undefined;
        const color = regen?.color ?? base?.color ?? '0x808080';
        const format = regen?.format ?? 'png';
        const id = `p${served.length + 1}`;
        const file = path.join(fixtureDir, `${id}.${format}`);
        run(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height}:d=1`, '-i', icon, '-filter_complex',
          `[0:v]noise=alls=22:allf=t[bg];[1:v]scale=140:140[logo];[bg][logo]overlay=${Math.round(width / 2 - 70)}:${Math.round(height / 2 - 70)},drawbox=x=40:y=40:w=180:h=80:color=white:t=fill`,
          '-frames:v', '1', ...(format === 'jpg' ? ['-q:v', '3'] : []), file]);
        served.push({ text, width, height, file, color, mean: meanRgb(['-i', file]) });
        jobs.set(id, path.basename(file));
        send(200, { prompt_id: id, number: served.length, node_errors: {} });
      });
      return;
    }
    const history = url.pathname.match(/^\/history\/(.+)$/);
    if (history) {
      const id = decodeURIComponent(history[1]);
      return send(200, jobs.has(id) ? { [id]: { outputs: { 9: { images: [{ filename: jobs.get(id), subfolder: '', type: 'output' }] } } } } : {});
    }
    if (url.pathname === '/view') {
      const file = path.join(fixtureDir, path.basename(url.searchParams.get('filename') || ''));
      if (!fs.existsSync(file)) return send(404, { error: 'missing' });
      return send(200, fs.readFileSync(file), file.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
    }
    send(404, { error: 'not found' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const comfy = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const baseEnv = { HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_FFMPEG: ffmpeg, USERPROFILE: home, HOME: home };
  let app!: ElectronApplication; let page!: Page;
  const launch = async (extra: Record<string, string> = {}) => {
    ({ app, page } = await launchElectronApp({ ...baseEnv, ...extra }, userData));
    await waitForAppReady(page);
  };
  // Positive controls first: a trap that catches nothing is indistinguishable from a clean run.
  const trapNetwork = async () => expect(await app.evaluate((_e, fixture: { cacheDir?: string; packagePath: string; pattern: string }) => {
    if (fixture.cacheDir) {
      const createRequire = (process as any).getBuiltinModule('module').createRequire;
      const widgetRequire = createRequire(fixture.packagePath);
      createRequire(widgetRequire.resolve('kokoro-js'))('@huggingface/transformers').env.cacheDir = fixture.cacheDir;
    }
    const pattern = new RegExp(fixture.pattern);
    const state = globalThis as typeof globalThis & { acceptanceAttempts: string[] };
    state.acceptanceAttempts = [];
    const inspect = (value: any) => {
      const destination = typeof value === 'string' ? value : String(value?.href || value?.url || value?.hostname || value?.host || value);
      if (pattern.test(destination)) { state.acceptanceAttempts.push(destination); throw new Error('Blocked by storyboard acceptance test'); }
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => { inspect(input); return originalFetch(input, init); };
    for (const name of ['http', 'https']) {
      const transport = (process as any).getBuiltinModule(name);
      for (const method of ['get', 'request']) {
        const original = transport[method];
        transport[method] = (...args: any[]) => { inspect(args[0]); return original.apply(transport, args); };
      }
    }
    for (const invoke of [
      () => globalThis.fetch('https://acceptance-control.invalid'),
      () => (process as any).getBuiltinModule('https').get({ hostname: 'acceptance-control.invalid' }),
      () => (process as any).getBuiltinModule('https').request({ hostname: 'generativelanguage.googleapis.com' }),
    ]) { try { invoke(); } catch { /* observed below */ } }
    const count = state.acceptanceAttempts.length;
    state.acceptanceAttempts = [];
    return count;
  }, { cacheDir: process.env.HOMEBOT_KOKORO_TEST_CACHE, packagePath: path.resolve('package.json'), pattern: TRAPPED.source })).toBe(3);
  const attempts = () => app.evaluate(() => (globalThis as any).acceptanceAttempts as string[]);
  const openStoryboard = async () => {
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('tab', { name: /Storyboard/ }).click();
  };
  const board = () => page.getByRole('region', { name: 'Visual Storyboard Deck' });
  const cardIds = () => page.locator('.ms-shot-card .ms-shot-number-badge span:nth-child(2)').allInnerTexts();

  try {
    // ── Phase A: an ordinary PC — no local image server, Online off ─────────
    await launch();
    expect(await dismissFirstRun(page)).toBe(true);
    const defaults = await page.evaluate(() => window.electron.getSettings());
    evidence.defaults = { narrationEngine: (defaults as any).narrationEngine, useCustomLLM: (defaults as any).useCustomLLM };
    await trapNetwork();
    await openStoryboard();
    await page.getByRole('button', { name: '+ New Storyboard' }).click();
    await page.getByLabel('Storyboard title').fill(TITLE);
    await page.getByLabel('Storyboard notes').fill('Five-shot acceptance test: harbour, keeper, lamp, storm, return.');
    await page.getByRole('button', { name: 'Create Storyboard Project' }).click();
    await expect(page.locator('.ms-shot-card')).toHaveCount(3);
    note('ux', `New storyboard starts with 3 template shots (${(await cardIds()).join(', ')}) using the title as prompt text; no blank or guided start.`);
    await page.getByRole('button', { name: 'Add Shot to Storyboard' }).click();
    await page.getByRole('button', { name: 'Add Shot to Storyboard' }).click();
    await expect(page.locator('.ms-shot-card')).toHaveCount(5);
    for (const [i, s] of SHOTS.entries()) {
      const id = `shot_00${i + 1}`;
      await page.getByLabel(`Prompt for ${id}`).fill(s.prompt);
      await page.getByLabel(`Narration for ${id}`).fill(s.narration);
      await page.getByLabel(`Duration for ${id}`).fill(String(s.durationSec));
    }
    const captions = () => page.getByRole('checkbox', { name: 'Burn captions into storyboard video' });
    evidence.captionsDefaultChecked = await captions().isChecked();
    expect.soft(evidence.captionsDefaultChecked, 'Captions must be OFF by default for a new storyboard').toBe(false);
    await expect(page.getByLabel('Storyboard picture shape')).toHaveValue('16:9');
    evidence.outputDefault = { shape: await page.getByLabel('Storyboard picture shape').inputValue(), resolution: await page.getByLabel('Storyboard resolution').inputValue(), framing: await page.getByLabel('Storyboard image framing').inputValue() };
    // Reorder, save, and confirm the saved order before restoring it.
    await page.getByLabel('Move shot_005 earlier').click();
    expect(await cardIds()).toEqual(['shot_001', 'shot_002', 'shot_003', 'shot_005', 'shot_004']);
    await page.getByRole('button', { name: /Save Board/ }).click();
    await expect(board().getByRole('status')).toHaveText('Storyboard saved successfully.');
    const projectDir = path.join(projectsRoot, fs.readdirSync(projectsRoot).find(d => fs.existsSync(path.join(projectsRoot, d, 'project.json')))!);
    const sceneDir = path.join(projectDir, 'scenes', 'scene_01');
    expect(JSON.parse(fs.readFileSync(path.join(sceneDir, 'scene.json'), 'utf8')).shots).toEqual(['shot_001', 'shot_002', 'shot_003', 'shot_005', 'shot_004']);
    await page.getByLabel('Move shot_005 later').click();
    await page.getByRole('button', { name: /Save Board/ }).click();
    await expect(board().getByRole('status')).toHaveText('Storyboard saved successfully.');
    evidence.projectDir = projectDir;
    await page.screenshot({ path: out('a1-board-created.png'), fullPage: true });
    // An ordinary PC (Online off, no local image server): the Storyboard shows a
    // selection/setup state up front instead of failing after a click.
    const picker = () => page.getByRole('combobox', { name: 'How to make frame images' });
    const frameNote = () => page.getByRole('note', { name: 'Frame image status' });
    await expect(picker()).toHaveValue('');
    await expect(frameNote()).toContainText('Nothing can make frame images yet. Turn on Online in Settings', { timeout: 15_000 });
    await expect(page.getByText('Set up this PC (advanced)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Generate Frames/ })).toBeDisabled();
    for (const button of await page.getByRole('button', { name: /Generate Frame$/ }).all()) await expect(button).toBeDisabled();
    await expect(board()).not.toContainText('$0.00');
    // Choosing Imagen without Online or a key explains what is missing and makes no call.
    await picker().selectOption('imagen');
    await expect(frameNote()).toContainText('Online is off. Turn on Online in Settings to use this.');
    await expect(page.getByRole('button', { name: /Generate Frames/ })).toBeDisabled();
    evidence.ordinaryPcState = { note: await frameNote().innerText(), generateDisabled: true };
    await page.screenshot({ path: out('a2-ordinary-pc-frame-choice.png'), fullPage: true });
    await picker().selectOption({ index: 0 }).catch(() => {}); // placeholder is disabled; keep imagen saved
    await page.getByRole('group', { name: 'Frame images' }).screenshot({ path: out('a3-frame-picker-ordinary-pc.png') });
    expect(await attempts()).toEqual([]);
    await app.close();

    // ── Phase B: restart with a local ComfyUI-compatible server ─────────────
    await launch({ COMFY_ENDPOINT: comfy });
    await trapNetwork();
    await openStoryboard();
    await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption({ label: `${TITLE} (5 shots)` });
    await expect(page.locator('.ms-shot-card')).toHaveCount(5);
    expect(await cardIds()).toEqual(['shot_001', 'shot_002', 'shot_003', 'shot_004', 'shot_005']);
    for (const [i, s] of SHOTS.entries()) {
      const id = `shot_00${i + 1}`;
      await expect(page.getByLabel(`Prompt for ${id}`)).toHaveValue(s.prompt);
      await expect(page.getByLabel(`Narration for ${id}`)).toHaveValue(s.narration);
      await expect(page.getByLabel(`Duration for ${id}`)).toHaveValue(String(s.durationSec));
    }
    await expect(captions()).toBeChecked({ checked: evidence.captionsDefaultChecked });
    evidence.persistedAfterRestart = true;

    // The saved choice survived the restart; switch to this PC's image server.
    const picker2 = page.getByRole('combobox', { name: 'How to make frame images' });
    await expect(picker2).toHaveValue('imagen');
    await picker2.selectOption('this-pc');
    await expect(page.getByRole('note', { name: 'Frame image status' })).toContainText('No charge. Runs on this computer; nothing is sent online.');
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8')).frameProvider).toBe('this-pc');
    await page.getByRole('group', { name: 'Frame images' }).screenshot({ path: out('b0-frame-picker-this-pc.png') });

    // Generate every missing frame through the visible bulk action.
    const messages: string[] = [];
    const statusWatcher = setInterval(async () => {
      try { const t = await board().getByRole('status').innerText({ timeout: 200 }); if (t && !messages.includes(t)) messages.push(t); } catch { /* none showing */ }
    }, 150);
    await page.getByRole('button', { name: /Generate Frames/ }).click();
    await expect(page.locator('img.ms-shot-thumb-img')).toHaveCount(5, { timeout: 120_000 });
    clearInterval(statusWatcher);
    evidence.generationMessages = messages;
    expect(served).toHaveLength(5);
    const frames: Record<string, { file: string; provider: string; sha: string; fixtureColor: string }> = {};
    for (const [i, s] of SHOTS.entries()) {
      const id = `shot_00${i + 1}`;
      const request = served[i];
      expect(request.text).toBe(s.prompt); // one request per shot, in board order, with that shot's own prompt
      expect([request.width, request.height]).toEqual([1024, 576]);
      const file = path.join(sceneDir, id, 'image', `${id}.png`);
      expect(sha(file)).toBe(sha(request.file)); // the bytes served for this prompt, in this shot's folder only
      const status = JSON.parse(fs.readFileSync(path.join(sceneDir, id, 'status.json'), 'utf8'));
      expect(status).toMatchObject({ provider: 'comfyui', generatedPrompt: s.prompt });
      const src = decodeURIComponent(await page.locator('.ms-shot-card').nth(i).locator('img.ms-shot-thumb-img').getAttribute('src') || '');
      expect(src.replace(/\\/g, '/')).toContain(`/scene_01/${id}/image/${id}.png`);
      frames[id] = { file, provider: status.provider, sha: sha(file), fixtureColor: s.color };
    }
    expect(new Set(Object.values(frames).map(f => f.sha)).size).toBe(5);
    evidence.frames = frames;
    const uiProviderMessages = messages.filter(m => /Generated keyframe/.test(m));
    evidence.uiProviderLabel = uiProviderMessages;
    if (!uiProviderMessages.every(m => m.includes('comfyui'))) note('findings', `UI provider label did not match the provider used: ${uiProviderMessages.join(' | ')}`);
    note('ux', 'The chosen provider is shown in the Frame images picker; each result is a transient status line ("Generated keyframe for shot_00N (comfyui)") and cards do not show which provider made a frame.');
    await page.screenshot({ path: out('b1-frames-generated.png'), fullPage: true });

    // Retry path 1: edit the prompt, save, reload, regenerate (provider returns JPEG).
    await page.getByLabel('Prompt for shot_002').fill(REGEN[0].prompt);
    await page.getByRole('button', { name: /Save Board/ }).click();
    // Wait for the saved effect: an earlier status message's 3.5s clear timer can
    // wipe "Storyboard saved successfully." before it is readable.
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(sceneDir, 'shot_002', 'prompt.json'), 'utf8')).prompt, { timeout: 15_000 }).toBe(REGEN[0].prompt);
    await page.getByTitle('Reload storyboards from disk').click();
    await expect(page.locator('.ms-shot-card').nth(1).locator('.ms-shot-stale-badge')).toBeVisible();
    const card2 = page.locator('.ms-shot-card').nth(1);
    // Hover overlays and stale dimming change brightness, not hue: classify the
    // card's picture by nearest hue among every version this shot has had.
    const hue = ([r, g, b]: number[]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn || 1;
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
    const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    const displayed = async () => {
      await page.mouse.move(4, 700);
      await page.waitForTimeout(400);
      const f = out(`card2-${Date.now()}.png`);
      await card2.locator('img.ms-shot-thumb-img').screenshot({ path: f });
      const m = meanRgb(['-i', f]);
      const versions = [1, 5, 6, 7].filter(i => served[i]).map(i => ({ version: i, gap: hueGap(hue(m), hue(served[i].mean)) }));
      return { mean: m, shows: versions.sort((a, b) => a.gap - b.gap)[0].version };
    };
    const activeFrame = async () => (await page.evaluate(id => window.electron.mediaStoryboardGet!(id), path.basename(projectDir)))
      .result.scenes[0].shots.find((s: any) => s.shotId === 'shot_002').frameImagePath;
    const png2 = path.join(sceneDir, 'shot_002', 'image', 'shot_002.png');
    const jpg2 = path.join(sceneDir, 'shot_002', 'image', 'shot_002.jpg');
    const before = await displayed();
    expect(before.shows).toBe(1);
    await card2.locator('.ms-shot-viewport').hover();
    await card2.getByRole('button', { name: /Regenerate Frame/ }).click();
    await expect.poll(() => served.length, { timeout: 60_000 }).toBe(6);
    await expect(card2.getByRole('button', { name: /Regenerate Frame/ })).toBeEnabled({ timeout: 60_000 });
    expect(sha(jpg2)).toBe(sha(served[5].file)); // provider switched to JPEG: new file beside the old PNG
    const afterFormatChange = await displayed();
    expect(await activeFrame()).toBe(jpg2);
    expect(sha(png2)).toBe(sha(served[1].file)); // earlier version kept, not deleted
    evidence.regenerate1 = { shows: afterFormatChange.shows, staleBadgeAfter: await card2.locator('.ms-shot-stale-badge').count(), activeFrame: jpg2, oldVersionKept: true };
    expect.soft(afterFormatChange.shows, 'card shows regenerate #1').toBe(5);
    expect.soft(evidence.regenerate1.staleBadgeAfter, 'stale badge cleared after regenerating').toBe(0);

    // Retry path 2: provider returns PNG again — rewriting shot_002.png, the exact
    // file:// URL the card first displayed. The older JPEG now sorts first by name.
    await card2.locator('.ms-shot-viewport').hover();
    await card2.getByRole('button', { name: /Regenerate Frame/ }).click();
    await expect.poll(() => served.length, { timeout: 60_000 }).toBe(7);
    await expect(card2.getByRole('button', { name: /Regenerate Frame/ })).toBeEnabled({ timeout: 60_000 });
    expect(sha(png2)).toBe(sha(served[6].file));
    const afterRewrite = await displayed();
    evidence.regenerate2 = { shows: afterRewrite.shows, activeFrame: await activeFrame() };
    expect.soft(evidence.regenerate2.activeFrame, 'board/export use the newest frame, not the name that sorts first').toBe(png2);
    expect.soft(afterRewrite.shows, 'card shows regenerate #2, not the cached original at the same URL').toBe(6);
    if (afterRewrite.shows !== 6) note('findings', `Regenerate #2 rewrote shot_002.png but the card still shows version ${afterRewrite.shows}.`);

    // Retry path 3: PNG again — the identical file path AND identical URL string.
    await card2.locator('.ms-shot-viewport').hover();
    await card2.getByRole('button', { name: /Regenerate Frame/ }).click();
    await expect.poll(() => served.length, { timeout: 60_000 }).toBe(8);
    await expect(card2.getByRole('button', { name: /Regenerate Frame/ })).toBeEnabled({ timeout: 60_000 });
    expect(sha(png2)).toBe(sha(served[7].file));
    const afterSameUrl = await displayed();
    evidence.regenerate3 = { shows: afterSameUrl.shows, activeFrame: await activeFrame() };
    if (afterSameUrl.shows !== 7) note('findings', `Regenerate #3 rewrote shot_002.png (same URL) but the card still shows version ${afterSameUrl.shows} — cached picture.`);
    expect.soft(afterSameUrl.shows, 'card shows regenerate #3 at an unchanged file URL').toBe(7);
    await page.getByTitle('Reload storyboards from disk').click();
    await expect(page.locator('.ms-shot-card')).toHaveCount(5);
    await page.screenshot({ path: out('b2-after-regenerate.png'), fullPage: true });
    expect(JSON.parse(fs.readFileSync(path.join(sceneDir, 'shot_002', 'status.json'), 'utf8'))).toMatchObject({ attempts: 4, frameProvider: 'this-pc' });

    // ── Animatic ─────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /Play Animatic/ }).click();
    const player = page.getByRole('dialog', { name: 'Storyboard Animatic Player' });
    await expect(player).toBeVisible();
    await page.evaluate(() => {
      const w = window as any; w.__animatic = [];
      const snap = () => {
        const d = document.querySelector('.ms-animatic-overlay'); if (!d) return;
        const badge = d.querySelector('.ms-animatic-badge')?.textContent || '';
        const img = d.querySelector('img.ms-animatic-img') as HTMLImageElement | null;
        const last = w.__animatic[w.__animatic.length - 1];
        const playing = /Pause/.test(Array.from(d.querySelectorAll('button')).map(b => b.textContent).join(' '));
        const entry = { t: performance.now(), badge, playing, src: img ? decodeURIComponent(img.src) : null, placeholder: !!d.querySelector('.ms-animatic-placeholder'), sub: d.querySelector('.ms-animatic-subtitles')?.textContent || '' };
        if (!last || last.badge !== entry.badge || last.src !== entry.src || last.playing !== entry.playing) w.__animatic.push(entry);
      };
      snap(); w.__animaticTimer = setInterval(snap, 20);
    });
    await expect(player.locator('.ms-animatic-badge')).toHaveText('Shot 5 of 5', { timeout: (TOTAL + 10) * 1000 });
    await expect(player.getByRole('button', { name: /▶ Play/ })).toBeVisible({ timeout: 10_000 });
    const raw = await page.evaluate(() => { clearInterval((window as any).__animaticTimer); return (window as any).__animatic; });
    const endedAt = raw.find((e: any) => e.badge === 'Shot 5 of 5' && !e.playing)?.t;
    const timeline = raw.filter((e: any, i: number) => i === 0 || e.badge !== raw[i - 1].badge);
    const starts = timeline.map((e: any) => e.t);
    const measured = SHOTS.map((_, i) => ((i < SHOTS.length - 1 ? starts[i + 1] : endedAt) - starts[i]) / 1000);
    evidence.animatic = { timeline: raw, measuredSec: measured.map(n => +n.toFixed(2)), plannedSec: SHOTS.map(s => s.durationSec) };
    expect(timeline.map((e: any) => e.badge)).toEqual(SHOTS.map((_, i) => `Shot ${i + 1} of 5`));
    for (const [i, e] of timeline.entries()) {
      expect(e.placeholder).toBe(false);
      expect(e.src.replace(/\\/g, '/')).toContain(`/shot_00${i + 1}/image/`);
      expect(e.sub).toContain(i === 1 ? SHOTS[1].narration : SHOTS[i].narration);
    }
    for (const [i, m] of measured.entries()) expect.soft(Math.abs(m - SHOTS[i].durationSec), `animatic shot ${i + 1} duration`).toBeLessThan(0.35);
    // Transport controls: Prev from the end, then play to the end without looping.
    await player.getByRole('button', { name: /Prev/ }).click();
    await expect(player.locator('.ms-animatic-badge')).toHaveText('Shot 4 of 5');
    await player.getByRole('button', { name: /▶ Play/ }).click();
    await expect(player.locator('.ms-animatic-badge')).toHaveText('Shot 5 of 5', { timeout: 10_000 });
    await expect(player.getByRole('button', { name: /▶ Play/ })).toBeVisible({ timeout: 10_000 });
    evidence.animatic.scrubControl = await player.locator('input[type=range], [role=slider]').count();
    note('ux', `Animatic: silent (narration shown as subtitle text only), per-shot progress bar only, ${evidence.animatic.scrubControl} scrub controls; plays the selected scene only.`);
    await page.screenshot({ path: out('b3-animatic-end.png') });
    const closeHit = await player.getByRole('button', { name: 'Close Animatic Player' }).evaluate((el: HTMLElement) => {
      const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { topmostIsClose: !!top && (top === el || el.contains(top)), coveredBy: top && top !== el && !el.contains(top) ? top.className : null, rect: [r.x, r.y, r.width, r.height] };
    });
    evidence.animatic.closeHit = closeHit;
    expect.soft(closeHit.topmostIsClose, `Close button reachable (covered by ${closeHit.coveredBy})`).toBe(true);
    await player.getByRole('button', { name: 'Close Animatic Player' }).click();
    await page.getByRole('button', { name: /Play Animatic/ }).click();
    await expect(player.locator('.ms-animatic-badge')).toHaveText('Shot 1 of 5'); // reopening restarts from the top
    await player.getByRole('button', { name: 'Close Animatic Player' }).click();

    // ── Export: first with the default narration engine, as a new user would ─
    const renderAndWait = async () => {
      await page.getByRole('button', { name: /Render Movie/ }).click();
      return Promise.race([
        page.locator('.ms-movie-rendered-banner').waitFor({ state: 'visible', timeout: 300_000 }).then(() => 'ready'),
        board().getByRole('alert').waitFor({ state: 'visible', timeout: 300_000 }).then(async () => `alert: ${await board().getByRole('alert').innerText()}`),
      ]);
    };
    if (evidence.defaults.narrationEngine !== 'kokoro') {
      const firstTry = await renderAndWait();
      evidence.defaultEngineRender = { result: firstTry, blockedNetworkAttempts: await attempts() };
      note('findings', `Render Movie with the default narration engine (${evidence.defaults.narrationEngine}) and Online off → ${firstTry}; blocked network attempts: ${JSON.stringify(evidence.defaultEngineRender.blockedNetworkAttempts)}`);
      await page.screenshot({ path: out('b4-default-engine-render.png'), fullPage: true });
      await page.evaluate(() => window.electron.saveSettings({ narrationEngine: 'kokoro' }));
      await trapNetwork();
    }
    const exportResult = await renderAndWait();
    expect(exportResult).toBe('ready');
    const record = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8')).latestSuccessfulOutput;
    const movie = path.join(projectDir, 'renders', record.filename);
    const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', movie], { windowsHide: true }).toString());
    const video = info.streams.find((s: any) => s.codec_type === 'video');
    const audio = info.streams.find((s: any) => s.codec_type === 'audio');
    expect(video).toMatchObject({ width: 1920, height: 1080 });
    expect(Number(video.width) / Number(video.height)).toBeCloseTo(16 / 9, 3);
    expect(audio).toBeTruthy();
    const duration = Number(info.format.duration);
    expect(Math.abs(duration - TOTAL)).toBeLessThan(0.15);
    expect(Math.abs(Number(video.duration) - Number(audio.duration))).toBeLessThan(0.1);
    // Which fixture is on screen at the middle, first and last moments of each shot?
    const palette = [...SHOTS.map((_s, i) => ({ id: `shot_00${i + 1}`, mean: i === 1 ? served[7].mean : served[i].mean })),
      { id: 'stale shot_002 v1', mean: served[1].mean }, { id: 'stale shot_002 v2', mean: served[5].mean }, { id: 'stale shot_002 v3', mean: served[6].mean }];
    const identify = (t: number) => { const m = meanRgb(['-i', movie], t); return palette.map(p => ({ id: p.id, d: dist(m, p.mean) })).sort((a, b) => a.d - b.d)[0]; };
    let start = 0; const shotsOnScreen: any[] = [];
    for (const [i, s] of SHOTS.entries()) {
      const at = { first: identify(start + 0.1), middle: identify(start + s.durationSec / 2), last: identify(start + s.durationSec - 0.12) };
      shotsOnScreen.push({ shot: `shot_00${i + 1}`, startSec: start, ...at });
      for (const sample of Object.values(at)) expect.soft(sample.id, `export frame at shot ${i + 1}`).toBe(`shot_00${i + 1}`);
      start += s.durationSec;
    }
    // Audio: speech starts with each shot and each shot's tail is quiet (speech shorter than shot).
    const pcm = run(['-i', movie, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
    const rmsAt = (a: number, b: number) => { let p = 0, n = 0; for (let i = Math.floor(a * 16000) * 4; i < Math.floor(b * 16000) * 4 && i < pcm.length; i += 4) { p += pcm.readFloatLE(i) ** 2; n++; } return Math.sqrt(p / Math.max(1, n)); };
    start = 0; const speech: any[] = [];
    for (const [i, s] of SHOTS.entries()) {
      let onset = -1;
      for (let t = start; t < start + s.durationSec; t += 0.02) if (rmsAt(t, t + 0.02) > 0.01) { onset = +(t - start).toFixed(2); break; }
      const tail = rmsAt(start + s.durationSec - 0.3, start + s.durationSec - 0.05);
      speech.push({ shot: i + 1, onsetSec: onset, tailRms: +tail.toFixed(4) });
      expect.soft(onset, `speech onset within shot ${i + 1}`).toBeGreaterThanOrEqual(0);
      expect.soft(onset, `speech onset within shot ${i + 1}`).toBeLessThan(0.6);
      expect.soft(tail, `quiet tail of shot ${i + 1}`).toBeLessThan(0.01);
      start += s.durationSec;
    }
    const captionsRegion = run(['-ss', '1.5', '-i', movie, '-vf', 'crop=1600:220:160:760', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    let white = 0; for (let p = 0; p < captionsRegion.length; p += 3) if (captionsRegion[p] > 215 && captionsRegion[p + 1] > 215 && captionsRegion[p + 2] > 215) white++;
    for (const [i, t] of [0.1, TOTAL - 0.1].entries()) run(['-y', '-ss', String(t), '-i', movie, '-frames:v', '1', out(`export-${i ? 'last' : 'first'}.png`)]);
    evidence.export = { movie, bytes: fs.statSync(movie).size, sha256: sha(movie), duration, video: { w: video.width, h: video.height, codec: video.codec_name, dur: video.duration }, audio: { codec: audio.codec_name, dur: audio.duration }, shotsOnScreen, speech, captionRegionWhitePixels: white };
    await page.screenshot({ path: out('b5-export-ready.png'), fullPage: true });
    const bannerText = await page.locator('.ms-movie-rendered-banner').innerText();
    evidence.export.banner = bannerText;
    expect(await attempts()).toEqual([]);
    await app.close();

    // ── Phase C: restart — the same movie is still the one offered ─────────
    await launch({ COMFY_ENDPOINT: comfy });
    await trapNetwork();
    await openStoryboard();
    await page.getByRole('combobox', { name: 'Select Storyboard Project' }).selectOption({ label: `${TITLE} (5 shots)` });
    await expect(page.locator('.ms-movie-rendered-banner')).toContainText(movie);
    expect(sha(movie)).toBe(evidence.export.sha256);
    const exported = page.getByLabel('Exported storyboard video');
    await expect(exported).toBeVisible();
    await expect.poll(() => exported.evaluate((v: HTMLVideoElement) => ({ w: v.videoWidth, h: v.videoHeight, d: Math.round(v.duration) })), { timeout: 30_000 }).toEqual({ w: 1920, h: 1080, d: TOTAL });
    await exported.evaluate(async (v: HTMLVideoElement) => { await v.play(); });
    await expect.poll(() => exported.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.3);
    await exported.evaluate((v: HTMLVideoElement) => { v.currentTime = v.duration - 0.4; });
    await expect.poll(() => exported.evaluate((v: HTMLVideoElement) => ({ ended: v.ended, loop: v.loop })), { timeout: 15_000 }).toEqual({ ended: true, loop: false });
    await expect(page.getByRole('combobox', { name: 'How to make frame images' })).toHaveValue('this-pc');
    const shotsAfterRestart = await cardIds();
    expect(shotsAfterRestart).toEqual(['shot_001', 'shot_002', 'shot_003', 'shot_004', 'shot_005']);
    evidence.restart = { sameMovie: true, playedToEnd: true, loop: false };
    await exported.scrollIntoViewIfNeeded();
    await page.screenshot({ path: out('c1-reopened.png'), fullPage: true });
    expect(await attempts()).toEqual([]);
    evidence.externalOrPaidAttempts = 0;
  } finally {
    evidence.fixtureRequests = served.map(s => ({ text: s.text, width: s.width, height: s.height, color: s.color }));
    fs.writeFileSync(out('acceptance-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log('STORYBOARD_ACCEPTANCE_EVIDENCE', JSON.stringify(evidence));
    await app?.close().catch(() => {});
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
