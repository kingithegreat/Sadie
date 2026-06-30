// Mock Electron modules for Jest tests
import { jest } from '@jest/globals';

export const mockApp = {
  isPackaged: false,
  getPath: jest.fn(),
  whenReady: jest.fn(() => Promise.resolve(undefined)),
  quit: jest.fn(),
};

export const mockIpcMain = {
  handle: jest.fn(),
  on: jest.fn(),
};

export const mockBrowserWindow = jest.fn(() => ({
  loadURL: jest.fn(),
  webContents: { send: jest.fn(), on: jest.fn() },
  on: jest.fn(),
  setAlwaysOnTop: jest.fn(),
  setSize: jest.fn(),
  setPosition: jest.fn(),
  isDestroyed: jest.fn().mockReturnValue(false),
}));