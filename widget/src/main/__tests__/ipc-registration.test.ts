// Use Jest globals provided by the test runner
/* globals describe,it,expect,beforeAll,beforeEach,afterEach */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    
    // Create fresh temp directory for this test
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-test-'));
    process.env.SADIE_TEST_CONFIG_DIR = testConfigDir;

    // Now import modules (they will use the test config dir)
    configManager = await import('../config-manager');
    const ipcHandlersModule = await import('../ipc-handlers');
    ipcHandlers = ipcHandlersModule.ipcHandlers;

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
    expect(ipcHandlers).toBeDefined();
    expect(typeof ipcHandlers).toBe('object');
  });

  it('should have check-connection handler', () => {
    expect(ipcHandlers['sadie:check-connection']).toBeDefined();
    expect(typeof ipcHandlers['sadie:check-connection']).toBe('function');
  });

  it('should have get-settings handler', () => {
    expect(ipcHandlers['sadie:get-settings']).toBeDefined();
    expect(typeof ipcHandlers['sadie:get-settings']).toBe('function');
  });

  it('should have save-settings handler', () => {
    expect(ipcHandlers['sadie:save-settings']).toBeDefined();
    expect(typeof ipcHandlers['sadie:save-settings']).toBe('function');
  });

  it('should handle get-settings request', async () => {
    const handler = ipcHandlers['sadie:get-settings'];
    const result = await handler();

    expect(result).toBeDefined();
    expect(result).toHaveProperty('ollamaUrl');
    expect(result).toHaveProperty('theme');
    expect(result).toHaveProperty('permissions');
    expect(result.ollamaUrl).toBe('http://localhost:11434');
    expect(result.telemetryEnabled).toBe(false);
  });

  it('should handle save-settings request', async () => {
    const saveHandler = ipcHandlers['sadie:save-settings'];
    const getHandler = ipcHandlers['sadie:get-settings'];

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
    const handler = ipcHandlers['sadie:check-connection'];
    
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
    const saveHandler = ipcHandlers['sadie:save-settings'];
    const getHandler = ipcHandlers['sadie:get-settings'];

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
