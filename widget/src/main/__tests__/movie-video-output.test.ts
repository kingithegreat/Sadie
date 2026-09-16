import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// `image-output` imports electron's nativeImage at module load; the video
// validator never calls it, but the import must resolve.
jest.mock('electron', () => ({ nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }) } }));

import { validateMovieVideoFiles } from '../movie/image-output';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-video-output-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const goodFacts = {
  hasVideo: true,
  durationSeconds: 8,
  frameSamples: [{ stdDev: 20 }, { stdDev: 30 }, { stdDev: 25 }],
};

const writeVideo = (name = 'shot_01.mp4') => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from('fake-video-bytes'));
  return file;
};

test('accepts a video that decodes with a video stream and real content', async () => {
  const file = writeVideo();
  const inspect = jest.fn(async () => goodFacts);
  await expect(validateMovieVideoFiles(dir, [file], { ffmpeg: 'ffmpeg', inspect })).resolves.toBeUndefined();
  expect(inspect).toHaveBeenCalledWith('ffmpeg', file);
});

test('rejects when there are no output files', async () => {
  await expect(validateMovieVideoFiles(dir, [], { ffmpeg: 'ffmpeg', inspect: jest.fn() })).rejects.toThrow(/No video output/i);
});

test('rejects a file that leaves the shot folder', async () => {
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.mp4`);
  fs.writeFileSync(outside, Buffer.from('x'));
  try {
    await expect(
      validateMovieVideoFiles(dir, [outside], { ffmpeg: 'ffmpeg', inspect: jest.fn() }),
    ).rejects.toThrow(/shot folder/i);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

test('rejects an empty file', async () => {
  const file = path.join(dir, 'empty.mp4');
  fs.writeFileSync(file, Buffer.alloc(0));
  await expect(validateMovieVideoFiles(dir, [file], { ffmpeg: 'ffmpeg', inspect: jest.fn() })).rejects.toThrow(/usable file/i);
});

test('rejects when ffmpeg is not set up', async () => {
  const file = writeVideo();
  await expect(validateMovieVideoFiles(dir, [file], { ffmpeg: null })).rejects.toThrow(/video engine/i);
});

test('rejects when the file has no video stream', async () => {
  const file = writeVideo();
  const inspect = jest.fn(async () => ({ hasVideo: false, durationSeconds: 8, frameSamples: null }));
  await expect(validateMovieVideoFiles(dir, [file], { ffmpeg: 'ffmpeg', inspect })).rejects.toThrow(/no video stream/i);
});

test('rejects when the video has no measurable duration', async () => {
  const file = writeVideo();
  const inspect = jest.fn(async () => ({ hasVideo: true, durationSeconds: null, frameSamples: null }));
  await expect(validateMovieVideoFiles(dir, [file], { ffmpeg: 'ffmpeg', inspect })).rejects.toThrow(/duration/i);
});

test('rejects a flat placeholder video', async () => {
  const file = writeVideo();
  const inspect = jest.fn(async () => ({ hasVideo: true, durationSeconds: 8, frameSamples: [{ stdDev: 0.1 }, { stdDev: 0.2 }] }));
  await expect(validateMovieVideoFiles(dir, [file], { ffmpeg: 'ffmpeg', inspect })).rejects.toThrow(/flat placeholder/i);
});
