/** @jest-environment node */
import { ModuleContractError } from '../../shared/modules/contracts';

const mockHandlers: Record<string, Function> = {};
const mockFrame = {};
const mockContents = { mainFrame: mockFrame };
let mockEnabled = true;
const mockAssert = () => {
  if (!mockEnabled) throw new ModuleContractError('MODULE_UNAVAILABLE', 'Enable Production Studio.');
};

const mockUpload = jest.fn();
jest.mock('../media-youtube-uploader', () => ({
  YouTubeUploader: jest.fn().mockImplementation(() => ({
    upload: mockUpload,
  })),
}));

jest.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: Function) => { mockHandlers[name] = handler; } },
  shell: { openExternal: jest.fn() },
}));

jest.mock('../window-manager', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: mockContents }),
}));

jest.mock('../message-router', () => ({ requestConfirmationFrom: jest.fn() }));
jest.mock('../tools/registry', () => ({ getTool: jest.fn(), getToolOwner: jest.fn() }));
jest.mock('../config-manager', () => ({
  loadIntegrationSecret: jest.fn(),
  saveIntegrationSecret: jest.fn(),
  getSettings: jest.fn(() => ({ mediaPublishingEnabled: true, allowCloud: true })),
}));

let mockOnlineThrows = false;
jest.mock('../utils/provider-network-policy', () => ({
  assertProviderOnlineAccess: jest.fn((provider: string) => {
    if (mockOnlineThrows) throw new Error(`${provider} needs Online access.`);
  }),
  requestProviderEndpoint: jest.fn(),
}));

jest.mock('../modules/bundled/studio', () => ({ STUDIO_MODULE_ID: 'homebot.production-studio' }));
jest.mock('../modules/bundled', () => ({
  initializeBundledModules: jest.fn(),
  bundledModuleHost: {
    assertEnabled: () => mockAssert(),
    invoke: async (_id: string, callback: Function) => {
      mockAssert();
      return callback();
    },
  },
}));

import { registerBundledStudioIpc } from '../modules/bundled/studio-gateway';

const event = { sender: mockContents, senderFrame: mockFrame };
const invokeUpload = (sender: any = event, ...args: any[]) =>
  mockHandlers['homebot:media:youtube:upload'](sender, ...args);

describe('homebot:media:youtube:upload IPC', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnabled = true;
    mockOnlineThrows = false;
    registerBundledStudioIpc();
  });

  test('requires main frame sender', async () => {
    const badSenders = [
      {},
      { sender: {}, senderFrame: mockFrame },
      { sender: mockContents, senderFrame: {} },
    ];
    for (const s of badSenders) {
      const res = await invokeUpload(s, 'job_123', { title: 'Test Video' });
      expect(res).toMatchObject({ ok: false, code: 'INVALID_SENDER' });
    }
  });

  test('rejects invalid arguments via signature validator', async () => {
    // Missing arguments
    expect(await invokeUpload(event)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    // Non-string jobId
    expect(await invokeUpload(event, 12345, { title: 'Test' })).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    // Non-object metadata
    expect(await invokeUpload(event, 'job_123', 'not-an-object')).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    // Extra unexpected arguments
    expect(await invokeUpload(event, 'job_123', { title: 'Test' }, 'extra')).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });

  test('refuses when Studio module is disabled', async () => {
    mockEnabled = false;
    const res = await invokeUpload(event, 'job_123', { title: 'Test' });
    expect(res).toMatchObject({ ok: false, code: 'MODULE_UNAVAILABLE' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('passes error when Online access is denied', async () => {
    mockOnlineThrows = true;
    const res = await invokeUpload(event, 'job_123', { title: 'Test' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/needs Online access/i);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('delegates to YouTubeUploader and returns success result', async () => {
    mockUpload.mockResolvedValueOnce({
      ok: true,
      videoId: 'vid_yt_456',
      url: 'https://youtu.be/vid_yt_456',
      publishedAt: '2026-09-12T10:00:00Z',
    });

    const metadata = { title: 'My Great Video', privacyStatus: 'unlisted' };
    const res = await invokeUpload(event, 'job_123', metadata);

    expect(res).toEqual({
      ok: true,
      videoId: 'vid_yt_456',
      url: 'https://youtu.be/vid_yt_456',
      publishedAt: '2026-09-12T10:00:00Z',
    });
    expect(mockUpload).toHaveBeenCalledWith('job_123', metadata);
  });
});
