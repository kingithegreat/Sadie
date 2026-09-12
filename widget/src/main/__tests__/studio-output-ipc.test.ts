const handlers: Record<string, (...args: any[]) => Promise<any>> = {};
const mockReadJobs = jest.fn(() => [{ id: 'draft', title: 'Draft', state: 'idea' }]);
const mockWriteJobs = jest.fn();
jest.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: any) => { handlers[name] = handler; } } }));
jest.mock('../tools/media', () => ({ readJobs: mockReadJobs, writeJobs: mockWriteJobs }));
import { registerStudioIpc } from '../modules/bundled/studio-ipc';

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
