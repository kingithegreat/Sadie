/**
 * media-pipeline.live.test.ts — the whole Media Studio pipeline, for real.
 *
 * Every unit test of this pipeline mocks the model, the TTS service and
 * ffmpeg — necessarily, in CI. Which means that until this file existed,
 * nothing had ever proven the actual chain: a real feed episode through a real
 * LLM to a real narration MP3 to a real rendered MP4 on disk. "The pipeline
 * works" was an inference from parts, and this codebase's own rulebook says
 * what that is worth (rule 9: ask what reaches it).
 *
 * Run explicitly, never in CI:
 *
 *   cd widget && npx cross-env HOMEBOT_LIVE=1 HOMEBOT_FFMPEG=<path-to-ffmpeg.exe> \
 *     npx jest media-pipeline.live --runInBand --forceExit
 *
 * Requirements: Ollama running with SOME model pulled (set OLLAMA_MODEL, or it
 * uses qwen2.5:0.5b — small on purpose: the point is the chain, not prose
 * quality), internet for msedge-tts, and an ffmpeg binary.
 */

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

jest.mock('../mcp-client', () => ({
  initializeMcpServers: jest.fn().mockResolvedValue(undefined),
  getMcpToolDefs: jest.fn(() => []),
  getMcpToolHandlers: jest.fn(() => ({})),
}));

// One temp userData for the whole run, created before the electron mock closes
// over it. Settings and job files live here; deleted on success, kept on
// failure so the wreckage can be inspected.
const os = require('os');
const path = require('path');
const fsx = require('fs');
const USER_DATA = fsx.mkdtempSync(path.join(os.tmpdir(), 'homebot-live-media-'));

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => USER_DATA),
    getAppPath: jest.fn(() => USER_DATA),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn().mockImplementation(() => ({ webContents: { send: jest.fn() } })),
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import * as fs from 'fs';
import { episodeToJobInput } from '../../shared/podcast-recap';

const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';

/** A realistic episode, as the feed parser would hand it over. */
const EPISODE = {
  title: 'Why Attention Matters',
  summary:
    'Host and guest Dr. Lee discuss how sustained attention shapes what we can ' +
    'learn. They cover why constant notifications fragment thinking, a simple ' +
    'daily practice of working in silence for thirty minutes, and why boredom ' +
    'is a feature rather than a failure of the mind.',
  published: 'Mon, 11 Aug 2026 06:00:00 GMT',
  duration: '52:10',
};

maybe('Media pipeline, live: feed episode → script → narration → rendered mp4', () => {
  jest.setTimeout(420_000);

  beforeAll(() => {
    // The stages read the configured local model from settings.
    const cfgDir = path.join(USER_DATA, 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'user-settings.json'),
      JSON.stringify({ ollamaModel: MODEL, mediaPublishingEnabled: false }),
    );
  });

  test('the whole chain produces a real video file', async () => {
    const { mediaToolHandlers, readJobs } = await import('../tools/media');
    const ctx: any = { executionId: 'live-pipeline' };
    // Jest buffers console output until the test ends, which is useless for
    // diagnosing a hang — so progress goes straight to a file.
    const PROGRESS = process.env.HOMEBOT_LIVE_PROGRESS;
    const mark = (m: string) => { if (PROGRESS) fsx.appendFileSync(PROGRESS, `${new Date().toISOString()} ${m}
`); };

    // 1. The episode enters exactly the way the panel sends it.
    const input = episodeToJobInput('Deep Questions', EPISODE);
    mark('create:start');
    const created: any = await mediaToolHandlers.media_create_job(
      { title: input.title, format: input.format, brief: input.brief }, ctx,
    );
    expect(created.success).toBe(true);
    const jobId = readJobs()[0].id;

    // 2. Script — real Ollama, real model.
    mark('script:start');
    const scripted: any = await mediaToolHandlers.media_write_script({ job: jobId }, ctx);
    expect(scripted.success).toBe(true);
    const afterScript = readJobs()[0];
    expect(afterScript.script && afterScript.script.length).toBeGreaterThan(100);
    // The source-material contract, observed end to end: the script came from
    // an episode about attention, so it should actually be about that.
    expect(afterScript.script!.toLowerCase()).toMatch(/attention|focus|notification|silence|boredom/);

    // 3. Narration — real msedge-tts, real MP3.
    mark('narrate:start');
    const narrated: any = await mediaToolHandlers.media_narrate({ job: jobId }, ctx);
    expect(narrated.success).toBe(true);
    const afterNarrate = readJobs()[0];
    expect(afterNarrate.narrationPath).toBeTruthy();
    expect(fs.existsSync(afterNarrate.narrationPath!)).toBe(true);
    expect(fs.statSync(afterNarrate.narrationPath!).size).toBeGreaterThan(10_000);
    expect(afterNarrate.durationSeconds).toBeGreaterThan(5);

    // 4. Render — real ffmpeg, real MP4.
    //
    // visuals:'backdrop' deliberately. The default 'scenes' path generates one
    // image per caption group through the ONLINE image pipeline, whose queues
    // can run minutes per image — the first run of this test spent its entire
    // 420s budget inside that stage. The product treats scene images as
    // best-effort decoration; the chain this test exists to prove is
    // script → narration → encoded video, and the backdrop path proves it
    // with only local work.
    mark('render:start');
    const rendered: any = await mediaToolHandlers.media_render({ job: jobId, visuals: 'backdrop' }, ctx);
    expect(rendered.success).toBe(true);
    const finalJob = readJobs()[0];
    expect(finalJob.renderPath).toBeTruthy();
    expect(fs.existsSync(finalJob.renderPath!)).toBe(true);
    // A real encoded video, not a stub: even a minute of static slideshow at
    // crf-anything comes out well past this.
    expect(fs.statSync(finalJob.renderPath!).size).toBeGreaterThan(50_000);

    // 5. And it ends at the human gate, where everything must end.
    expect(['render_qa', 'awaiting_approval']).toContain(finalJob.state);

    mark('done');
    console.log('[LIVE] rendered video:', finalJob.renderPath,
      Math.round(fs.statSync(finalJob.renderPath!).size / 1024), 'KB;',
      'narration', afterNarrate.durationSeconds, 's; state', finalJob.state);
  });
});

afterAll(() => {
  // Keep the artefacts on failure for inspection; clean up on success.
  const failed = (expect as any).getState?.().numFailingTests > 0;
  if (!failed) { try { fsx.rmSync(USER_DATA, { recursive: true, force: true }); } catch {} }
  else { console.log('[LIVE] kept working dir for inspection:', USER_DATA); }
});
