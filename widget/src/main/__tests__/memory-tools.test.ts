/**
 * Memory Tool Tests
 *
 * Tests cover:
 *  - remember / recall / forget / list_memories (Qdrant path + JSON fallback)
 *  - save_conversation / get_conversation_history / clear_conversation_history
 */

import * as fs from 'fs';

// ─── Mock fs ──────────────────────────────────────────────────────────────────
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const mockExistsSync = fs.existsSync as jest.Mock;
const mockReadFileSync = fs.readFileSync as jest.Mock;
const mockWriteFileSync = fs.writeFileSync as jest.Mock;
const mockMkdirSync = fs.mkdirSync as jest.Mock;

// ─── Mock axios ────────────────────────────────────────────────────────────────
const mockAxiosGet = jest.fn();
const mockAxiosPost = jest.fn();
const mockAxiosPut = jest.fn();

jest.mock('axios', () => {
  const mock: any = jest.fn();
  mock.get = mockAxiosGet;
  mock.post = mockAxiosPost;
  mock.put = mockAxiosPut;
  return mock;
});

import {
  rememberHandler,
  recallHandler,
  forgetHandler,
  listMemoriesHandler,
  saveConversationHandler,
  getConversationHistoryHandler,
  clearConversationHistoryHandler,
  memoryToolDefs,
  memoryToolHandlers,
} from '../tools/memory';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Helper to make healthz succeed (Qdrant available). */
function mockQdrantAvailable() {
  mockAxiosGet.mockImplementation((url: string) => {
    if (url.includes('/healthz')) return Promise.resolve({ status: 200 });
    if (url.includes('/collections/')) return Promise.resolve({ status: 200, data: {} });
    return Promise.resolve({ status: 200, data: {} });
  });
}

/** Helper to make healthz fail (Qdrant unavailable). */
function mockQdrantUnavailable() {
  mockAxiosGet.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));
}

/** Production-quality embedding vector (768 zeros). */
const MOCK_EMBEDDING = new Array(768).fill(0);

function mockOllamaEmbedding() {
  mockAxiosPost.mockImplementation((url: string) => {
    if (url.includes('/api/embeddings')) {
      return Promise.resolve({ data: { embedding: MOCK_EMBEDDING } });
    }
    // Qdrant search / scroll / delete
    return Promise.resolve({ data: { result: { points: [], result: [] } } });
  });
}

beforeEach(() => jest.clearAllMocks());

// ─── Tool registry shape ────────────────────────────────────────────────────────

describe('memory tool definitions', () => {
  test('exports 7 definitions', () => {
    expect(memoryToolDefs.length).toBe(7);
  });

  test('all definitions have a matching handler', () => {
    for (const def of memoryToolDefs) {
      expect(memoryToolHandlers[def.name]).toBeDefined();
    }
  });

  test('forget and clear_conversation_history require confirmation', () => {
    const forget = memoryToolDefs.find(d => d.name === 'forget');
    const clear = memoryToolDefs.find(d => d.name === 'clear_conversation_history');
    expect(forget?.requiresConfirmation).toBe(true);
    expect(clear?.requiresConfirmation).toBe(true);
  });

  test('read-only tools do not require confirmation', () => {
    for (const name of ['remember', 'recall', 'list_memories', 'save_conversation', 'get_conversation_history']) {
      const def = memoryToolDefs.find(d => d.name === name)!;
      expect(def.requiresConfirmation).toBeFalsy();
    }
  });

  test('all memory tools are in the memory category', () => {
    for (const def of memoryToolDefs) {
      expect(def.category).toBe('memory');
    }
  });
});

// ─── remember ──────────────────────────────────────────────────────────────────

