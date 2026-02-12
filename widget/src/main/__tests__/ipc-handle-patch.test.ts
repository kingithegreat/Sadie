import { applyIpcHandlePatch } from '../../main/utils/ipc-handle-patch';

// Mock electron.ipcMain.handle to verify underlying original is called only once
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  app: { whenReady: jest.fn(() => Promise.resolve()), getPath: jest.fn() },
  BrowserWindow: jest.fn()
}));

describe('applyIpcHandlePatch', () => {
  it('prevents duplicate ipcMain.handle registrations', () => {
    const electron = require('electron');
    const mockHandle = electron.ipcMain.handle as jest.Mock;

    // Apply the patch which wraps ipcMain.handle
    applyIpcHandlePatch();

    // First registration should call through to the underlying mocked handle
    (electron.ipcMain.handle as any)('test:chan', () => 'ok');
    expect(mockHandle).toHaveBeenCalledTimes(1);

    // Second registration for same channel should be ignored by the wrapper
    (electron.ipcMain.handle as any)('test:chan', () => 'different');
    expect(mockHandle).toHaveBeenCalledTimes(1);

    // Registering a different channel still forwards to underlying handle
    (electron.ipcMain.handle as any)('another:chan', () => 'ok');
    expect(mockHandle).toHaveBeenCalledTimes(2);
  });
});
