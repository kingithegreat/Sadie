import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The trim/splice tools run ffmpeg through execFile and then probe the result
// with the media-qa inspector. Mock both so the success path (and its
// verification) can be exercised without a real ffmpeg or a real video.
jest.mock('child_process', () => ({
  execFile: jest.fn((_bin: string, args: string[], _opts: any, cb: any) => {
    // The output path is the last argument; pretend ffmpeg wrote it.
    fs.writeFileSync(args[args.length - 1], Buffer.from('fake-video'));
    cb(null, '', '');
  }),
}));
jest.mock('../media-render', () => ({ findFfmpeg: async () => 'ffmpeg' }));
jest.mock('../ffmpeg-setup', () => ({ findManagedFfmpeg: () => null }));
jest.mock('../media-qa', () => ({
  inspectRender: jest.fn(async () => ({ hasVideo: true, durationSeconds: 8, frameSamples: null })),
}));

import { videoToolHandlers } from '../tools/media-video';

let dir: string;
let videoPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-video-verify-'));
  videoPath = path.join(dir, 'source.mp4');
  fs.writeFileSync(videoPath, Buffer.from('fake-source'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a trimmed file that decodes with a video stream is accepted', async () => {
  const result = await videoToolHandlers.media_trim_clip(
    { videoPath, startSec: 0, durationSec: 5 },
    { executionId: 'test' } as any,
  );
  expect(result.success).toBe(true);
  const outPath = path.join(dir, 'source-trimmed.mp4');
  expect(fs.existsSync(outPath)).toBe(true);
  expect((result as any).result.path).toBe(outPath);
});

test('a trimmed file with no video stream is refused', async () => {
  const { inspectRender } = require('../media-qa');
  (inspectRender as jest.Mock).mockResolvedValueOnce({ hasVideo: false, durationSeconds: null, frameSamples: null });
  const result = await videoToolHandlers.media_trim_clip(
    { videoPath, startSec: 0, durationSec: 5 },
    { executionId: 'test' } as any,
  );
  expect(result.success).toBe(false);
  expect((result as any).error).toMatch(/not a usable video/i);
});
