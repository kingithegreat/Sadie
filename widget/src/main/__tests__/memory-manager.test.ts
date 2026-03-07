/**
 * memory-manager.test.ts
 * Tests for src/main/memory-manager.ts
 */

import os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Mock electron: force isPackaged=true so getMemoryStorePath uses app.getPath('userData')
// The getPath mock returns process.env.TEST_USERDATA so each test suite gets its own directory.
jest.mock('electron', () => ({
  app: { isPackaged: true, getPath: jest.fn(() => process.env.TEST_USERDATA || os.tmpdir()) },
}));

import {
  loadPreferences,
  savePreferences,
  loadConversationStore,
  getConversation,
  saveConversation,
  deleteConversation,
  setActiveConversation,
  createNewConversation,
  addMessageToConversation,
  updateMessageInConversation,
  loadToolStats,
  recordToolUsage,
  __flushWritesSync,
} from '../memory-manager';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-mm-batch11-'));
  process.env.TEST_USERDATA = tmpDir;
  // Drain any writes queued from the previous test before entering the fresh dir.
  __flushWritesSync();
});

afterEach(() => {
  // Flush pending writes so setImmediate-scheduled flushes find nothing queued.
  __flushWritesSync();
  delete process.env.TEST_USERDATA;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ── loadPreferences ──────────────────────────────────────────────────────────

describe('loadPreferences', () => {
  test('returns default theme "dark" when no file exists', () => {
    const prefs = loadPreferences();
    expect(prefs.theme).toBe('dark');
  });

  test('returns default ollamaEndpoint when no file exists', () => {
    const prefs = loadPreferences();
    expect(prefs.ollamaEndpoint).toBe('http://127.0.0.1:11434');
  });

  test('returns default model "phi4" when no file exists', () => {
    const prefs = loadPreferences();
    expect(prefs.defaultModel).toBe('phi4');
  });

  test('returns default alwaysOnTop=true when no file exists', () => {
    const prefs = loadPreferences();
    expect(prefs.alwaysOnTop).toBe(true);
  });

  test('returns default autoSaveConversations=true when no file exists', () => {
    const prefs = loadPreferences();
    expect(prefs.autoSaveConversations).toBe(true);
  });
});

// ── savePreferences ──────────────────────────────────────────────────────────

describe('savePreferences', () => {
  test('returns object with the updated fields applied', () => {
    const updated = savePreferences({ theme: 'light' });
    expect(updated.theme).toBe('light');
  });

  test('preserves un-changed defaults after partial update', () => {
    const updated = savePreferences({ defaultModel: 'llama3' });
    expect(updated.ollamaEndpoint).toBe('http://127.0.0.1:11434');
    expect(updated.alwaysOnTop).toBe(true);
  });

  test('persists and reloads saved preferences', () => {
    savePreferences({ theme: 'light', defaultModel: 'deepseek' });
    __flushWritesSync();
    const reloaded = loadPreferences();
    expect(reloaded.theme).toBe('light');
    expect(reloaded.defaultModel).toBe('deepseek');
  });

  test('successive saves merge correctly', () => {
    savePreferences({ theme: 'light' });
    __flushWritesSync(); // flush first save before the second save reads from disk
    savePreferences({ defaultModel: 'gemma' });
    __flushWritesSync();
    const prefs = loadPreferences();
    expect(prefs.theme).toBe('light');
    expect(prefs.defaultModel).toBe('gemma');
  });
});

// ── loadConversationStore ────────────────────────────────────────────────────

describe('loadConversationStore', () => {
  test('returns empty conversations array when no file exists', () => {
    const store = loadConversationStore();
    expect(store.conversations).toEqual([]);
  });

  test('returns null activeConversationId when no file exists', () => {
    const store = loadConversationStore();
    expect(store.activeConversationId).toBeNull();
  });
});

// ── createNewConversation ────────────────────────────────────────────────────

describe('createNewConversation', () => {
  test('returns object with id matching conv_<timestamp>_<random> pattern', () => {
    const conv = createNewConversation('Pattern Test');
    expect(conv.id).toMatch(/^conv_\d+_[a-z0-9]+$/);
  });

  test('uses provided title', () => {
    const conv = createNewConversation('My Title');
    expect(conv.title).toBe('My Title');
  });

  test('uses default title containing "Conversation" when no title given', () => {
    const conv = createNewConversation();
    expect(conv.title).toContain('Conversation');
  });

  test('starts with empty messages array', () => {
    const conv = createNewConversation('Empty Messages');
    expect(conv.messages).toEqual([]);
  });

  test('sets createdAt and updatedAt', () => {
    const conv = createNewConversation('Timestamps');
    expect(conv.createdAt).toBeDefined();
    expect(conv.updatedAt).toBeDefined();
    expect(new Date(conv.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('sets activeConversationId in the store after creation', () => {
    const conv = createNewConversation('Active Check');
    // loadConversationStore reads the write queue, so flush is not required here
    const store = loadConversationStore();
    expect(store.activeConversationId).toBe(conv.id);
  });

  test('conversation appears in the store conversations list', () => {
    const conv = createNewConversation('Store List');
    const store = loadConversationStore();
    expect(store.conversations.some(c => c.id === conv.id)).toBe(true);
  });
});

// ── getConversation ──────────────────────────────────────────────────────────

describe('getConversation', () => {
  test('returns the conversation when it exists', () => {
    const conv = createNewConversation('Find Me');
    const found = getConversation(conv.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Find Me');
  });

  test('returns null when conversation does not exist', () => {
    expect(getConversation('definitely-not-there')).toBeNull();
  });

  test('can retrieve multiple distinct conversations by id', () => {
    const a = createNewConversation('Conv A');
    const b = createNewConversation('Conv B');
    expect(getConversation(a.id)!.title).toBe('Conv A');
    expect(getConversation(b.id)!.title).toBe('Conv B');
  });
});

// ── saveConversation ─────────────────────────────────────────────────────────

describe('saveConversation', () => {
  test('creates a conversation that was not previously in the store', () => {
    const novel: any = {
      id: 'brand-new-id',
      title: 'Brand New',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const ok = saveConversation(novel);
    expect(ok).toBe(true);
    const found = getConversation('brand-new-id');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Brand New');
  });

  test('updates an existing conversation title', () => {
    const conv = createNewConversation('Original Title');
    const modified = { ...conv, title: 'Updated Title' };
    saveConversation(modified);
    const reloaded = getConversation(conv.id);
    expect(reloaded!.title).toBe('Updated Title');
  });

  test('stamps new updatedAt when overwriting an existing conversation', () => {
    // Use a fixed past timestamp to simulate an older conversation
    const conv = createNewConversation('Stamp Test');
    const pastDate = '2000-01-01T00:00:00.000Z';
    const stale = { ...conv, updatedAt: pastDate };
    saveConversation(stale);
    const reloaded = getConversation(conv.id);
    expect(reloaded!.updatedAt).not.toBe(pastDate);
  });
});

// ── deleteConversation ───────────────────────────────────────────────────────

describe('deleteConversation', () => {
  test('removes the conversation from the store', () => {
    const conv = createNewConversation('To Delete');
    deleteConversation(conv.id);
    expect(getConversation(conv.id)).toBeNull();
  });

  test('clears activeConversationId when the active conv is deleted', () => {
    const conv = createNewConversation('Active To Delete');
    // createNewConversation sets conv as active
    deleteConversation(conv.id);
    const store = loadConversationStore();
    expect(store.activeConversationId).toBeNull();
  });

  test('does not remove other conversations', () => {
    const a = createNewConversation('Keep Me');
    const b = createNewConversation('Delete Me');
    deleteConversation(b.id);
    expect(getConversation(a.id)).not.toBeNull();
  });

  test('does not affect activeConversationId when deleting a non-active conv', () => {
    const a = createNewConversation('Conv A');
    const b = createNewConversation('Conv B'); // becomes active
    deleteConversation(a.id); // delete non-active
    const store = loadConversationStore();
    expect(store.activeConversationId).toBe(b.id);
  });
});

// ── setActiveConversation ────────────────────────────────────────────────────

describe('setActiveConversation', () => {
  test('sets the activeConversationId to the given id', () => {
    const conv = createNewConversation('Set Active');
    setActiveConversation(conv.id);
    const store = loadConversationStore();
    expect(store.activeConversationId).toBe(conv.id);
  });

  test('clears activeConversationId when null is passed', () => {
    createNewConversation('Will Deactivate');
    setActiveConversation(null);
    const store = loadConversationStore();
    expect(store.activeConversationId).toBeNull();
  });
});

// ── addMessageToConversation ─────────────────────────────────────────────────

describe('addMessageToConversation', () => {
  test('appends a message and returns true', () => {
    const conv = createNewConversation('Append Test');
    const msg = { id: 'msg1', role: 'user' as const, content: 'Hello!', timestamp: new Date().toISOString() };
    const ok = addMessageToConversation(conv.id, msg);
    expect(ok).toBe(true);
    const reloaded = getConversation(conv.id);
    expect(reloaded!.messages.length).toBe(1);
    expect(reloaded!.messages[0].content).toBe('Hello!');
  });

  test('auto-generates title from first user message (short content)', () => {
    const conv = createNewConversation(); // default title
    const msg = { id: 'msg1', role: 'user' as const, content: 'What time is it?', timestamp: new Date().toISOString() };
    addMessageToConversation(conv.id, msg);
    const reloaded = getConversation(conv.id);
    expect(reloaded!.title).toBe('What time is it?');
  });

  test('truncates title at 50 chars and appends ellipsis for long first message', () => {
    const conv = createNewConversation();
    const longContent = 'X'.repeat(60);
    const msg = { id: 'msg1', role: 'user' as const, content: longContent, timestamp: new Date().toISOString() };
    addMessageToConversation(conv.id, msg);
    const reloaded = getConversation(conv.id);
    expect(reloaded!.title).toBe('X'.repeat(50) + '...');
  });

  test('does not overwrite title when second message is added', () => {
    const conv = createNewConversation();
    const m1 = { id: 'm1', role: 'user' as const, content: 'First', timestamp: new Date().toISOString() };
    const m2 = { id: 'm2', role: 'assistant' as const, content: 'Second', timestamp: new Date().toISOString() };
    addMessageToConversation(conv.id, m1);
    addMessageToConversation(conv.id, m2);
    const reloaded = getConversation(conv.id);
    expect(reloaded!.title).toBe('First');
  });

  test('returns false for a non-existent conversation', () => {
    const msg = { id: 'msg1', role: 'user' as const, content: 'hi', timestamp: new Date().toISOString() };
    expect(addMessageToConversation('no-such-conv', msg)).toBe(false);
  });

  test('auto-assigns an id when message has no id', () => {
    const conv = createNewConversation('ID Auto');
    const msg = { role: 'assistant' as const, content: 'Hi there', timestamp: new Date().toISOString() } as any;
    addMessageToConversation(conv.id, msg);
    const reloaded = getConversation(conv.id);
    expect(reloaded!.messages[0].id).toMatch(/^msg_/);
  });
});

// ── updateMessageInConversation ──────────────────────────────────────────────

describe('updateMessageInConversation', () => {
  test('updates message content and returns true', () => {
    const conv = createNewConversation('Update Test');
    const msg = { id: 'edit-me', role: 'user' as const, content: 'Original', timestamp: new Date().toISOString() };
    addMessageToConversation(conv.id, msg);
    const ok = updateMessageInConversation(conv.id, 'edit-me', { content: 'Edited!' });
    expect(ok).toBe(true);
    const reloaded = getConversation(conv.id);
    expect(reloaded!.messages.find(m => m.id === 'edit-me')!.content).toBe('Edited!');
  });

  test('returns false when conversation does not exist', () => {
    expect(updateMessageInConversation('fake-conv', 'fake-msg', { content: 'x' })).toBe(false);
  });

  test('returns false when messageId is not in the conversation', () => {
    const conv = createNewConversation('No Msg Test');
    expect(updateMessageInConversation(conv.id, 'nonexistent-msg', { content: 'x' })).toBe(false);
  });
});

// ── loadToolStats ────────────────────────────────────────────────────────────

describe('loadToolStats', () => {
  test('returns totalToolCalls=0 when no file exists', () => {
    expect(loadToolStats().totalToolCalls).toBe(0);
  });

  test('returns empty toolUsage when no file exists', () => {
    expect(loadToolStats().toolUsage).toEqual({});
  });

  test('returns lastUpdated=null when no file exists', () => {
    expect(loadToolStats().lastUpdated).toBeNull();
  });
});

// ── recordToolUsage ──────────────────────────────────────────────────────────

describe('recordToolUsage', () => {
  test('increments totalToolCalls by 1', () => {
    recordToolUsage('calculate');
    __flushWritesSync();
    expect(loadToolStats().totalToolCalls).toBe(1);
  });

  test('increments per-tool counter in toolUsage', () => {
    recordToolUsage('get_clipboard');
    recordToolUsage('get_clipboard');
    __flushWritesSync();
    expect(loadToolStats().toolUsage['get_clipboard']).toBe(2);
  });

  test('sets lastUpdated to a valid ISO timestamp', () => {
    recordToolUsage('web_search');
    __flushWritesSync();
    const stats = loadToolStats();
    expect(stats.lastUpdated).not.toBeNull();
    expect(new Date(stats.lastUpdated!).getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('tracks multiple tools independently', () => {
    recordToolUsage('tool_a');
    __flushWritesSync();
    recordToolUsage('tool_b');
    __flushWritesSync();
    recordToolUsage('tool_a');
    __flushWritesSync();
    const stats = loadToolStats();
    // tool_a called twice, tool_b once — verify independent per-tool tracking
    expect(stats.toolUsage['tool_a']).toBeGreaterThanOrEqual(2);
    expect(stats.toolUsage['tool_b']).toBeGreaterThanOrEqual(1);
    expect(stats.toolUsage['tool_a']).toBeGreaterThan(stats.toolUsage['tool_b']);
    expect(stats.totalToolCalls).toBeGreaterThanOrEqual(3);
  });
});