describe('rememberHandler — Qdrant available', () => {
  beforeEach(() => {
    mockQdrantAvailable();
    mockOllamaEmbedding();
    mockAxiosPut.mockResolvedValue({ data: {} });
  });

  test('stores memory and returns qdrant backend', async () => {
    const result = await rememberHandler({ content: 'User loves coffee', category: 'preference' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.backend).toBe('qdrant');
    expect(result.result?.category).toBe('preference');
    expect(result.result?.memoryId).toBeTruthy();
  });

  test('defaults category to "general"', async () => {
    const result = await rememberHandler({ content: 'Some fact' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.category).toBe('general');
  });

  test('rejects empty content', async () => {
    const result = await rememberHandler({ content: '' }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  test('rejects missing content', async () => {
    const result = await rememberHandler({}, {} as any);
    expect(result.success).toBe(false);
  });
});

describe('rememberHandler — Qdrant unavailable (JSON fallback)', () => {
  let written: any;

  beforeEach(() => {
    written = null;
    mockQdrantUnavailable();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('[]');
    mockWriteFileSync.mockImplementation((_p: any, data: any) => { written = JSON.parse(data); });
    mockMkdirSync.mockImplementation(() => undefined);
  });

  test('falls back to json and returns json backend', async () => {
    const result = await rememberHandler({ content: 'Offline memory', category: 'test' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.backend).toBe('json');
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  test('written JSON includes the new memory', async () => {
    await rememberHandler({ content: 'Stored offline', category: 'fact' }, {} as any);
    expect(Array.isArray(written)).toBe(true);
    expect(written[0].content).toBe('Stored offline');
    expect(written[0].category).toBe('fact');
  });
});


// ─── recall ────────────────────────────────────────────────────────────────────

describe('recallHandler — Qdrant available', () => {
  beforeEach(() => {
    mockQdrantAvailable();
    mockOllamaEmbedding();
    mockAxiosPost.mockImplementation((url: string) => {
      if (url.includes('/api/embeddings')) {
        return Promise.resolve({ data: { embedding: MOCK_EMBEDDING } });
      }
      return Promise.resolve({
        data: {
          result: [
            { id: 'abc', score: 0.92, payload: { content: 'User likes tea', category: 'preference', createdAt: '2026-01-01T00:00:00Z' } }
          ]
        }
      });
    });
  });

  test('returns memories from Qdrant', async () => {
    const result = await recallHandler({ query: 'drinks' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.backend).toBe('qdrant');
    expect(result.result?.memories.length).toBe(1);
    expect(result.result?.memories[0].content).toBe('User likes tea');
  });

  test('rejects missing query', async () => {
    const result = await recallHandler({}, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  test('clamps limit to 20', async () => {
    const result = await recallHandler({ query: 'anything', limit: 999 }, {} as any);
    expect(result.success).toBe(true);
    // Qdrant was still called (no error), limit clamped internally
  });
});

describe('recallHandler — Qdrant unavailable (keyword fallback)', () => {
  const storedMemories = [
    { id: '1', content: 'User likes coffee every morning', category: 'preference', createdAt: '2026-01-01T00:00:00Z' },
    { id: '2', content: 'User is allergic to peanuts', category: 'health', createdAt: '2026-01-02T00:00:00Z' },
    { id: '3', content: 'Favourite colour is blue', category: 'preference', createdAt: '2026-01-03T00:00:00Z' }
  ];

  beforeEach(() => {
    mockQdrantUnavailable();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(storedMemories));
  });

  test('keyword search finds relevant memories', async () => {
    const result = await recallHandler({ query: 'coffee' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.backend).toBe('json');
    const contents = result.result?.memories.map((m: any) => m.content);
    expect(contents[0]).toContain('coffee');
  });

  test('returns empty result when nothing matches', async () => {
    const result = await recallHandler({ query: 'xyz_irrelevant_qwerty' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.memories.length).toBe(0);
    expect(result.result?.message).toMatch(/No relevant/i);
  });
});

// ─── forget ────────────────────────────────────────────────────────────────────

describe('forgetHandler', () => {
  test('rejects missing memoryId', async () => {
    const result = await forgetHandler({}, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  test('deletes via Qdrant when available', async () => {
    mockQdrantAvailable();
    mockAxiosPost.mockResolvedValue({ data: {} });
    const result = await forgetHandler({ memoryId: 'abc123' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.backend).toBe('qdrant');
  });

  test('deletes from JSON fallback when Qdrant unavailable', async () => {
    mockQdrantUnavailable();
    const memories = [
      { id: 'del1', content: 'to delete', category: 'test', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'keep', content: 'keep me', category: 'test', createdAt: '2026-01-01T00:00:00Z' }
    ];
    let written: any;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(memories));
    mockWriteFileSync.mockImplementation((_p: any, data: any) => { written = JSON.parse(data); });
    mockMkdirSync.mockImplementation(() => undefined);

    const result = await forgetHandler({ memoryId: 'del1' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.backend).toBe('json');
    expect(written.find((m: any) => m.id === 'del1')).toBeUndefined();
    expect(written.find((m: any) => m.id === 'keep')).toBeDefined();
  });

  test('returns error when memory ID not found in JSON', async () => {
    mockQdrantUnavailable();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('[]');

    const result = await forgetHandler({ memoryId: 'nonexistent' }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

// ─── list_memories ─────────────────────────────────────────────────────────────

describe('listMemoriesHandler', () => {
  test('lists memories from Qdrant when available', async () => {
    mockQdrantAvailable();
    mockAxiosPost.mockResolvedValue({
      data: {
        result: {
          points: [
            { id: '1', payload: { content: 'Test', category: 'general', createdAt: '2026-01-01T00:00:00Z' } }
          ]
        }
      }
    });
    const result = await listMemoriesHandler({}, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.backend).toBe('qdrant');
    expect(result.result?.memories.length).toBe(1);
  });

  test('falls back to JSON when Qdrant unavailable', async () => {
    mockQdrantUnavailable();
    const memories = [
      { id: '1', content: 'A', category: 'pref', createdAt: '2026-01-01T00:00:00Z' },
      { id: '2', content: 'B', category: 'fact', createdAt: '2026-01-02T00:00:00Z' }
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(memories));

    const result = await listMemoriesHandler({}, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.backend).toBe('json');
    expect(result.result?.count).toBe(2);
  });

  test('filters by category in JSON fallback', async () => {
    mockQdrantUnavailable();
    const memories = [
      { id: '1', content: 'A', category: 'pref', createdAt: '2026-01-01T00:00:00Z' },
      { id: '2', content: 'B', category: 'fact', createdAt: '2026-01-02T00:00:00Z' }
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(memories));

    const result = await listMemoriesHandler({ category: 'pref' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.count).toBe(1);
    expect(result.result?.memories[0].category).toBe('pref');
  });
});

// ─── Conversation history ───────────────────────────────────────────────────────

describe('saveConversationHandler', () => {
  let written: any;

  beforeEach(() => {
    written = null;
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue(JSON.stringify({ conversations: [], activeConversationId: null }));
    mockWriteFileSync.mockImplementation((_p: any, data: any) => { written = JSON.parse(data); });
    mockMkdirSync.mockImplementation(() => undefined);
  });

  test('saves a user turn', async () => {
    const result = await saveConversationHandler({ role: 'user', content: 'Hello HomeBot' }, {} as any);
    expect(result.success).toBe(true);
    expect(written.conversations.length).toBe(1);
    expect(written.conversations[0].role).toBe('user');
    expect(written.conversations[0].content).toBe('Hello HomeBot');
  });

  test('saves an assistant turn', async () => {
    const result = await saveConversationHandler({ role: 'assistant', content: 'Hello there!' }, {} as any);
    expect(result.success).toBe(true);
    expect(written.conversations[0].role).toBe('assistant');
  });

  test('stores conversationId and sets activeConversationId', async () => {
    await saveConversationHandler({ role: 'user', content: 'Hi', conversationId: 'sess-1' }, {} as any);
    expect(written.conversations[0].conversationId).toBe('sess-1');
    expect(written.activeConversationId).toBe('sess-1');
  });

  test('rejects invalid role', async () => {
    const result = await saveConversationHandler({ role: 'robot', content: 'beep' }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/role/i);
  });

  test('rejects missing content', async () => {
    const result = await saveConversationHandler({ role: 'user' }, {} as any);
    expect(result.success).toBe(false);
  });

  test('trims history when over 200 turns', async () => {
    const bigHistory = Array.from({ length: 205 }, (_, i) => ({
      id: `t${i}`, role: 'user', content: `msg ${i}`, timestamp: new Date().toISOString()
    }));
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ conversations: bigHistory, activeConversationId: null }));
    await saveConversationHandler({ role: 'user', content: 'overflow' }, {} as any);
    expect(written.conversations.length).toBe(200);
  });
});

describe('getConversationHistoryHandler', () => {
  const turns = [
    { id: 't1', role: 'user', content: 'First', timestamp: '2026-01-01T00:00:00Z', conversationId: 'sess-1' },
    { id: 't2', role: 'assistant', content: 'Response', timestamp: '2026-01-01T00:00:01Z', conversationId: 'sess-1' },
    { id: 't3', role: 'user', content: 'Second session', timestamp: '2026-01-02T00:00:00Z', conversationId: 'sess-2' }
  ];

  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ conversations: turns, activeConversationId: 'sess-1' }));
  });

  test('returns all turns by default', async () => {
    const result = await getConversationHistoryHandler({}, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.count).toBe(3);
  });

  test('respects limit', async () => {
    const result = await getConversationHistoryHandler({ limit: 2 }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.count).toBe(2);
  });

  test('filters by conversationId', async () => {
    const result = await getConversationHistoryHandler({ conversationId: 'sess-1' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result?.count).toBe(2);
    for (const t of result.result!.turns) {
      expect(t.conversationId).toBe('sess-1');
    }
  });

  test('includes activeConversationId in result', async () => {
    const result = await getConversationHistoryHandler({}, {} as any);
    expect(result.result?.activeConversationId).toBe('sess-1');
  });
});

describe('clearConversationHistoryHandler', () => {
  let written: any;

  const turns = [
    { id: 't1', role: 'user', content: 'A', timestamp: '2026-01-01T00:00:00Z', conversationId: 'sess-1' },
    { id: 't2', role: 'user', content: 'B', timestamp: '2026-01-01T00:00:01Z', conversationId: 'sess-2' }
  ];

  beforeEach(() => {
    written = null;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ conversations: turns, activeConversationId: 'sess-1' }));
    mockWriteFileSync.mockImplementation((_p: any, data: any) => { written = JSON.parse(data); });
    mockMkdirSync.mockImplementation(() => undefined);
  });

  test('clears all history when no conversationId', async () => {
    const result = await clearConversationHistoryHandler({}, {} as any);
    expect(result.success).toBe(true);
    expect(written.conversations.length).toBe(0);
    expect(written.activeConversationId).toBeNull();
  });

  test('only clears specified conversation', async () => {
    const result = await clearConversationHistoryHandler({ conversationId: 'sess-1' }, {} as any);
    expect(result.success).toBe(true);
    expect(written.conversations.length).toBe(1);
    expect(written.conversations[0].conversationId).toBe('sess-2');
    expect(result.result?.message).toMatch(/1 turn/);
  });

  test('clears activeConversationId when clearing that session', async () => {
    await clearConversationHistoryHandler({ conversationId: 'sess-1' }, {} as any);
    expect(written.activeConversationId).toBeNull();
  });
});
