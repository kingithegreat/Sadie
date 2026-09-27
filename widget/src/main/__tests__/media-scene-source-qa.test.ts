import { preflightScenePictures } from '../media-scene-source-qa';
import { grabFrame } from '../media-qa';

jest.mock('../media-qa', () => ({ ...jest.requireActual('../media-qa'), grabFrame: jest.fn() }));
const grab = grabFrame as jest.Mock;
const detailed = Buffer.from(Array.from({ length: 64 * 64 }, (_, index) => index % 2 ? 220 : 20));
beforeEach(() => { grab.mockReset(); grab.mockResolvedValue(detailed); });

it('accepts detailed sources including cache entries without provenance', async () => {
  await expect(preflightScenePictures('ffmpeg', [{ index: 0, path: 'first.png', source: 'cache' }, { index: 1, path: 'second.png' }])).resolves.toBeUndefined();
  expect(grab.mock.calls.map(call => call[1])).toEqual(['first.png', 'second.png']);
});

it.each([
  ['missing', { index: 1, path: null }],
  ['fallback', { index: 1, path: 'second.png', source: 'fallback-plate' }],
  ['failed', { index: 1, path: 'second.png', error: 'generation failed' }],
])('names the failed scene for %s art instead of substituting a neighbour', async (_name, image) => {
  await expect(preflightScenePictures('ffmpeg', [{ index: 0, path: 'first.png' }, image])).rejects.toThrow(/scene 2.*Replace or regenerate.*previous export is unchanged/);
});

it('rejects cached flat bytes even after provenance has been lost', async () => {
  grab.mockResolvedValue(Buffer.alloc(64 * 64, 40));
  await expect(preflightScenePictures('ffmpeg', [{ index: 0, path: 'cache.png', source: 'cache' }])).rejects.toThrow(/scene 1.*plain color/);
});

it('rejects undecodable source bytes with scene guidance', async () => {
  grab.mockRejectedValue(new Error('could not decode'));
  await expect(preflightScenePictures('ffmpeg', [{ index: 0, path: 'broken.png' }])).rejects.toThrow(/scene 1.*could not decode.*Replace or regenerate/);
});
