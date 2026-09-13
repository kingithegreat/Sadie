import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createJob, type MediaJob } from '../media-studio';
import { assertMediaJobReviewable, mediaFileDigest, readMediaJobExportState } from '../media-job-export-state';

let dir: string;
let job: MediaJob;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-job-export-state-'));
  job = createJob({ title: 'History boundary' });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function output(filename = 'good.mp4') {
  const file = path.join(dir, filename);
  fs.writeFileSync(file, 'verified movie bytes');
  const metadata = { exportId: filename, filename, createdAt: job.createdAt, sourceSavedAt: job.updatedAt,
    durationSeconds: 3, burnSubtitles: false, outputSpec: job.outputSpec!, sourceRevision: 'a'.repeat(64),
    sha256: await mediaFileDigest(file) };
  fs.writeFileSync(`${file}.json`, JSON.stringify(metadata));
  return { file, metadata };
}

test('a changed movie is Unknown and cannot use its old verification to pass review', async () => {
  const { file, metadata } = await output();
  expect((await readMediaJobExportState(job, dir)).outputs).toHaveLength(1);
  fs.writeFileSync(file, 'replaced movie bytes');
  const state = await readMediaJobExportState(job, dir);
  expect(state.outputs).toHaveLength(0);
  expect(state.untrackedOutputs).toEqual([{ filename: 'good.mp4', moviePath: file }]);
  expect(state.warning).toMatch(/cannot be verified/);
  await expect(assertMediaJobReviewable({ ...job, renderPath: file, renderedOutput: metadata })).rejects.toThrow(/movie changed/);
});

test('a real legacy movie is reachable but never assigned invented provenance', async () => {
  const file = path.join(dir, 'video.mp4');
  fs.writeFileSync(file, 'legacy bytes');
  const state = await readMediaJobExportState({ ...job, renderPath: file }, dir);
  expect(state.sourceRevision).toBeNull();
  expect(state.outputs).toEqual([]);
  expect(state.untrackedOutputs).toEqual([{ filename: 'video.mp4', moviePath: file }]);
});

test('corrupt and escaping metadata cannot introduce an output or remove existing files', async () => {
  const { file, metadata } = await output();
  fs.writeFileSync(`${file}.json`, JSON.stringify({ ...metadata, filename: '../outside.mp4' }));
  fs.writeFileSync(path.join(dir, 'corrupt.mp4.json'), '{unfinished');
  fs.writeFileSync(path.join(dir, 'video-attempt.rejected.mp4'), 'failed QA');
  fs.writeFileSync(path.join(dir, 'video.rendering-attempt.mp4'), 'partial encode');
  const state = await readMediaJobExportState(job, dir);
  expect(state.outputs).toHaveLength(0);
  expect(state.untrackedOutputs).toEqual([{ filename: 'good.mp4', moviePath: file }]);
  expect(state.warning).toMatch(/unreadable/);
  expect(fs.readdirSync(dir)).toHaveLength(5);
});

test('review refuses a stopped attempt even when an older movie exists', async () => {
  const { file, metadata } = await output();
  await expect(assertMediaJobReviewable({ ...job, renderPath: file, renderedOutput: metadata,
    latestExportAttempt: { id: 'stopped', status: 'interrupted', sourceRevision: null, startedAt: job.createdAt } }, file))
    .rejects.toThrow(/did not finish/);
});

test('an immutable storyboard review keeps its own source contract and exact file check', async () => {
  const { file, metadata } = await output();
  const reviewJob = { ...job, id: 'sbexport_example', renderPath: file, renderedOutput: metadata };
  await expect(assertMediaJobReviewable(reviewJob, file)).resolves.toBeUndefined();
  await expect(assertMediaJobReviewable(reviewJob, 'different.mp4')).rejects.toThrow(/current movie changed/);
});
