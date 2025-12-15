import { mockApp, mockIpcMain, mockBrowserWindow } from './jest-setup.ts';

// Wrap plain mocks with jest.fn now that the Jest environment is ready
for (const key of Object.keys(mockApp)) {
  // @ts-ignore
  mockApp[key] = jest.fn(mockApp[key]);
}
for (const key of Object.keys(mockIpcMain)) {
  // @ts-ignore
  mockIpcMain[key] = jest.fn(mockIpcMain[key]);
}

const browserWindowFactory = jest.fn(mockBrowserWindow as any);

jest.mock('electron', () => ({
  app: mockApp,
  ipcMain: mockIpcMain,
  BrowserWindow: browserWindowFactory,
  dialog: {
    showMessageBox: jest.fn(() => Promise.resolve({ response: 0 })),
    showOpenDialog: jest.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
    showSaveDialog: jest.fn(() => Promise.resolve({ canceled: true, filePath: undefined })),
  },
  shell: {
    openExternal: jest.fn(() => Promise.resolve()),
    openPath: jest.fn(() => Promise.resolve('')),
  },
  nativeTheme: {
    themeSource: 'system',
  },
}));

// Mock axios globally to avoid real XHR timers in tests
import axios from 'axios';
jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({ status: 200 }),
  post: jest.fn().mockResolvedValue({ data: {} }),
}));

// Clear mocks after each test when Jest lifecycle is available
afterEach(() => {
  jest.clearAllMocks();
});
