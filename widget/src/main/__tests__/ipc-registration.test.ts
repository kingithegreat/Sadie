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
});
