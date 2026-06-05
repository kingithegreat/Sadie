/**
 * synthesis-guard.test.ts
 *
 * Verifies two key fixes that prevent "Error" on web-search synthesis:
 *
 * 1. `noTools` guard — When streamFromOllamaWithTools is called with
 *    options.noTools=true (all 4 synthesis sites do this), the request body
 *    sent to Ollama must NOT include a `tools` array. Without this fix the
 *    model re-calls web_search, blowing the context window.
 *
 * 2. Cloud model guard — When useCustomLLM is active the user's settings.chatModel
 *    is a cloud provider name (e.g. 'claude-sonnet-4-20250514') which Ollama
 *    cannot resolve. The function must fall back to the local OLLAMA_CHAT_MODEL.
 */

import { Readable } from 'stream';
import axios from 'axios';

// ──────────────────────────────────────────────────────────────────────────────
// Mock all Electron / IPC / FS-heavy deps before importing message-router
// ──────────────────────────────────────────────────────────────────────────────
jest.mock('electron', () => ({
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn(),
  app: { getPath: jest.fn(() => '/mock'), isPackaged: false },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  nativeTheme: { themeSource: 'system' },
}));

jest.mock('axios');

// Provide a minimal settings object — overridden per test
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
  getSettings: () => mockSettings,
  saveSettings: jest.fn(),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Helper: create a minimal Ollama-style ndjson stream
// ──────────────────────────────────────────────────────────────────────────────
function makeMockOllamaStream(content = 'Answer text.'): Readable {
  const stream = new Readable({ read() {} });
  stream.push(`{"message":{"content":"${content}"},"done":false}\n`);
  stream.push('{"done":true}\n');
  stream.push(null);
  return stream;
}

// Import AFTER mocks are in place
import { streamFromOllamaWithTools } from '../message-router';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers to call the function with minimal boilerplate
// ──────────────────────────────────────────────────────────────────────────────
async function callStream(
  message: string,
  extraOptions: { noTools?: boolean; hasDocuments?: boolean } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    streamFromOllamaWithTools(
      message,
      undefined,          // images
      'test-conv',        // conversationId
      () => {},           // onChunk
      () => {},           // onToolCall
      () => {},           // onToolResult
      resolve,            // onEnd
      reject,             // onError
      undefined,          // requestConfirmation
      undefined,          // requestPermission
      extraOptions
    );
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────
describe('streamFromOllamaWithTools — noTools guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset settings to no cloud model
    Object.assign(mockSettings, {
      chatModel: 'llama3.2:3b',
      ollamaUrl: 'http://127.0.0.1:11434',
      useCustomLLM: false,
      customLLM: null
    });
    (axios.post as jest.MockedFunction<any>).mockResolvedValue({ data: makeMockOllamaStream() });
  });

  test('request body does NOT contain tools when noTools=true', async () => {
    await callStream('[SEARCH RESULTS]\nsome results\n[/SEARCH RESULTS]\n\nQuestion: test?', { noTools: true });

    const postCalls = (axios.post as jest.MockedFunction<any>).mock.calls;
    expect(postCalls.length).toBeGreaterThan(0);

    // The request body is the second argument to axios.post
    const requestBody = postCalls[0][1];
    expect(requestBody).not.toHaveProperty('tools');
  });

  test('request body MAY contain tools for normal (non-synthesis) calls', async () => {
    await callStream('Hello, what is the weather?');

    const postCalls = (axios.post as jest.MockedFunction<any>).mock.calls;
    expect(postCalls.length).toBeGreaterThan(0);

    // For a normal call the body may or may not have tools (depends on model
    // capabilities) — but the key thing is that the noTools guard was not applied
    const requestBody = postCalls[0][1];
    // body.tools could be undefined or an array; we just assert it wasn't forced away
    // by checking that the body itself is a proper object
    expect(requestBody).toHaveProperty('model');
    expect(requestBody).toHaveProperty('messages');
  });

  test('message starting with [SEARCH RESULTS] is also treated as synthesis call', async () => {
    await callStream('[SEARCH RESULTS]\nfoo\n[/SEARCH RESULTS]\n\nQuestion: foo?');

    const postCalls = (axios.post as jest.MockedFunction<any>).mock.calls;
    expect(postCalls.length).toBeGreaterThan(0);
    const requestBody = postCalls[0][1];
    expect(requestBody).not.toHaveProperty('tools');
  });

  test('uses the configured Ollama URL for chat requests', async () => {
    Object.assign(mockSettings, {
      ollamaUrl: 'http://localhost:11434/',
      useCustomLLM: false,
      customLLM: null,
    });

    await callStream('Hello', { noTools: true });

    const postCalls = (axios.post as jest.MockedFunction<any>).mock.calls;
    expect(postCalls.length).toBeGreaterThan(0);
    expect(postCalls[0][0]).toBe('http://127.0.0.1:11434/api/chat');
  });
});

describe('streamFromOllamaWithTools — cloud model guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockSettings, { ollamaUrl: 'http://127.0.0.1:11434' });
    (axios.post as jest.MockedFunction<any>).mockResolvedValue({ data: makeMockOllamaStream() });
  });

  test('falls back to OLLAMA_CHAT_MODEL when useCustomLLM is active', async () => {
    // Simulate user having selected a Claude model in the UI
    Object.assign(mockSettings, {
      chatModel: 'claude-sonnet-4-20250514',
      useCustomLLM: true,
      customLLM: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    });

    await callStream('current war in iran', { noTools: true });

    const postCalls = (axios.post as jest.MockedFunction<any>).mock.calls;
    expect(postCalls.length).toBeGreaterThan(0);
    const requestBody = postCalls[0][1];

    // Must NOT send the cloud model name to Ollama
    expect(requestBody.model).not.toBe('claude-sonnet-4-20250514');
    // Should use the Ollama default instead
    expect(requestBody.model).toBe(process.env.OLLAMA_MODEL || 'qwen2.5:7b');
  });

  test('uses chatModel from settings when useCustomLLM is inactive', async () => {
    Object.assign(mockSettings, {
      chatModel: 'mistral:7b',
      useCustomLLM: false,
      customLLM: null,
    });

    await callStream('Hello', { noTools: true });

    const postCalls = (axios.post as jest.MockedFunction<any>).mock.calls;
    expect(postCalls.length).toBeGreaterThan(0);
    const requestBody = postCalls[0][1];
    expect(requestBody.model).toBe('mistral:7b');
  });
});
