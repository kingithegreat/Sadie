import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ipc-registration-'));
const mockEnsureWebFetchWorkflow = jest.fn<Promise<void>, []>(() => Promise.resolve());
const mockGetMediaCapabilityRegistry = jest.fn();
const mockClipboardWriteText = jest.fn();
const mockWebContents = { mainFrame: {} };
const mockMainWindow = { isDestroyed: () => false, webContents: mockWebContents };

// Minimal mock of electron's ipcMain to capture registrations
const handles: Record<string, Function> = {};
jest.mock('electron', () => {
  return {
    ipcMain: {
      handle: (channel: string, handler: Function) => {
        handles[channel] = handler;
      },
      on: jest.fn(),
    },
    BrowserWindow: jest.fn(),
    clipboard: { writeText: (text: string) => mockClipboardWriteText(text) },
    app: {
      isPackaged: false,
      getPath: (name: string) => name === 'userData' ? mockUserData : path.join(mockUserData, name),
    },
  };
});

jest.mock('../n8n-api', () => ({
  ...jest.requireActual('../n8n-api'),
  ensureWebFetchWorkflow: () => mockEnsureWebFetchWorkflow(),
}));
jest.mock('../provider-capability-registry', () => ({
  getMediaCapabilityRegistry: (options: unknown) => mockGetMediaCapabilityRegistry(options),
}));

const { registerIpcHandlers } = require('../ipc-handlers') as typeof import('../ipc-handlers');

