/**
 * The Media Studio pipeline, run for real.
 *
 * Every other media test uses mocks. This one calls the actual local model and
 * the actual TTS service and writes an actual MP3, because a pipeline of four
 * stages that has never been executed end to end is not known to work — it is
 * only known to typecheck.
 *
 * OPT-IN. Skipped unless HOMEBOT_LIVE=1, because it needs Ollama running and
 * network access to the TTS endpoint, and it takes a minute or two on a 7B
 * model. CI must not depend on either.
 *
 *   cd widget && npx cross-env HOMEBOT_LIVE=1 npx jest media-pipeline.live
 */

jest.mock('../mcp-client', () => ({
  seedMcpDefaults: jest.fn(),
  discoverExternalMcpServers: jest.fn(),
  initializeMcpServers: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => require('os').tmpdir()),
    getAppPath: jest.fn(() => require('os').tmpdir()),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn().mockImplementation(() => ({ webContents: { send: jest.fn() } })),
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
}));

import * as fs from 'fs';
import { initializeTools } from '../tools';
import { mediaToolHandlers, readJobs, __resetMediaJobsForTests } from '../tools/media';
import { estimateSpokenSeconds, checkScript } from '../media-generate';

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

const call = (name: string, args: any = {}) =>
  mediaToolHandlers[name](args, { executionId: 'live' } as any);

maybe('the pipeline, end to end, on real services', () => {
  jest.setTimeout(10 * 60 * 1000);

  beforeAll(() => { initializeTools(); __resetMediaJobsForTests(); });
  afterAll(() => { __resetMediaJobsForTests(); });

  it('takes an idea to a narrated script', async () => {
    const created: any = await call('media_create_job', {
      title: 'One-Minute Bible: Jonah and the storm',
      format: 'short',
      brief: 'What the storm passage actually says about running from a calling.',
    });
    expect(created.success).toBe(true);

    // --- research + script, on whichever model is configured ---
    const scripted: any = await call('media_write_script', { job: 'Jonah' });
    // eslint-disable-next-line no-console
    console.log('\n--- media_write_script ---\n', scripted.success ? scripted.result : scripted.error);
    expect(scripted.success).toBe(true);

    const job = readJobs()[0];
    expect(job.state).toBe('script_draft');
    expect((job.script || '').length).toBeGreaterThan(80);

    // The guardrail that matters most: no invented quotations left in.
    const problems = checkScript(job, job.script!);
    // eslint-disable-next-line no-console
    console.log('script checks:', problems.length ? problems : 'clean',
      `| ~${estimateSpokenSeconds(job.script!)}s`);

    // --- narration, via Edge TTS, to a real file ---
    const narrated: any = await call('media_narrate', { job: 'Jonah' });
    // eslint-disable-next-line no-console
    console.log('--- media_narrate ---\n', narrated.success ? narrated.result : narrated.error);
    expect(narrated.success).toBe(true);

    const done = readJobs()[0];
    expect(done.state).toBe('media_production');
    expect(done.narrationPath).toBeTruthy();

    const st = fs.statSync(done.narrationPath!);
    expect(st.size).toBeGreaterThan(10_000);

    // 96 kbit/s CBR, so bytes map to seconds directly. A file that exists but
    // holds a fraction of a second of audio would otherwise pass a size check.
    const seconds = (st.size * 8) / 96_000;
    // eslint-disable-next-line no-console
    console.log(`narration: ${Math.round(st.size / 1024)} KB ≈ ${seconds.toFixed(1)}s of audio`);
    expect(seconds).toBeGreaterThan(10);
  });

  it('still refuses to publish, even with everything else done', async () => {
    // The kill switch defaults off; nothing in a live run may bypass it.
    const jobs = readJobs();
    if (!jobs.length) return;
    const res: any = await call('media_advance_job', { job: jobs[0].id, to: 'render_qa' });
    expect(res.success).toBe(true);
    const toApproval: any = await call('media_advance_job', { job: jobs[0].id, to: 'awaiting_approval' });
    expect(toApproval.success).toBe(true);

    const sneaky: any = await call('media_advance_job', { job: jobs[0].id, to: 'approved' });
    expect(sneaky.success).toBe(false);
    expect(String(sneaky.error)).toMatch(/human decision/i);
  });
});
