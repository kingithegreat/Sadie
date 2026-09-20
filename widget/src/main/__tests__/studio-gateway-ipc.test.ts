const handlers: Record<string, (...args: any[]) => Promise<any>> = {};
const mockFrame = {};
const mockContents = { mainFrame: mockFrame };
const mockMainWindow = {
  isDestroyed: jest.fn(() => false),
  webContents: mockContents,
};
const mockGetMainWindow = jest.fn(() => mockMainWindow);
const mockInvoke = jest.fn(async (_id: string, callback: () => any) => callback());
const mockReadJobs = jest.fn<any[], []>(() => []);
const mockWriteJobs = jest.fn<void, [jobs: any[]]>(() => undefined);
const mockGetMediaJobExportState = jest.fn(async (id: string) => ({ id, sourceRevision: null, outputs: [] }));
const mockTransition = jest.fn((job: any, to: string, opts: any) => ({
  ...job,
  state: to,
  updatedAt: '2026-09-10T00:00:00.000Z',
  history: [...job.history, { at: '2026-09-10T00:00:00.000Z', from: job.state, to, by: opts.by }],
}));
const mockGetSettings = jest.fn(() => ({}));
const mockRequestConfirmationFrom = jest.fn();
const mockGetTool = jest.fn();
const mockGetToolOwner = jest.fn();

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<any>) => {
      handlers[channel] = handler;
    },
  },
}));
jest.mock('../window-manager', () => ({ getMainWindow: () => mockGetMainWindow() }));
jest.mock('../message-router', () => ({ requestConfirmationFrom: mockRequestConfirmationFrom }));
jest.mock('../tools/registry', () => ({ getTool: mockGetTool, getToolOwner: mockGetToolOwner }));
jest.mock('../tools/media', () => ({ readJobs: mockReadJobs, writeJobs: mockWriteJobs, getMediaJobExportState: mockGetMediaJobExportState }));
jest.mock('../media-studio', () => ({
  transition: mockTransition,
  isValidState: jest.requireActual('../media-studio').isValidState,
}));
jest.mock('../config-manager', () => ({ getSettings: mockGetSettings }));
jest.mock('../modules/bundled/studio', () => ({ STUDIO_MODULE_ID: 'homebot.production-studio' }));
jest.mock('../modules/bundled', () => ({
  initializeBundledModules: jest.fn(),
  bundledModuleHost: { invoke: mockInvoke, assertEnabled: jest.fn() },
}));

import { registerBundledStudioIpc } from '../modules/bundled/studio-gateway';

const trustedEvent = () => ({ sender: mockContents, senderFrame: mockFrame });
const invoke = (channel: string, sender: any = trustedEvent(), ...args: any[]) =>
  handlers[`homebot:media:${channel}`](sender, ...args);
const job = {
  id: 'job-1',
  title: 'IPC boundary fixture',
  format: 'short' as const,
  state: 'awaiting_approval' as const,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
  history: [],
};
const advanceJob = { ...job, state: 'idea' as const };

beforeEach(() => {
  jest.clearAllMocks();
  for (const channel of Object.keys(handlers)) delete handlers[channel];
  mockGetMainWindow.mockReturnValue(mockMainWindow);
  mockReadJobs.mockReturnValue([job]);
  mockGetSettings.mockReturnValue({});
  registerBundledStudioIpc();
});

test.each([
  ['export-state', 'job-1'],
  ['advance', 'job-1', 'researching'],
  ['approve', 'job-1'],
  ['reject', 'job-1', false],
  ['movie:colab:list', { projectDir: 'C:\\Users\\owner\\movie' }],
  ['movie:colab:cancel', { projectDir: 'C:\\Users\\owner\\movie', ticketId: 'colab_ticket_shot_1_a' }],
  ['movie:colab:retry', { projectDir: 'C:\\Users\\owner\\movie', ticketId: 'colab_ticket_shot_1_a' }],
] as const)('%s rejects foreign senders before dispatch', async (channel, ...validArgs) => {
  const foreignSenders = [
    {},
    { sender: {}, senderFrame: mockFrame },
    { sender: mockContents, senderFrame: {} },
  ];

  for (const sender of foreignSenders) {
    await expect(invoke(channel, sender, ...validArgs)).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_SENDER',
    });
  }
  expect(mockInvoke).not.toHaveBeenCalled();
});

test('rejects a missing or destroyed main window before dispatch', async () => {
  const validCalls = [
    ['advance', 'job-1', 'researching'],
    ['approve', 'job-1'],
    ['reject', 'job-1', false],
  ] as const;

  for (const configureWindow of [
    () => mockGetMainWindow.mockReturnValue(null as any),
    () => mockGetMainWindow.mockReturnValue({ ...mockMainWindow, isDestroyed: jest.fn(() => true) }),
  ]) {
    configureWindow();
    for (const [channel, ...args] of validCalls) {
      await expect(invoke(channel, trustedEvent(), ...args)).resolves.toMatchObject({
        ok: false,
        code: 'INVALID_SENDER',
      });
    }
  }
  expect(mockInvoke).not.toHaveBeenCalled();
});

