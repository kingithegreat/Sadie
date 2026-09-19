const handlers: Record<string, (...args: any[]) => Promise<any>> = {};
const mockReadJobs = jest.fn(() => [{ id: 'draft', title: 'Draft', state: 'idea' }]);
const mockWriteJobs = jest.fn();
jest.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: any) => { handlers[name] = handler; } } }));
jest.mock('../tools/media', () => ({ readJobs: mockReadJobs, writeJobs: mockWriteJobs }));
import { registerStudioIpc } from '../modules/bundled/studio-ipc';
import { createStudioOutputSpec } from '../../shared/media-output';

const invokeTool = jest.fn(async () => ({ success: true, result: {} }));
beforeEach(() => {
  jest.clearAllMocks();
  registerStudioIpc((_channel, handler) => handler, invokeTool, () => undefined);
});

test.each([undefined, false, true])('storyboard IPC preserves the caption choice %s without inventing a default', async burnSubtitles => {
  await handlers['homebot:media:storyboard:render']({}, { projectId: 'film', burnSubtitles });
  expect(invokeTool).toHaveBeenCalledWith({}, 'media_render_storyboard', expect.objectContaining({ projectId: 'film', burnSubtitles }));
});

test('job output control reaches the same model-facing settings handler', async () => {
  const result = await handlers['homebot:media:run']({}, 'draft', 'output', { burnSubtitles: false });
  expect(result.ok).toBe(true);
  expect(invokeTool).toHaveBeenCalledWith({}, 'media_set_output', { job: 'draft', burnSubtitles: false });
});

test('a caption style chosen on a video reaches the same settings handler', async () => {
  const captionStyle = { size: 'large', position: 'middle', font: 'Georgia', color: '#00ffff', background: 'box' };
  const result = await handlers['homebot:media:run']({}, 'draft', 'output', { captionStyle });
  expect(result.ok).toBe(true);
  expect(invokeTool).toHaveBeenCalledWith({}, 'media_set_output', expect.objectContaining({ job: 'draft', captionStyle }));
});

test.each([undefined, false, true])('job creation persists explicit/default captions %s', async burnSubtitles => {
  const result = await handlers['homebot:media:create']({}, { title: 'New production', burnSubtitles });
  expect(result.ok).toBe(true);
  expect(mockWriteJobs).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ title: 'New production', burnSubtitles: burnSubtitles ?? false })]));
});

test('invalid job caption input fails before the store is changed', async () => {
  const result = await handlers['homebot:media:create']({}, { title: 'Invalid', burnSubtitles: 'false' });
  expect(result.ok).toBe(false);
  expect(mockWriteJobs).not.toHaveBeenCalled();
});

test('the format contract crosses real job create, output, storyboard save and render IPC', async () => {
  const outputSpec = createStudioOutputSpec('9:16', 'long', '720p');
  expect((await handlers['homebot:media:create']({}, { title: 'Portrait', outputSpec })).ok).toBe(true);
  expect(mockWriteJobs).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ outputSpec, format: 'long' })]));
  await handlers['homebot:media:run']({}, 'draft', 'output', { outputSpec });
  expect(invokeTool).toHaveBeenLastCalledWith({}, 'media_set_output', expect.objectContaining({ outputSpec }));
  await handlers['homebot:media:storyboard:save']({}, { projectId: 'film', shots: [], outputSpec });
  expect(invokeTool).toHaveBeenLastCalledWith({}, 'media_save_storyboard', expect.objectContaining({ outputSpec }));
  await handlers['homebot:media:storyboard:render']({}, { projectId: 'film', outputSpec });
  expect(invokeTool).toHaveBeenLastCalledWith({}, 'media_render_storyboard', expect.objectContaining({ outputSpec }));
});

test('malformed IPC format requests do not create a job', async () => {
  expect((await handlers['homebot:media:create']({}, { title: 'Bad size', outputSpec: { schemaVersion: 99 } })).ok).toBe(false);
  expect(mockWriteJobs).not.toHaveBeenCalled();
});

test('only the selected retry format crosses job and storyboard IPC, and partial movies remain in the response', async () => {
  await handlers['homebot:media:run']({}, 'draft', 'render', { variantId: 'portrait' });
  expect(invokeTool).toHaveBeenLastCalledWith({}, 'media_render', { job: 'draft', variantId: 'portrait' });
  const variants = [{ variantId: 'landscape', ok: true, moviePath: 'C:/landscape.mp4', jobId: 'review-landscape' },
    { variantId: 'portrait', ok: false, error: 'Portrait stopped' }];
  (invokeTool as jest.Mock).mockResolvedValueOnce({ success: false, error: 'Portrait stopped',
    result: { variants, moviePath: 'C:/landscape.mp4', jobId: 'review-landscape' } });
  const result = await handlers['homebot:media:storyboard:render']({}, { projectId: 'film', variantId: 'portrait' });
  expect(invokeTool).toHaveBeenLastCalledWith({}, 'media_render_storyboard', expect.objectContaining({ projectId: 'film', variantId: 'portrait' }));
  expect(result).toMatchObject({ ok: false, error: 'Portrait stopped', moviePath: 'C:/landscape.mp4', jobId: 'review-landscape', variants });
});

test('storyboard music and encoder choices cross save and render IPC without changing types', async () => {
  await handlers['homebot:media:storyboard:save']({}, {
    projectId: 'film', shots: [], musicEnabled: true, musicVolume: 0.24,
  });
  expect(invokeTool).toHaveBeenLastCalledWith({}, 'media_save_storyboard', expect.objectContaining({
    musicEnabled: true, musicVolume: 0.24,
  }));

  await handlers['homebot:media:storyboard:render']({}, {
    projectId: 'film', musicEnabled: true, musicVolume: 0.24, encoder: 'nvenc',
  });
  expect(invokeTool).toHaveBeenLastCalledWith({}, 'media_render_storyboard', expect.objectContaining({
    musicEnabled: true, musicVolume: 0.24, encoder: 'nvenc',
  }));
});
