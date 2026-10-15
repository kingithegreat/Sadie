import { preflightStoryboardPictures } from '../movie/storyboard-source-qa';
import { grabFrame } from '../media-qa';
import { storyboardFileDigest } from '../movie/storyboard-export-state';
import type { AssembledScene } from '../movie/storyboard-assembly';

jest.mock('../movie/storyboard-export-state', () => ({ storyboardFileDigest: jest.fn() }));
jest.mock('../media-qa', () => ({ ...jest.requireActual('../media-qa'), grabFrame: jest.fn() }));
const digest = 'a'.repeat(64);
const detailed = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
const scene = (ack?: string): AssembledScene[] => [{ sceneId: 'scene_02', shots: [
  { shotId: 'shot_001', order: 1, prompt: 'Scene', framing: 'wide', lens: '35mm', movement: 'static',
    durationSec: 2, narration: 'Speech', status: 'IMAGE_GENERATED', frameImagePath: 'picture.png', frameStale: false,
    plainBackgroundSha256: ack },
] }];

beforeEach(() => {
  (storyboardFileDigest as jest.Mock).mockResolvedValue(digest);
  (grabFrame as jest.Mock).mockResolvedValue(detailed);
});

test('a detailed picture keeps the normal final-picture guard', async () => {
  expect(await preflightStoryboardPictures('ffmpeg', scene())).toEqual({ allPicturesPlain: false });
});

test('a blank shot in a detailed movie fails with its scene/shot before overlays', async () => {
  const scenes = scene();
  scenes[0].shots.push({ ...scenes[0].shots[0], shotId: 'shot_002' });
  (grabFrame as jest.Mock).mockResolvedValueOnce(detailed).mockResolvedValueOnce(Buffer.alloc(4096, 128));
  await expect(preflightStoryboardPictures('ffmpeg', scenes)).rejects.toThrow('scene_02 / shot_002');
});

test('a title overlay and narration do not grant plain-background permission', async () => {
  const scenes = scene();
  scenes[0].shots[0].textCard = { heading: 'Title', position: 'middle' };
  (grabFrame as jest.Mock).mockResolvedValue(Buffer.alloc(4096));
  await expect(preflightStoryboardPictures('ffmpeg', scenes)).rejects.toThrow('Use a plain background for this shot');
});

test('explicit intent permits its exact plain picture, including an all-plain board', async () => {
  (grabFrame as jest.Mock).mockResolvedValue(Buffer.alloc(4096));
  expect(await preflightStoryboardPictures('ffmpeg', scene(digest))).toEqual({ allPicturesPlain: true });
});

test('replacing picture bytes invalidates previous permission', async () => {
  (grabFrame as jest.Mock).mockResolvedValue(Buffer.alloc(4096));
  (storyboardFileDigest as jest.Mock).mockResolvedValue('b'.repeat(64));
  await expect(preflightStoryboardPictures('ffmpeg', scene(digest))).rejects.toThrow('Any previous export is unchanged');
});

test('an undecodable source fails closed with the shot identity', async () => {
  (grabFrame as jest.Mock).mockRejectedValue(new Error('Cannot decode picture'));
  await expect(preflightStoryboardPictures('ffmpeg', scene(digest))).rejects.toThrow('scene_02 / shot_001: Cannot decode picture');
});
