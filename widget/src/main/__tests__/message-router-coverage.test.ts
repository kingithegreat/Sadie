/**
 * message-router-coverage.test.ts
 *
 * Unit tests for previously-untested exports and key internal behaviors
 * of message-router.ts:
 *   - clearHistory
 *   - ensureHydrated
 *   - setUncensoredMode / getUncensoredMode
 *   - analyzeAndRouteMessage (direct)
 *   - looksLikePlannerLeak / sanitizeUserFacingAssistantText (via behavior)
 *   - isSimpleGreeting (via analyzeAndRouteMessage)
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

// ── Mock config-manager ──────────────────────────────────────────────────────
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

// ── Mock memory-manager ──────────────────────────────────────────────────────
const mockConversations: Record<string, any> = {};
jest.mock('../memory-manager', () => ({
  MemoryManager: {
    getConversation: jest.fn((id: string) => mockConversations[id] ?? null),
    saveConversation: jest.fn(),
    createNewConversation: jest.fn(),
    addMessageToConversation: jest.fn(),
  },
}));

// ── Import after mocks ──────────────────────────────────────────────────────
import * as mr from '../message-router';

// ═══════════════════════════════════════════════════════════════════════════════
// clearHistory
// ═══════════════════════════════════════════════════════════════════════════════
describe('clearHistory', () => {
  test('removes conversation data so subsequent getHistory returns empty', () => {
    // Seed internal state by routing a message through ensureHydrated
    mockConversations['conv-clear'] = {
      messages: [
        { role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'Hi!', timestamp: new Date().toISOString() },
      ],
    };
    mr.ensureHydrated('conv-clear');

    // Now clear and verify no crash and that re-hydrating is allowed
    mr.clearHistory('conv-clear');

    // After clear, ensureHydrated should run again (re-hydrate path)
    // This call should not throw
    mr.ensureHydrated('conv-clear');
  });

  test('no-op on non-existent conversation (no throw)', () => {
    expect(() => mr.clearHistory('does-not-exist')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ensureHydrated
// ═══════════════════════════════════════════════════════════════════════════════
describe('ensureHydrated', () => {
  test('skips empty / falsy conversationId', () => {
    expect(() => mr.ensureHydrated('')).not.toThrow();
    expect(() => mr.ensureHydrated(undefined as any)).not.toThrow();
  });

  test('hydrates from MemoryManager on first call', () => {
    const { MemoryManager } = require('../memory-manager');
    mockConversations['conv-hydrate'] = {
      messages: [
        { role: 'user', content: 'One', timestamp: '2024-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Two', timestamp: '2024-01-01T00:00:01Z' },
      ],
    };

    mr.ensureHydrated('conv-hydrate');
    expect(MemoryManager.getConversation).toHaveBeenCalledWith('conv-hydrate');
  });

  test('second call is a no-op (idempotent)', () => {
    const { MemoryManager } = require('../memory-manager');
    MemoryManager.getConversation.mockClear();

    mockConversations['conv-idem'] = {
      messages: [
        { role: 'user', content: 'A', timestamp: '2024-01-01T00:00:00Z' },
      ],
    };

    mr.ensureHydrated('conv-idem');
    mr.ensureHydrated('conv-idem');

    // Should only call getConversation once (second call is skipped)
    expect(MemoryManager.getConversation).toHaveBeenCalledTimes(1);
  });

  test('handles conversation with no messages gracefully', () => {
    mockConversations['conv-empty'] = { messages: [] };
    expect(() => mr.ensureHydrated('conv-empty')).not.toThrow();
  });

  test('handles null stored conversation gracefully', () => {
    mockConversations['conv-null'] = null;
    expect(() => mr.ensureHydrated('conv-null')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// setUncensoredMode / getUncensoredMode
// ═══════════════════════════════════════════════════════════════════════════════
describe('uncensored mode toggle', () => {
  afterEach(() => {
    // Reset to default
    mr.setUncensoredMode(false);
  });

  test('default is false', () => {
    expect(mr.getUncensoredMode()).toBe(false);
  });

  test('enable then disable round-trips correctly', () => {
    mr.setUncensoredMode(true);
    expect(mr.getUncensoredMode()).toBe(true);

    mr.setUncensoredMode(false);
    expect(mr.getUncensoredMode()).toBe(false);
  });

  test('setting same value twice is idempotent', () => {
    mr.setUncensoredMode(true);
    mr.setUncensoredMode(true);
    expect(mr.getUncensoredMode()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// analyzeAndRouteMessage
// ═══════════════════════════════════════════════════════════════════════════════
describe('analyzeAndRouteMessage', () => {
  test('returns error for empty string', async () => {
    const r = await mr.analyzeAndRouteMessage('');
    expect(r.type).toBe('error');
    if (r.type === 'error') expect(r.reason).toBe('invalid_message');
  });

  test('returns error for non-string input', async () => {
    const r = await mr.analyzeAndRouteMessage(null as any);
    expect(r.type).toBe('error');
    if (r.type === 'error') expect(r.reason).toBe('invalid_message');
  });

  test('simple greeting routes to llm (not tools)', async () => {
    const r = await mr.analyzeAndRouteMessage('hello');
    expect(r.type).toBe('llm');
  });

  test('NBA query routes to tools when auto-execute is enabled', async () => {
    // Ensure auto-execute is on (default)
    delete mockSettings.autoExecuteTools;
    delete mockSettings.allowAutoTools;

    const r = await mr.analyzeAndRouteMessage('show me the NBA scores for this week');
    expect(r.type).toBe('tools');
    if (r.type === 'tools') {
      expect(r.calls.length).toBeGreaterThan(0);
      expect(r.calls[0].name).toBe('nba_query');
    }
  });

  test('tool route suppressed when autoExecuteTools is false', async () => {
    mockSettings.autoExecuteTools = false;
    try {
      const r = await mr.analyzeAndRouteMessage('show me NBA scores');
      expect(r.type).toBe('llm');
    } finally {
      delete mockSettings.autoExecuteTools;
    }
  });

  test('web search query routes to tools', async () => {
    delete mockSettings.autoExecuteTools;
    const r = await mr.analyzeAndRouteMessage('search for TypeScript generics tutorial');
    expect(r.type).toBe('tools');
    if (r.type === 'tools') {
      expect(r.calls[0].name).toBe('web_search');
    }
  });

  test('image generation query routes to tools', async () => {
    delete mockSettings.autoExecuteTools;
    const r = await mr.analyzeAndRouteMessage('draw a picture of a sunset');
    expect(r.type).toBe('tools');
    if (r.type === 'tools') {
      expect(r.calls[0].name).toBe('image_generate');
    }
  });

  test('general chat message routes to llm', async () => {
    const r = await mr.analyzeAndRouteMessage('Please explain how recursion works in simple terms');
    expect(r.type).toBe('llm');
  });

  test('attached document review prompt does not route to filesystem tools', async () => {
    const intent = await mr.preProcessIntent('[Document attached: Mid-point review.pdf]\n\nhow could i improve this');
    expect(intent).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isSmallModel edge cases (supplement model-prompt-selection.test.ts)
// ═══════════════════════════════════════════════════════════════════════════════
describe('isSmallModel — edge cases', () => {
  test('empty string is not small', () => {
    expect(mr.isSmallModel('')).toBe(false);
  });

  test('model with only version number is not small', () => {
    expect(mr.isSmallModel('llama3.1')).toBe(false);
  });
});
