/**
 * Regression coverage for the Kokoro narration-duration bug.
 *
 * `buildCaptions` used to always assume a 96kbit/s MP3 to turn narration bytes
 * into seconds. That is only true for the edge engine — Kokoro writes a WAV at
 * a very different effective bitrate, so the estimate came out roughly 4x too
 * long for it, which then fed the real render-time duration-drift QA check and
 * failed every Kokoro-narrated job against its own correct render.
 *
 * The fix measures the real audio file instead of assuming its format. This
 * test proves that end to end through `media_narrate` without needing a real
 * ffmpeg or real Kokoro weights: it mocks the TTS call to return a byte count
 * that would estimate to ~333s under the old assumption, and mocks the ffmpeg
 * probe to report the true (short) duration — the job must end up with the
 * true duration, not the wildly-wrong estimate.
 */

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => require('os').tmpdir()),
    getAppPath: jest.fn(() => require('os').tmpdir()),
  },
}));

jest.mock('../tools/voice', () => ({
  renderNarrationToFile: jest.fn(async (_text: string, outPath: string) => ({
    // A WAV this size is nowhere near a 96kbit/s MP3 of the same duration —
    // exactly the shape of the Kokoro bug (voice.ts writes narration.wav).
    path: outPath.replace(/\.mp3$/, '.wav'),
    bytes: 4_000_000,
    engine: 'kokoro',
  })),
}));

jest.mock('../media-render', () => ({
  findFfmpeg: jest.fn(async () => 'mock-ffmpeg.exe'),
}));

jest.mock('../ffmpeg-setup', () => ({
  findManagedFfmpeg: jest.fn(() => 'managed-ffmpeg.exe'),
}));

const REAL_MEASURED_SECONDS = 12.5;
jest.mock('../media-qa', () => ({
  inspectRender: jest.fn(async () => ({
    hasVideo: false,
    hasAudio: true,
    width: null,
    height: null,
    durationSeconds: REAL_MEASURED_SECONDS,
    meanVolumeDb: -20,
    maxVolumeDb: -10,
    frameSamples: null,
  })),
}));

import { mediaToolHandlers, readJobs, writeJobs, __resetMediaJobsForTests } from '../tools/media';
import { createJob, transition } from '../media-studio';

const call = (name: string, args: any = {}) =>
  mediaToolHandlers[name](args, { executionId: 'narrate-duration-test' } as any);

beforeEach(() => { __resetMediaJobsForTests(); });
afterEach(() => { __resetMediaJobsForTests(); });

describe('narration duration is measured from the real file, not assumed from bytes', () => {
  it('uses the real ffmpeg-measured duration for a Kokoro (WAV) narration', async () => {
    let job = createJob({ title: 'Kokoro duration check', format: 'short' });
    job = transition(job, 'researching', { by: 'test' });
    job = { ...job, script: 'A short script, long enough to narrate.' };
    job = transition(job, 'script_draft', { by: 'test' });
    writeJobs([job]);

    const res: any = await call('media_narrate', { job: job.id, engine: 'kokoro' });
    expect(res.success).toBe(true);

    const updated = readJobs().find(j => j.id === job.id)!;
    // The real measured duration wins...
    expect(updated.durationSeconds).toBe(Math.round(REAL_MEASURED_SECONDS));
    // ...not the ~4x-too-long bitrate estimate (4_000_000 bytes / 96kbit/s ≈ 333s).
    expect(updated.durationSeconds).toBeLessThan(30);
    expect(updated.narratedWith).toBe('kokoro');
  });
});