test.each([
  ['export-state', []],
  ['export-state', [42]],
  ['export-state', ['job-1', 'extra']],
  ['advance', []],
  ['advance', ['job-1']],
  ['advance', ['job-1', 'researching', 'note', 'extra']],
  ['advance', [123, 'researching']],
  ['advance', ['job-1', 42]],
  ['advance', ['job-1', 'researching', 42]],
  ['approve', []],
  ['approve', ['job-1', 'note', 'movie.mp4', 'extra']],
  ['approve', ['job-1', 'note', 42]],
  ['approve', [123]],
  ['approve', ['job-1', 42]],
  ['reject', []],
  ['reject', ['job-1']],
  ['reject', ['job-1', 'false']],
  ['reject', ['job-1', true, 'note', 'extra']],
  ['reject', [123, false]],
  ['movie:colab:list', []],
  ['movie:colab:list', ['C:\\Users\\owner\\movie']],
  ['movie:colab:cancel', []],
  ['movie:colab:cancel', ['colab_ticket_shot_1_a']],
  ['movie:colab:retry', []],
  ['movie:colab:retry', [{ projectDir: 'x' }, 'extra']],
] as const)('%s rejects malformed arguments before dispatch', async (channel, args) => {
  await expect(invoke(channel, trustedEvent(), ...args)).resolves.toMatchObject({
    ok: false,
    code: 'INVALID_ARGUMENT',
  });
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(mockReadJobs).not.toHaveBeenCalled();
  expect(mockWriteJobs).not.toHaveBeenCalled();
});

test('advance lets an invalid state reach the handler without dispatching a transition', async () => {
  const result = await invoke('advance', trustedEvent(), 'job-1', 'not-a-state');

  expect(result).toEqual({
    ok: false,
    error: '"not-a-state" is not a pipeline stage.',
  });
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockReadJobs).toHaveBeenCalledTimes(1);
  expect(mockTransition).not.toHaveBeenCalled();
  expect(mockWriteJobs).not.toHaveBeenCalled();
});

test('trusted Colab queue requests dispatch inside the Studio module guard', async () => {
  const result = await invoke('movie:colab:list', trustedEvent(), { projectDir: 'Z:\\missing-homebot-project' });

  expect(result).toMatchObject({ ok: false });
  expect(mockInvoke).toHaveBeenCalledWith('homebot.production-studio', expect.any(Function));
});

test('approve treats an empty job id as a missing job rather than an IPC type error', async () => {
  const result = await invoke('approve', trustedEvent(), '');

  expect(result).toEqual({ ok: false, error: 'That video is no longer in the list.' });
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockReadJobs).toHaveBeenCalledTimes(1);
  expect(mockTransition).not.toHaveBeenCalled();
  expect(mockWriteJobs).not.toHaveBeenCalled();
});

test.each([
  ['advance', ['job-1', 'researching'], 'researching', { by: 'studio', note: undefined, publishingEnabled: false }],
  ['approve', ['job-1'], 'approved', { by: 'human', humanDecision: true, note: undefined, publishingEnabled: false }],
  ['reject', ['job-1', true], 'needs_revision', { by: 'human', humanDecision: true, note: undefined, publishingEnabled: false }],
] as const)('%s dispatches validated arguments and persists the transition', async (channel, args, target, expectedOpts) => {
  const sourceJob = channel === 'advance' ? advanceJob : job;
  mockReadJobs.mockReturnValue([sourceJob]);
  const result = await invoke(channel, trustedEvent(), ...args);
  const expectedJob = {
    ...sourceJob,
    state: target,
    history: [{
      at: '2026-09-10T00:00:00.000Z',
      from: sourceJob.state,
      to: target,
      by: expectedOpts.by,
    }],
  };

  expect(result).toEqual({ ok: true, job: expectedJob });
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockReadJobs).toHaveBeenCalledTimes(channel === 'approve' ? 3 : 2);
  expect(mockTransition).toHaveBeenCalledWith(sourceJob, target, expectedOpts);
  expect(mockWriteJobs).toHaveBeenCalledWith([expectedJob]);
});

test('approval of an older displayed path cannot approve a different current movie', async () => {
  mockReadJobs.mockReturnValue([{ ...job, renderPath: 'current.mp4' }]);
  expect(await invoke('approve', trustedEvent(), job.id, undefined, 'old.mp4')).toMatchObject({ ok: false, error: expect.stringMatching(/current movie changed/i) });
  expect(mockTransition).not.toHaveBeenCalled();
  expect(mockWriteJobs).not.toHaveBeenCalled();
});

test('the guarded read-only history channel reaches the real job-state seam', async () => {
  expect(await invoke('export-state', trustedEvent(), 'job-1')).toEqual({ id: 'job-1', sourceRevision: null, outputs: [] });
  expect(mockGetMediaJobExportState).toHaveBeenCalledWith('job-1');
  expect(mockWriteJobs).not.toHaveBeenCalled();
  expect(mockGetTool).not.toHaveBeenCalled();
});
