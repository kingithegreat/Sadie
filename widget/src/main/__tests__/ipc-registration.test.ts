import { registerIpcHandlers } from '../ipc-handlers';

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
