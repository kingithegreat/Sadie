// Use Jest globals provided by the test runner
/* globals describe,it,expect,beforeAll,beforeEach,afterEach */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock Electron's ipcMain so we can capture handler registrations
const handleMock = jest.fn();
jest.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    on: jest.fn(),
  },
}));

describe('IPC Handler Registration', () => {
  let testConfigDir: string;
  let configManager: any;
  let ipcHandlers: any;

  beforeAll(() => {
    // Set up test environment BEFORE importing modules
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-test-'));
    process.env.SADIE_TEST_CONFIG_DIR = testConfigDir;
    
    console.log('[TEST SETUP] Using config dir:', testConfigDir);
  });

  beforeEach(async () => {
    // Clear any cached modules
    jest.resetModules();
    handleMock.mockClear();
    // Ensure the global registration guard is cleared so handlers will be re-registered
    try { (global as any).__sadie_ipc_registered = false; } catch (e) {}
    
    // Create fresh temp directory for this test
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-test-'));
    process.env.SADIE_TEST_CONFIG_DIR = testConfigDir;

    // Now import modules (they will use the test config dir)
    configManager = await import('../config-manager');
    const ipcHandlersModule = await import('../ipc-handlers');
    // Ensure handlers are registered for the test harness (this will call ipcMain.handle which we mock)
    if (typeof ipcHandlersModule.registerIpcHandlers === 'function') ipcHandlersModule.registerIpcHandlers();

    // Initialize with default test settings
    const defaultSettings = {
      n8nUrl: '',
      ollamaUrl: 'http://localhost:11434',
      theme: 'system',
      alwaysOnTop: false,
      globalHotkey: 'CommandOrControl+Shift+S',
      confirmDangerousActions: true,
      saveConversationHistory: true,
      hideOnBlur: false,
      firstRun: false,
      telemetryEnabled: false, // Disable for tests
      permissions: {
        'nba_query': true,
        'web_search': true,
        'write_file': true,
        'create_directory': true,
      },
      defaultTeam: '',
    };

    configManager.saveSettings(defaultSettings);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testConfigDir)) {
      try {
        fs.rmSync(testConfigDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('[TEST CLEANUP] Failed to remove:', testConfigDir, error);
      }
    }
    
    // Clear environment
    delete process.env.SADIE_TEST_CONFIG_DIR;
  });

  it('should have IPC handlers defined', () => {
    // Handlers should be registered via ipcMain.handle
    expect(handleMock).toHaveBeenCalled();
  });

  it('should have check-connection handler', () => {
    const call = handleMock.mock.calls.find(([channel]) => channel === 'sadie:check-connection');
    expect(call).toBeDefined();
    const [, handler] = call!;
    expect(typeof handler).toBe('function');
  });

  it('should have get-settings handler', () => {
    const call = handleMock.mock.calls.find(([channel]) => channel === 'sadie:get-settings');
    expect(call).toBeDefined();
    const [, handler] = call!;
    expect(typeof handler).toBe('function');
  });

  it('should have save-settings handler', () => {
    const call = handleMock.mock.calls.find(([channel]) => channel === 'sadie:save-settings');
    expect(call).toBeDefined();
    const [, handler] = call!;
    expect(typeof handler).toBe('function');
  });

  it('should handle get-settings request', async () => {
    const call = handleMock.mock.calls.find(([channel]) => channel === 'sadie:get-settings');
    const [, handler] = call!;
    const result = await handler();

    expect(result).toBeDefined();
    expect(result).toHaveProperty('ollamaUrl');
    expect(result).toHaveProperty('theme');
    expect(result).toHaveProperty('permissions');
    expect(result.ollamaUrl).toBe('http://localhost:11434');
    expect(result.telemetryEnabled).toBe(false);
  });

  it('should handle save-settings request', async () => {
    const saveCall = handleMock.mock.calls.find(([ch]) => ch === 'sadie:save-settings');
    const getCall = handleMock.mock.calls.find(([ch]) => ch === 'sadie:get-settings');
    const [, saveHandler] = saveCall!;
    const [, getHandler] = getCall!;

    // Save new settings
    const newSettings = {
      theme: 'dark',
      alwaysOnTop: true,
    };

    await saveHandler(null, newSettings);

    // Verify settings were saved
    const result = await getHandler();
    expect(result.theme).toBe('dark');
    expect(result.alwaysOnTop).toBe(true);
    
    // Other settings should be preserved
    expect(result.ollamaUrl).toBe('http://localhost:11434');
  });

  it('should handle check-connection request without errors', async () => {
    const call = handleMock.mock.calls.find(([channel]) => channel === 'sadie:check-connection');
    const [, handler] = call!;

    // This should not throw even if services aren't available
    const result = await handler();

    expect(result).toBeDefined();
    expect(result).toHaveProperty('ollama');
    expect(result).toHaveProperty('n8n');
    
    // Both should have status property
    expect(result.ollama).toHaveProperty('status');
    expect(result.n8n).toHaveProperty('status');
  });

  it('should preserve complex permission structures', async () => {
    const saveCall = handleMock.mock.calls.find(([ch]) => ch === 'sadie:save-settings');
    const getCall = handleMock.mock.calls.find(([ch]) => ch === 'sadie:get-settings');
    const [, saveHandler] = saveCall!;
    const [, getHandler] = getCall!;

    const complexPermissions = {
      permissions: {
        'write_file': true,
        'delete_file': false,
        'web_search': true,
        'screenshot': false,
      },
    };

    await saveHandler(null, complexPermissions);
    const result = await getHandler();

    expect(result.permissions.write_file).toBe(true);
    expect(result.permissions.delete_file).toBe(false);
    expect(result.permissions.web_search).toBe(true);
    expect(result.permissions.screenshot).toBe(false);
  });
});
