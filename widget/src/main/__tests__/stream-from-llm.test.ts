/**
 * stream-from-llm.test.ts
 *
 * Tests for the streamFromLLM function — the top-level entry point that
 * routes streaming requests to the correct backend (Custom LLM, Code API,
 * or Ollama) based on settings.
 *
 * Coverage targets:
 *   ① Default path → delegates to streamFromOllamaWithTools
 *   ② Custom LLM path (valid config, no images)
 *   ③ Custom LLM path falls back to Ollama for image attachments
 *   ④ Custom LLM with invalid config silently falls back to Ollama
 *   ⑤ Code API path (coding query + codeApiKey configured)
 *   ⑥ Code API skipped when codeApiKey missing
 *   ⑦ Cancel handle returned by each path
 */

// ── Mock Electron ────────────────────────────────────────────────────────────
jest.mock('electron', () => ({
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn(),
  app: { getPath: jest.fn(() => '/mock'), isPackaged: false },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  nativeTheme: { themeSource: 'system' },
}));

jest.mock('axios');

// ── Mock config-manager (mutable settings) ───────────────────────────────────
const mockSettings: Record<string, any> = {
  chatModel: 'llama3.2:3b',
  n8nUrl: 'http://localhost:5678',
  ollamaUrl: 'http://127.0.0.1:11434',
  theme: 'system',
  alwaysOnTop: false,
  globalHotkey: '',
  confirmDangerousActions: false,
  saveConversationHistory: false,
  hideOnBlur: false,
};
jest.mock('../config-manager', () => ({
  getSettings: jest.fn(() => Promise.resolve(mockSettings)),
  saveSettings: jest.fn(),
}));

// ── Mock memory-manager ──────────────────────────────────────────────────────
jest.mock('../memory-manager', () => ({
  MemoryManager: {
    getConversation: jest.fn(() => null),
    saveConversation: jest.fn(),
    createNewConversation: jest.fn(),
    addMessageToConversation: jest.fn(),
  },
}));

// ── Mock custom-llm-client ───────────────────────────────────────────────────
const mockStreamFromCustomLLM = jest.fn();
const mockValidateCustomLLMConfig = jest.fn();
jest.mock('../custom-llm-client', () => ({
  streamFromCustomLLM: (...args: any[]) => mockStreamFromCustomLLM(...args),
  validateCustomLLMConfig: (...args: any[]) => mockValidateCustomLLMConfig(...args),
}));

// ── Mock tools ───────────────────────────────────────────────────────────────
jest.mock('../tools', () => ({
  initializeTools: jest.fn(),
  getOllamaTools: jest.fn(() => []),
  getSmallModelTools: jest.fn(() => []),
  getAllToolDefinitions: jest.fn(() => [{ type: 'function', function: { name: 'test_tool', parameters: {} } }]),
  executeToolBatch: jest.fn(() => Promise.resolve([{ result: { text: '' } }])),
}));

// ── Import after all mocks ──────────────────────────────────────────────────
import { streamFromLLM, streamFromOllamaWithTools } from '../message-router';

// ── Helpers ──────────────────────────────────────────────────────────────────
const noop = () => {};
const noopAsync = () => Promise.resolve(true);
const noopPermission = () => Promise.resolve({ decision: 'cancel' as const });

function callbacks() {
  return {
    onChunk: jest.fn(),
    onToolCall: jest.fn(),
    onToolResult: jest.fn(),
    onEnd: jest.fn(),
    onError: jest.fn(),
  };
}

function resetSettings() {
  // Remove all custom keys, reset to base settings
  for (const key of Object.keys(mockSettings)) {
    if (!['chatModel', 'n8nUrl', 'ollamaUrl', 'theme', 'alwaysOnTop',
           'globalHotkey', 'confirmDangerousActions', 'saveConversationHistory',
           'hideOnBlur'].includes(key)) {
      delete mockSettings[key];
    }
  }
  mockSettings.chatModel = 'llama3.2:3b';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  jest.clearAllMocks();
  resetSettings();
  mockValidateCustomLLMConfig.mockReturnValue({ valid: false, error: 'not configured' });
});

