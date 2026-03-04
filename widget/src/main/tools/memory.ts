/**
 * SADIE Memory Tools
 *
 * Primary storage: Qdrant vector database (semantic search via nomic-embed-text).
 * Fallback storage: flat JSON file at memory/json-store/memories.json
 *   (used automatically when Qdrant is unavailable, with keyword matching).
 *
 * Conversation history tools use memory/json-store/conversation-history.json
 * independently of Qdrant.
 */

import { ToolDefinition, ToolHandler, ToolResult } from './types';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const COLLECTION_NAME = 'sadie_memories';
const EMBEDDING_MODEL = 'nomic-embed-text';

// Paths for JSON fallback stores
const JSON_STORE_DIR = path.join(os.homedir(), 'Desktop', 'sadie', 'memory', 'json-store');
const MEMORIES_JSON = path.join(JSON_STORE_DIR, 'memories.json');
const HISTORY_JSON = path.join(JSON_STORE_DIR, 'conversation-history.json');

// Maximum stored conversation turns (oldest trimmed first)
const MAX_HISTORY_TURNS = 200;

// ============= QDRANT HELPERS =============

/** Returns true when Qdrant is reachable (fast probe). */
async function isQdrantAvailable(): Promise<boolean> {
  try {
    await axios.get(`${QDRANT_URL}/healthz`, { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/** Get embedding from Ollama. */
async function getEmbedding(text: string): Promise<number[]> {
  const response = await axios.post(`${OLLAMA_URL}/api/embeddings`, {
    model: EMBEDDING_MODEL,
    prompt: text
  }, { timeout: 15000 });
  return response.data.embedding;
}

/** Create the Qdrant collection if it does not yet exist. */
async function ensureCollection(): Promise<void> {
  try {
    await axios.get(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, { timeout: 3000 });
  } catch (error: any) {
    if (error.response?.status === 404) {
      await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
        vectors: { size: 768, distance: 'Cosine' }
      }, { timeout: 5000 });
      console.log('[Memory] Created Qdrant collection:', COLLECTION_NAME);
    } else {
      throw error;
    }
  }
}

// ============= JSON FALLBACK HELPERS =============

interface MemoryRecord {
  id: string;
  content: string;
  category: string;
  createdAt: string;
}

function readMemoriesJson(): MemoryRecord[] {
  try {
    if (!fs.existsSync(MEMORIES_JSON)) return [];
    const raw = fs.readFileSync(MEMORIES_JSON, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMemoriesJson(memories: MemoryRecord[]): void {
  fs.mkdirSync(JSON_STORE_DIR, { recursive: true });
  fs.writeFileSync(MEMORIES_JSON, JSON.stringify(memories, null, 2), 'utf8');
}

/** Very simple keyword relevance: count matching words, normalised to 0-1. */
function keywordScore(query: string, content: string): number {
  const qWords = query.toLowerCase().split(/\W+/).filter(Boolean);
  if (qWords.length === 0) return 0;
  const lower = content.toLowerCase();
  const hits = qWords.filter(w => lower.includes(w)).length;
  return hits / qWords.length;
}

// ============= CONVERSATION HISTORY HELPERS =============

interface ConversationTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  conversationId?: string;
}

interface ConversationStore {
  conversations: ConversationTurn[];
  activeConversationId: string | null;
}

function readHistoryJson(): ConversationStore {
  try {
    if (!fs.existsSync(HISTORY_JSON)) return { conversations: [], activeConversationId: null };
    return JSON.parse(fs.readFileSync(HISTORY_JSON, 'utf8')) as ConversationStore;
  } catch {
    return { conversations: [], activeConversationId: null };
  }
}

function writeHistoryJson(store: ConversationStore): void {
  fs.mkdirSync(JSON_STORE_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_JSON, JSON.stringify(store, null, 2), 'utf8');
}

// ============= TOOL DEFINITIONS =============

export const rememberDef: ToolDefinition = {
  name: 'remember',
  description: 'Store important information in long-term memory. Use this to remember facts, preferences, or context about the user that should persist across conversations.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The information to remember (e.g., "User prefers dark mode", "User\'s name is John")'
      },
      category: {
        type: 'string',
        description: 'Category for the memory (e.g., "preference", "fact", "context", "task")',
        default: 'general'
      }
    },
    required: ['content']
  }
};

export const recallDef: ToolDefinition = {
  name: 'recall',
  description: 'Search long-term memory for relevant information. Use this to recall facts, preferences, or context about the user.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to search for in memory (e.g., "user preferences", "what is user\'s name")'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 5)',
        default: 5
      }
    },
    required: ['query']
  }
};

