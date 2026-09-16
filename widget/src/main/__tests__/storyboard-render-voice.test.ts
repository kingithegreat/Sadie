/**
 * The voice for a storyboard export came only from Settings, defaulting to the
 * online one. With Online off that voice throws ("Online is off…") and the only
 * way out was a trip to Settings — on the export the owner had already started.
 *
 * So the export carries its own choice, and it wins over the saved setting.
 */

const renderStoryboardMovie = jest.fn(async (..._args: any[]) => ({ ok: true, moviePath: 'C:/out/movie.mp4', durationSec: 12, totalShots: 3 }));
jest.mock('../movie/storyboard-renderer', () => ({ renderStoryboardMovie: (...a: any[]) => renderStoryboardMovie(...a) }));
jest.mock('../movie/storyboard-review', () => ({ registerStoryboardReview: jest.fn(async () => ({})) }), { virtual: true });

import { mediaRenderStoryboardHandler, mediaRenderStoryboardDef } from '../tools/media-storyboard';

const call = (args: Record<string, unknown>) => mediaRenderStoryboardHandler({ projectId: 'harbour', ...args } as any, {} as any);

beforeEach(() => renderStoryboardMovie.mockClear());

test('the voice chosen for this export reaches the renderer', async () => {
  await call({ narrationEngine: 'kokoro' });
  expect(renderStoryboardMovie).toHaveBeenCalledWith(expect.objectContaining({ narrationEngine: 'kokoro' }));

  renderStoryboardMovie.mockClear();
  await call({ narrationEngine: 'edge' });
  expect(renderStoryboardMovie).toHaveBeenCalledWith(expect.objectContaining({ narrationEngine: 'edge' }));
});

test('no choice means the saved setting still decides', async () => {
  await call({});
  expect(renderStoryboardMovie).toHaveBeenCalledWith(expect.not.objectContaining({ narrationEngine: expect.anything() }));
});

test('a voice the app does not have is ignored rather than passed down', async () => {
  await call({ narrationEngine: 'elevenlabs' });
  expect(renderStoryboardMovie).toHaveBeenCalledWith(expect.not.objectContaining({ narrationEngine: expect.anything() }));
});

test('the tool offers the choice to chat as well, with both voices', () => {
  const param = (mediaRenderStoryboardDef.parameters as any).properties.narrationEngine;
  expect(param.enum.sort()).toEqual(['edge', 'kokoro']);
  expect(param.description).toMatch(/no internet/i);
});