describe('streamFromLLM', () => {
  // ── Default → Ollama ─────────────────────────────────────────────────────
  describe('default Ollama path', () => {
    test('returns a cancel handle', async () => {
      const cbs = callbacks();
      const handle = await streamFromLLM(
        'hello world', undefined, 'conv-1',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      expect(handle).toBeDefined();
      expect(typeof handle.cancel).toBe('function');
    });

    test('no custom LLM or code API ⇒ no call to streamFromCustomLLM', async () => {
      const cbs = callbacks();
      await streamFromLLM(
        'hello', undefined, 'conv-2',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      expect(mockStreamFromCustomLLM).not.toHaveBeenCalled();
    });
  });

  // ── Custom LLM path ──────────────────────────────────────────────────────
  describe('custom LLM path', () => {
    beforeEach(() => {
      mockSettings.useCustomLLM = true;
      mockSettings.customLLM = {
        name: 'Test Cloud',
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        provider: 'openai',
        model: 'gpt-4o',
        enabled: true,
      };
      mockValidateCustomLLMConfig.mockReturnValue({ valid: true });
    });

    test('valid config ⇒ delegates to streamFromCustomLLM', async () => {
      const cbs = callbacks();
      const handle = await streamFromLLM(
        'explain closures', undefined, 'conv-3',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      expect(mockStreamFromCustomLLM).toHaveBeenCalledTimes(1);
      expect(typeof handle.cancel).toBe('function');
    });

    test('image attachment ⇒ falls back to Ollama with warning', async () => {
      const cbs = callbacks();
      const images = [{ data: 'base64data', mimeType: 'image/png' }];
      const handle = await streamFromLLM(
        'describe this image', images as any, 'conv-4',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      // Should NOT have called the custom LLM
      expect(mockStreamFromCustomLLM).not.toHaveBeenCalled();
      // Should have sent a warning chunk
      expect(cbs.onChunk).toHaveBeenCalledWith(
        expect.stringContaining('Image attachments use Ollama vision model'),
      );
      expect(typeof handle.cancel).toBe('function');
    });

    test('invalid config ⇒ silently falls back to Ollama', async () => {
      mockValidateCustomLLMConfig.mockReturnValue({ valid: false, error: 'missing apiKey' });
      const cbs = callbacks();
      await streamFromLLM(
        'hello', undefined, 'conv-5',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      expect(mockStreamFromCustomLLM).not.toHaveBeenCalled();
    });

    test('cancel() aborts the AbortController', async () => {
      const cbs = callbacks();
      const handle = await streamFromLLM(
        'tell me a story', undefined, 'conv-6',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      // The signal passed to streamFromCustomLLM should be an AbortSignal
      const callArgs = mockStreamFromCustomLLM.mock.calls[0];
      const signal = callArgs[7]; // 8th argument is the signal
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      handle.cancel();
      expect(signal.aborted).toBe(true);
    });
  });

  // ── Code API path ────────────────────────────────────────────────────────
  describe('code API path', () => {
    beforeEach(() => {
      // No custom LLM — validation will fail
      mockValidateCustomLLMConfig.mockReturnValue({ valid: false, error: 'not configured' });
      mockSettings.codeApiKey = 'sk-code-test';
      mockSettings.codeApiProvider = 'openai';
      mockSettings.codeModel = 'gpt-4o';
    });

    test('coding query with codeApiKey ⇒ routes to custom LLM (code config)', async () => {
      // useCustomLLM is falsy so only the code-API validation call happens
      mockValidateCustomLLMConfig.mockReturnValue({ valid: true });
      const cbs = callbacks();
      const handle = await streamFromLLM(
        'write a python function to sort a list', undefined, 'conv-7',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      expect(mockValidateCustomLLMConfig).toHaveBeenCalledTimes(1);
      expect(mockStreamFromCustomLLM).toHaveBeenCalledTimes(1);
      expect(typeof handle.cancel).toBe('function');
    });

    test('non-coding query ⇒ skips code API, uses Ollama', async () => {
      const cbs = callbacks();
      await streamFromLLM(
        'hello how are you', undefined, 'conv-8',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      // Only one validation call (the useCustomLLM check path — but useCustomLLM is falsy)
      expect(mockStreamFromCustomLLM).not.toHaveBeenCalled();
    });

    test('coding query with images ⇒ skips code API, uses Ollama', async () => {
      mockValidateCustomLLMConfig.mockReturnValue({ valid: false, error: 'not configured' });
      const cbs = callbacks();
      const images = [{ data: 'base64', mimeType: 'image/png' }];
      await streamFromLLM(
        'write a typescript class', images as any, 'conv-9',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      expect(mockStreamFromCustomLLM).not.toHaveBeenCalled();
    });

    test('missing codeApiKey ⇒ no code API routing', async () => {
      delete mockSettings.codeApiKey;
      const cbs = callbacks();
      await streamFromLLM(
        'write a python sort function', undefined, 'conv-10',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      expect(mockStreamFromCustomLLM).not.toHaveBeenCalled();
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────
  describe('edge cases', () => {
    test('anthropic provider enables tool support', async () => {
      mockSettings.useCustomLLM = true;
      mockSettings.customLLM = {
        name: 'Claude',
        apiUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant-test',
        provider: 'anthropic',
        model: 'claude-3-opus',
        enabled: true,
      };
      mockValidateCustomLLMConfig.mockReturnValue({ valid: true });
      const cbs = callbacks();
      await streamFromLLM(
        'hello', undefined, 'conv-11',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      // Should have passed tool definitions to streamFromCustomLLM
      const callArgs = mockStreamFromCustomLLM.mock.calls[0];
      const toolDefs = callArgs[8]; // 9th argument is tool definitions
      expect(toolDefs).toBeDefined();
      expect(Array.isArray(toolDefs)).toBe(true);
    });

    test('cancel handle always returned regardless of path', async () => {
      const cbs = callbacks();
      const handle = await streamFromLLM(
        'just a normal message', undefined, 'conv-12',
        cbs.onChunk, cbs.onToolCall, cbs.onToolResult, cbs.onEnd, cbs.onError,
      );
      expect(handle).toHaveProperty('cancel');
      expect(typeof handle.cancel).toBe('function');
      // Calling cancel should not throw
      expect(() => handle.cancel()).not.toThrow();
    });
  });
});
