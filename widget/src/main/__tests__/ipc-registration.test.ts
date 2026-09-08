import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ipc-registration-'));
const mockEnsureWebFetchWorkflow = jest.fn<Promise<void>, []>(() => Promise.resolve());

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

const { registerIpcHandlers } = require('../ipc-handlers') as typeof import('../ipc-handlers');

describe('IPC registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