export const forgetDef: ToolDefinition = {
  name: 'forget',
  description: 'Remove a specific memory from long-term storage. Use when asked to forget something.',
  category: 'memory',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The ID of the memory to forget'
      }
    },
    required: ['memoryId']
  }
};

export const listMemoriesDef: ToolDefinition = {
  name: 'list_memories',
  description: 'List all stored memories, optionally filtered by category.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category (optional)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 20)',
        default: 20
      }
    },
    required: []
  }
};

export const saveConversationDef: ToolDefinition = {
  name: 'save_conversation',
  description: 'Save a message turn to the conversation history log for future context.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        description: 'Speaker role: "user", "assistant", or "system"',
        enum: ['user', 'assistant', 'system']
      },
      content: {
        type: 'string',
        description: 'The message content to save'
      },
      conversationId: {
        type: 'string',
        description: 'Optional conversation session identifier'
      }
    },
    required: ['role', 'content']
  }
};

export const getConversationHistoryDef: ToolDefinition = {
  name: 'get_conversation_history',
  description: 'Retrieve recent conversation history, optionally filtered by conversation ID.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of most-recent turns to return (default: 20)',
        default: 20
      },
      conversationId: {
        type: 'string',
        description: 'Filter to a specific conversation session (optional)'
      }
    },
    required: []
  }
};

export const clearConversationHistoryDef: ToolDefinition = {
  name: 'clear_conversation_history',
  description: 'Clear all saved conversation history. This cannot be undone.',
  category: 'memory',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'If provided, only clear turns from this conversation (otherwise clears all)'
      }
    },
    required: []
  }
};

// ============= TOOL HANDLERS =============

export const rememberHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const content = args.content;
  if (!content || typeof content !== 'string') {
    return { success: false, error: 'Content is required' };
  }
  const category = args.category || 'general';
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

  // Try Qdrant first
  try {
    if (await isQdrantAvailable()) {
      await ensureCollection();
      const embedding = await getEmbedding(content);
      await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
        points: [{ id, vector: embedding, payload: { content, category, createdAt: new Date().toISOString() } }]
      }, { timeout: 10000 });
      return {
        success: true,
        result: {
          message: `Remembered (vector): "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`,
          memoryId: id, category, backend: 'qdrant'
        }
      };
    }
  } catch (err: any) {
    console.warn('[Memory] Qdrant unavailable, falling back to JSON:', err.message);
  }

  // JSON fallback
  const memories = readMemoriesJson();
  memories.push({ id, content, category, createdAt: new Date().toISOString() });
  writeMemoriesJson(memories);
  return {
    success: true,
    result: {
      message: `Remembered (json): "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`,
      memoryId: id, category, backend: 'json'
    }
  };
};

