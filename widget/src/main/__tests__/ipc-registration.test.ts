import { registerIpcHandlers } from '../ipc-handlers';

// Capture IPC handlers while still using the shared Electron mock (app, BrowserWindow, etc.).
const handles: Record<string, Function> = {};
jest.mock('electron', () => {
  const { mockApp, mockBrowserWindow } = require('./jest-setup');

  const browserWindowFactory = jest.fn(mockBrowserWindow as any);
  (browserWindowFactory as any).getAllWindows = (mockBrowserWindow as any).getAllWindows;

  return {
    app: mockApp,
    ipcMain: {
      handle: (channel: string, handler: Function) => {
        handles[channel] = handler;
      },
      on: jest.fn(),
      removeHandler: jest.fn(),
    },
    BrowserWindow: browserWindowFactory,
    dialog: {
      showMessageBox: jest.fn(() => Promise.resolve({ response: 0 })),
    },
    shell: {
      openExternal: jest.fn(() => Promise.resolve()),
    },
    nativeTheme: {
      themeSource: 'system',
    },
  };
});

describe('IPC registration', () => {
  beforeEach(() => {
    // reset captured handles for each test
    for (const k of Object.keys(handles)) delete handles[k];
    // reset global idempotency flag used by registerIpcHandlers
    // @ts-ignore
    (global as any).__sadie_ipc_registered = false;
  });

  it('registers sadie:check-connection and is idempotent', () => {
    registerIpcHandlers();
    expect(handles['sadie:check-connection']).toBeDefined();

    // Second call should be a no-op (idempotent), not throw
    expect(() => registerIpcHandlers()).not.toThrow();
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

    const res = await handles['sadie:check-connection']();
    expect(res).toBeDefined();
    expect(res.n8n).toBe('online');
    expect(res.ollama).toBe('offline');

    get.mockRestore();
  });
});