describe('IPC registration', () => {
  it('Image panel status reaches main disclosure and generation uses the sender confirmation bridge', async () => {
    const licensing = require('../licensing');
    const web = require('../tools/web');
    const router = require('../message-router');
    const tier = jest.spyOn(licensing, 'getCurrentTier').mockReturnValue('pro');
    const route = { localFirst: true, onlineAllowed: true, onlineProvider: { paid: true, label: 'Google · paid', cost: 'Google charges this account.' }, paidFallback: null };
    const status = jest.spyOn(web, 'describeImageGenerationRoute').mockReturnValue(route);
    const confirmation = jest.spyOn(router, 'requestConfirmationFrom').mockResolvedValue(false);
    const generate = jest.spyOn(web.webToolHandlers, 'image_generate').mockImplementation(async (_args: unknown, context: any) => {
      expect(await context.requestConfirmation('Review paid provider')).toBe(false);
      return { success: false, code: 'PAID_CONFIRMATION_REQUIRED', error: 'Paid image was declined.' };
    });
    try {
      registerIpcHandlers();
      const sender = { id: 19 };
      await expect(handles['homebot:automation:image:generate']({ sender }, { action: 'status', payload: { backend: 'hybrid' } }))
        .resolves.toEqual({ status: 'ready', route });
      expect(status).toHaveBeenCalledWith('hybrid');
      expect(generate).not.toHaveBeenCalled();
      await expect(handles['homebot:automation:image:generate']({ sender }, { action: 'generate', payload: { prompt: 'a cat', backend: 'cloud' } }))
        .resolves.toMatchObject({ status: 'failure', error: { code: 'PAID_CONFIRMATION_REQUIRED' } });
      expect(confirmation).toHaveBeenCalledWith(sender, 'Review paid provider');
      expect(generate).toHaveBeenCalledTimes(1);
    } finally { tier.mockRestore(); status.mockRestore(); confirmation.mockRestore(); generate.mockRestore(); }
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockClipboardWriteText.mockReset();
    // reset captured handles for each test
    for (const k of Object.keys(handles)) delete handles[k];
    // reset global idempotency flag used by registerIpcHandlers
    // @ts-ignore
    (global as any).__homebot_ipc_registered = false;
  });

  afterAll(() => {
    fs.rmSync(mockUserData, { recursive: true, force: true });
  });

  it('registers homebot:check-connection and is idempotent', () => {
    registerIpcHandlers();
    expect(handles['homebot:check-connection']).toBeDefined();

    // Second call should be a no-op (idempotent), not throw
    expect(() => registerIpcHandlers()).not.toThrow();
  });

  it('registers homebot:get-env handler', () => {
    registerIpcHandlers();
    expect(handles['homebot:get-env']).toBeDefined();
  });

  it('registers reachable local dictation start and cancellation handlers', () => {
    registerIpcHandlers();
    expect(handles['homebot:start-speech-recognition']).toBeDefined();
    expect(handles['homebot:stop-speech-recognition']).toBeDefined();
    expect(handles['homebot:stop-speech-recognition']({ sender: { id: 99 } })).toEqual({ success: true });
  });

  it('registers and reaches the connected-account media registry', async () => {
    const registry = { accounts: [], imageModels: [], videoModels: [], refreshedAt: '2026-09-20T00:00:00.000Z' };
    mockGetMediaCapabilityRegistry.mockResolvedValue(registry);
    registerIpcHandlers();
    expect(handles['homebot:list-media-capabilities']).toBeDefined();
    await expect(handles['homebot:list-media-capabilities']({}, { refresh: true }))
      .resolves.toEqual({ success: true, registry });
    expect(mockGetMediaCapabilityRegistry).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it('homebot:get-env handler returns environment info', async () => {
    registerIpcHandlers();
    const result = await handles['homebot:get-env']();
    expect(result).toBeDefined();
    expect(typeof result.isE2E).toBe('boolean');
    expect(typeof result.userDataPath).toBe('string');
  });

  it('check-connection handler returns structured status', async () => {
    registerIpcHandlers();
    // Mock axios to simulate n8n online and ollama offline
    const axios = require('axios');
    const get = jest.spyOn(axios, 'get').mockImplementation((...args: any[]) => {
      const url = args[0] as string;
      if (url.includes('/healthz')) return Promise.resolve({ status: 200 });
      if (url.includes('11434')) return Promise.reject(new Error('conn refused'));
      return Promise.resolve({ status: 200 });
    });

    const res = await handles['homebot:check-connection']();
    expect(res).toBeDefined();
    expect(res.n8n).toBe('online');
    expect(res.ollama).toBe('offline');
    expect(mockEnsureWebFetchWorkflow).toHaveBeenCalledTimes(1);

    get.mockRestore();
  });

  it('registers clipboard IPC and writes only for the trusted main frame', async () => {
    registerIpcHandlers(mockMainWindow as any);
    const trustedEvent = { sender: mockWebContents, senderFrame: mockWebContents.mainFrame };
    await expect(handles['homebot:clipboard-write'](trustedEvent, 'copied from chat'))
      .resolves.toEqual({ success: true });
    expect(mockClipboardWriteText).toHaveBeenCalledWith('copied from chat');

    const foreignEvent = { sender: {}, senderFrame: mockWebContents.mainFrame };
    await expect(handles['homebot:clipboard-write'](foreignEvent, 'should not write'))
      .resolves.toMatchObject({ success: false });
    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);

    const childFrameEvent = { sender: mockWebContents, senderFrame: {} };
    await expect(handles['homebot:clipboard-write'](childFrameEvent, 'should not write'))
      .resolves.toMatchObject({ success: false });
    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
  });

  it('refuses non-string clipboard input without writing', async () => {
    registerIpcHandlers(mockMainWindow as any);
    const trustedEvent = { sender: mockWebContents, senderFrame: mockWebContents.mainFrame };
    const result = await handles['homebot:clipboard-write'](trustedEvent, { nope: true });
    expect(result).toEqual({ success: false, error: 'Clipboard text must be a string' });
    expect(mockClipboardWriteText).not.toHaveBeenCalled();
  });

  it('reports clipboard write failures instead of throwing', async () => {
    registerIpcHandlers(mockMainWindow as any);
    mockClipboardWriteText.mockImplementationOnce(() => { throw new Error('clipboard is locked'); });
    const trustedEvent = { sender: mockWebContents, senderFrame: mockWebContents.mainFrame };
    await expect(handles['homebot:clipboard-write'](trustedEvent, 'x'))
      .resolves.toEqual({ success: false, error: 'clipboard is locked' });
  });
});