export const recallHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const query = args.query;
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'Query is required' };
  }
  const limit = Math.min(args.limit || 5, 20);

  // Try Qdrant first
  try {
    if (await isQdrantAvailable()) {
      await ensureCollection();
      const embedding = await getEmbedding(query);
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`,
        { vector: embedding, limit, with_payload: true, score_threshold: 0.5 },
        { timeout: 10000 }
      );
      const memories = response.data.result.map((hit: any) => ({
        id: hit.id,
        content: hit.payload.content,
        category: hit.payload.category,
        createdAt: hit.payload.createdAt,
        relevance: Math.round(hit.score * 100) + '%'
      }));
      return {
        success: true,
        result: { message: `Found ${memories.length} relevant memories (vector)`, memories, backend: 'qdrant' }
      };
    }
  } catch (err: any) {
    console.warn('[Memory] Qdrant unavailable, falling back to JSON:', err.message);
  }

  // JSON keyword fallback
  const all = readMemoriesJson();
  const scored = all
    .map(m => ({ ...m, score: keywordScore(query, m.content) }))
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    success: true,
    result: {
      message: scored.length > 0 ? `Found ${scored.length} relevant memories (keyword)` : 'No relevant memories found.',
      memories: scored.map(({ score: _, ...m }) => ({ ...m, relevance: 'keyword' })),
      backend: 'json'
    }
  };
};

export const forgetHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const memoryId = args.memoryId;
  if (!memoryId) {
    return { success: false, error: 'Memory ID is required' };
  }

  // Try Qdrant first
  try {
    if (await isQdrantAvailable()) {
      await axios.post(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
        points: [memoryId]
      }, { timeout: 5000 });
      return { success: true, result: { message: `Memory ${memoryId} forgotten (qdrant).`, backend: 'qdrant' } };
    }
  } catch (err: any) {
    console.warn('[Memory] Qdrant unavailable, falling back to JSON:', err.message);
  }

  // JSON fallback
  const memories = readMemoriesJson();
  const before = memories.length;
  const filtered = memories.filter(m => m.id !== memoryId);
  if (filtered.length === before) {
    return { success: false, error: `Memory ${memoryId} not found.` };
  }
  writeMemoriesJson(filtered);
  return { success: true, result: { message: `Memory ${memoryId} forgotten (json).`, backend: 'json' } };
};

export const listMemoriesHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const category = args.category as string | undefined;
  const limit = Math.min(args.limit || 20, 100);

  // Try Qdrant first
  try {
    if (await isQdrantAvailable()) {
      await ensureCollection();
      const filter = category
        ? { must: [{ key: 'category', match: { value: category } }] }
        : undefined;
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`,
        { limit, with_payload: true, filter },
        { timeout: 10000 }
      );
      const memories = response.data.result.points.map((p: any) => ({
        id: p.id,
        content: p.payload.content,
        category: p.payload.category,
        createdAt: p.payload.createdAt
      }));
      return { success: true, result: { count: memories.length, memories, backend: 'qdrant' } };
    }
  } catch (err: any) {
    console.warn('[Memory] Qdrant unavailable, falling back to JSON:', err.message);
  }

  // JSON fallback
  let memories = readMemoriesJson();
  if (category) memories = memories.filter(m => m.category === category);
  memories = memories.slice(-limit);
  return { success: true, result: { count: memories.length, memories, backend: 'json' } };
};

export const saveConversationHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const { role, content, conversationId } = args;
  if (!role || !content) {
    return { success: false, error: 'Role and content are required' };
  }
  if (!['user', 'assistant', 'system'].includes(role)) {
    return { success: false, error: 'Role must be user, assistant, or system' };
  }

  const store = readHistoryJson();
  const turn: ConversationTurn = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    role,
    content,
    timestamp: new Date().toISOString(),
    ...(conversationId ? { conversationId } : {})
  };
  store.conversations.push(turn);

  // Trim oldest turns if over limit
  if (store.conversations.length > MAX_HISTORY_TURNS) {
    store.conversations = store.conversations.slice(-MAX_HISTORY_TURNS);
  }
  if (conversationId) store.activeConversationId = conversationId;

  writeHistoryJson(store);
  return { success: true, result: { message: 'Turn saved.', id: turn.id } };
};

export const getConversationHistoryHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const limit = Math.min(args.limit || 20, 100);
  const conversationId = args.conversationId as string | undefined;

  const store = readHistoryJson();
  let turns = store.conversations;
  if (conversationId) {
    turns = turns.filter(t => t.conversationId === conversationId);
  }
  turns = turns.slice(-limit);

  return {
    success: true,
    result: {
      count: turns.length,
      turns,
      activeConversationId: store.activeConversationId
    }
  };
};

export const clearConversationHistoryHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const conversationId = args.conversationId as string | undefined;
  const store = readHistoryJson();

  if (conversationId) {
    const before = store.conversations.length;
    store.conversations = store.conversations.filter(t => t.conversationId !== conversationId);
    const removed = before - store.conversations.length;
    if (store.activeConversationId === conversationId) store.activeConversationId = null;
    writeHistoryJson(store);
    return { success: true, result: { message: `Cleared ${removed} turns from conversation ${conversationId}.` } };
  }

  writeHistoryJson({ conversations: [], activeConversationId: null });
  return { success: true, result: { message: 'All conversation history cleared.' } };
};

// ============= EXPORTS =============

export const memoryToolDefs = [
  rememberDef,
  recallDef,
  forgetDef,
  listMemoriesDef,
  saveConversationDef,
  getConversationHistoryDef,
  clearConversationHistoryDef
];

export const memoryToolHandlers: Record<string, ToolHandler> = {
  remember: rememberHandler,
  recall: recallHandler,
  forget: forgetHandler,
  list_memories: listMemoriesHandler,
  save_conversation: saveConversationHandler,
  get_conversation_history: getConversationHistoryHandler,
  clear_conversation_history: clearConversationHistoryHandler
};
