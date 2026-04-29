/**
 * Memory Manager - Handles persistence of conversations, settings, and tool usage stats
 * All data is stored locally in JSON files under the memory/json-store/ directory
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Message } from '../shared/types';

// Resolve memory store path relative to app root (not asar)
function getMemoryStorePath(): string {
  // In development, use the project's memory folder
  // In production, this would be relative to the app installation
  const isDev = !app.isPackaged;
  if (isDev) {
    // Go up from widget/out/main (3 levels) to reach the sadie project root
    return path.resolve(__dirname, '..', '..', '..', 'memory', 'json-store');
  }
  // In production, use userData folder for persistence
  return path.join(app.getPath('userData'), 'memory', 'json-store');
}

// Ensure directory exists
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Type definitions for stored data
export interface StoredConversation {
  id: string;
  title: string;
  messages: Message[];
  /** Optional per-conversation system prompt (user-editable) */
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationStore {
  conversations: StoredConversation[];
  activeConversationId: string | null;
}

export interface UserPreferences {
  theme: 'dark' | 'light';
  ollamaEndpoint: string;
  n8nEndpoint: string;
  defaultModel: string;
  hotkey: string;
  windowPosition: { x: number; y: number } | null;
  windowSize: { width: number; height: number };
  alwaysOnTop: boolean;
  startMinimized: boolean;
  autoSaveConversations: boolean;
}

export interface ToolUsageStats {
  totalToolCalls: number;
  toolUsage: Record<string, number>;
  lastUpdated: string | null;
}

// File paths
const STORE_FILES = {
  preferences: 'user-preferences.json',
  conversations: 'conversation-history.json',
  toolStats: 'tool-usage-stats.json',
};

// Default values
const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  ollamaEndpoint: 'http://127.0.0.1:11434',
  n8nEndpoint: 'http://localhost:5678',
  defaultModel: 'phi4',
  hotkey: 'Ctrl+Shift+Space',
  windowPosition: null,
  windowSize: { width: 400, height: 600 },
  alwaysOnTop: true,
  startMinimized: false,
  autoSaveConversations: true,
};

const DEFAULT_CONVERSATION_STORE: ConversationStore = {
  conversations: [],
  activeConversationId: null,
};

const DEFAULT_TOOL_STATS: ToolUsageStats = {
  totalToolCalls: 0,
  toolUsage: {},
  lastUpdated: null,
};

// Generic read/write helpers
function readJsonFile<T>(filename: string, defaultValue: T): T {
  const storePath = getMemoryStorePath();
  ensureDir(storePath);
  const filePath = path.join(storePath, filename);
  
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    }
  } catch (err) {
    console.error(`[MemoryManager] Error reading ${filename}:`, err);
  }
  
  // Return default and initialize file
  writeJsonFile(filename, defaultValue);
  return defaultValue;
}

// Write queue: one pending write per file to avoid concurrent corruption.
// If a write is already in-flight we swap the pending payload so the latest
// data always wins on the next flush.
const _writeQueue = new Map<string, { data: string; resolve: (ok: boolean) => void }>();
const _writeInFlight = new Set<string>();

function flushWrite(filePath: string): void {
  const entry = _writeQueue.get(filePath);
  if (!entry || _writeInFlight.has(filePath)) return;
  _writeQueue.delete(filePath);
  _writeInFlight.add(filePath);
  fs.writeFile(filePath, entry.data, 'utf-8', (err) => {
    _writeInFlight.delete(filePath);
    if (err) {
      console.error(`[MemoryManager] Async write failed for ${path.basename(filePath)}:`, err);
      entry.resolve(false);
    } else {
      entry.resolve(true);
    }
    // Flush next pending write for this file if one arrived while in-flight
    if (_writeQueue.has(filePath)) flushWrite(filePath);
  });
}

/**
 * Testing helper — synchronously flushes all queued async writes to disk.
 * Call this in tests between a save and a subsequent read to avoid race
 * conditions caused by the async write queue.
 * @internal Do not call in production code.
 */
export function __flushWritesSync(): void {
  for (const [filePath, entry] of Array.from(_writeQueue.entries())) {
    _writeQueue.delete(filePath);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, entry.data, 'utf-8');
      entry.resolve(true);
    } catch (err) {
      entry.resolve(false);
    }
  }
}

function writeJsonFile<T>(filename: string, data: T): boolean {
  const storePath = getMemoryStorePath();
  ensureDir(storePath);
  const filePath = path.join(storePath, filename);
  const serialised = JSON.stringify(data, null, 2);
  // Fire-and-forget async write; queue deduplication ensures no torn writes.
  _writeQueue.set(filePath, { data: serialised, resolve: () => {} });
  setImmediate(() => flushWrite(filePath));
  return true;
}

// ============= User Preferences =============

export function loadPreferences(): UserPreferences {
  return readJsonFile(STORE_FILES.preferences, DEFAULT_PREFERENCES);
}

export function savePreferences(prefs: Partial<UserPreferences>): UserPreferences {
  const current = loadPreferences();
  const updated = { ...current, ...prefs };
  writeJsonFile(STORE_FILES.preferences, updated);
  return updated;
}

// ============= Conversations =============

export function loadConversationStore(): ConversationStore {
  // Check in-memory write queue first to avoid stale-disk reads when a write is pending.
  const filePath = path.join(getMemoryStorePath(), STORE_FILES.conversations);
  const pending = _writeQueue.get(filePath);
  if (pending) {
    try {
      return JSON.parse(pending.data) as ConversationStore;
    } catch {
      // fall through to disk read
    }
  }
  return readJsonFile(STORE_FILES.conversations, DEFAULT_CONVERSATION_STORE);
}

export function saveConversationStore(store: ConversationStore): boolean {
  return writeJsonFile(STORE_FILES.conversations, store);
}

export function getConversation(conversationId: string): StoredConversation | null {
  const store = loadConversationStore();
  return store.conversations.find(c => c.id === conversationId) || null;
}

export function saveConversation(conversation: StoredConversation): boolean {
  const store = loadConversationStore();
  const existingIndex = store.conversations.findIndex(c => c.id === conversation.id);
  
  if (existingIndex >= 0) {
    store.conversations[existingIndex] = {
      ...conversation,
      updatedAt: new Date().toISOString(),
    };
  } else {
    store.conversations.push({
      ...conversation,
      createdAt: conversation.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  
  return saveConversationStore(store);
}

export function deleteConversation(conversationId: string): boolean {
  const store = loadConversationStore();
  store.conversations = store.conversations.filter(c => c.id !== conversationId);
  if (store.activeConversationId === conversationId) {
    store.activeConversationId = null;
  }
  return saveConversationStore(store);
}

export function setActiveConversation(conversationId: string | null): boolean {
  const store = loadConversationStore();
  store.activeConversationId = conversationId;
  return saveConversationStore(store);
}

export function createNewConversation(title?: string): StoredConversation {
  const id = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  const conversation: StoredConversation = {
    id,
    title: title || `Conversation ${new Date().toLocaleDateString()}`,
    messages: [],
    systemPrompt: '',
    createdAt: now,
    updatedAt: now,
  };

  // Single atomic write: add conversation AND set it active in one store update.
  // Previously two separate writes (saveConversation + setActiveConversation) would
  // race through the async write queue — the second read would see stale disk state
  // and the deduplication map would silently drop the first write.
  const store = loadConversationStore();
  store.conversations.push(conversation);
  store.activeConversationId = id;
  saveConversationStore(store);

  return conversation;
}

export function addMessageToConversation(conversationId: string, message: Message): boolean {
  let conversation = getConversation(conversationId);
  if (!conversation) {
    const now = new Date().toISOString();
    conversation = { id: conversationId, title: 'Untitled', messages: [], createdAt: now, updatedAt: now };
    const store = loadConversationStore();
    store.conversations.push(conversation);
    saveConversationStore(store);
  }
  
  // Ensure message has an ID
  const messageWithId: Message = {
    ...message,
    id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  };
  
  conversation.messages.push(messageWithId);
  
  // Auto-generate title from first user message if still default
  if (conversation.messages.length === 1 && message.role === 'user') {
    const preview = message.content.slice(0, 50);
    conversation.title = preview + (message.content.length > 50 ? '...' : '');
  }

  const res = saveConversation(conversation);
  if (!res) console.error(`[MemoryManager] Failed to save conversation conv=${conversationId} after addMessage`);
  return res;
}

export function updateMessageInConversation(
  conversationId: string, 
  messageId: string, 
  updates: Partial<Message>
): boolean {
  const conversation = getConversation(conversationId);
  if (!conversation) return false;
  
  const msgIndex = conversation.messages.findIndex(m => m.id === messageId);
  if (msgIndex === -1) return false;
  
  conversation.messages[msgIndex] = {
    ...conversation.messages[msgIndex],
    ...updates,
  };
  
  return saveConversation(conversation);
}

// ============= Conversation Compaction =============

const COMPACT_KEEP_RECENT = 20;
const ARCHIVE_DIR = 'archives';

function compressTurnsForCompaction(messages: Message[]): string {
  return messages.map(m => {
    const speaker = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'SADIE' : 'System';
    const content = m.content
      .replace(/\[SEARCH RESULTS\][\s\S]*?\[\/SEARCH RESULTS\]/g, '[web search results]')
      .replace(/__SADIE_IMAGE__:[^\s]+/g, '[image]')
      .replace(/```[\s\S]*?```/g, '[code block]')
      .replace(/\s+/g, ' ')
      .trim();
    if (content.length <= 120) return `${speaker}: ${content}`;
    const sentences = content.match(/[^.!?\n]+[.!?\n]+/g) ?? [];
    if (sentences.length >= 2) {
      const first = sentences[0]!.trim().slice(0, 100);
      const last = sentences[sentences.length - 1]!.trim().slice(0, 80);
      return first === last ? `${speaker}: ${first}` : `${speaker}: ${first} … ${last}`;
    }
    return `${speaker}: ${content.slice(0, 150)}…`;
  }).join('\n');
}

export interface CompactResult {
  success: boolean;
  originalCount: number;
  compactedCount: number;
  archivePath?: string;
  error?: string;
}

export function compactConversation(conversationId: string, keepRecent = COMPACT_KEEP_RECENT): CompactResult {
  const conv = getConversation(conversationId);
  if (!conv) return { success: false, originalCount: 0, compactedCount: 0, error: 'Conversation not found' };

  const totalMessages = conv.messages.length;
  if (totalMessages <= keepRecent) {
    return { success: true, originalCount: totalMessages, compactedCount: totalMessages, error: 'Not enough messages to compact' };
  }

  const olderMessages = conv.messages.slice(0, totalMessages - keepRecent);
  const recentMessages = conv.messages.slice(totalMessages - keepRecent);

  // Archive original messages to a separate file
  const storePath = getMemoryStorePath();
  const archiveDir = path.join(storePath, ARCHIVE_DIR);
  ensureDir(archiveDir);
  const archiveFile = path.join(archiveDir, `archive-${conversationId}.json`);

  // Append to existing archive if one exists
  let existingArchive: Message[] = [];
  try {
    if (fs.existsSync(archiveFile)) {
      const raw = fs.readFileSync(archiveFile, 'utf-8');
      existingArchive = JSON.parse(raw);
    }
  } catch { /* start fresh */ }

  const fullArchive = [...existingArchive, ...olderMessages];
  fs.writeFileSync(archiveFile, JSON.stringify(fullArchive, null, 2), 'utf-8');

  // Build a summary message from the older messages
  const summaryText = compressTurnsForCompaction(olderMessages);
  const summaryMessage: Message = {
    id: `summary_${Date.now()}`,
    role: 'system',
    content: `[Conversation summary — ${olderMessages.length} earlier messages compacted]\n\n${summaryText}`,
    timestamp: new Date().toISOString(),
  };

  // Replace messages: summary + recent
  conv.messages = [summaryMessage, ...recentMessages];
  conv.updatedAt = new Date().toISOString();
  saveConversation(conv);

  return {
    success: true,
    originalCount: totalMessages,
    compactedCount: conv.messages.length,
    archivePath: archiveFile,
  };
}

export function getConversationArchive(conversationId: string): Message[] | null {
  const storePath = getMemoryStorePath();
  const archiveFile = path.join(storePath, ARCHIVE_DIR, `archive-${conversationId}.json`);
  try {
    if (!fs.existsSync(archiveFile)) return null;
    return JSON.parse(fs.readFileSync(archiveFile, 'utf-8'));
  } catch {
    return null;
  }
}

// ============= Search & Export =============

export interface ConversationSearchResult {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  role: string;
  snippet: string;
  matchIndex: number;
  updatedAt: string;
}

/**
 * Full-text search across all stored conversations.
 * Returns one result per matching message with a snippet around the match.
 */
export function searchConversations(query: string, maxResults = 50): ConversationSearchResult[] {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const store = loadConversationStore();
  const results: ConversationSearchResult[] = [];

  for (const conv of store.conversations) {
    for (const msg of conv.messages || []) {
      const content = (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)) || '';
      const idx = content.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      // Build a ±80-char snippet around the match
      const start = Math.max(0, idx - 80);
      const end = Math.min(content.length, idx + q.length + 80);
      const snippet =
        (start > 0 ? '…' : '') +
        content.slice(start, end) +
        (end < content.length ? '…' : '');
      results.push({
        conversationId: conv.id,
        conversationTitle: conv.title || 'Untitled',
        messageId: msg.id || '',
        role: msg.role || 'unknown',
        snippet,
        matchIndex: idx,
        updatedAt: conv.updatedAt,
      });
      if (results.length >= maxResults) return results;
    }
  }

  return results;
}

/**
 * Render a single conversation as a Markdown string.
 */
export function exportConversationAsMarkdown(conversationId: string): string | null {
  const conv = getConversation(conversationId);
  if (!conv) return null;

  const created = new Date(conv.createdAt).toLocaleString();
  const updated = new Date(conv.updatedAt).toLocaleString();
  const lines: string[] = [
    `# ${conv.title || 'Untitled Conversation'}`,
    ``,
    `**Created:** ${created}  `,
    `**Updated:** ${updated}  `,
    `**Messages:** ${conv.messages.length}`,
    ``,
    `---`,
    ``,
  ];

  for (const msg of conv.messages) {
    const roleLabel = msg.role === 'user' ? '**You**' : msg.role === 'assistant' ? '**SADIE**' : `**${msg.role}**`;
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
    lines.push(`### ${roleLabel}`);
    lines.push(``);
    lines.push(content);
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Export a single conversation as a structured JSON string.
 */
export function exportConversationAsJSON(conversationId: string): string | null {
  const conv = getConversation(conversationId);
  if (!conv) return null;

  const payload = {
    id: conv.id,
    title: conv.title || 'Untitled Conversation',
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messageCount: conv.messages.length,
    messages: conv.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      ...(msg.createdAt ? { createdAt: msg.createdAt } : {}),
    })),
  };

  return JSON.stringify(payload, null, 2);
}

// ============= Tool Usage Stats =============

export function loadToolStats(): ToolUsageStats {
  return readJsonFile(STORE_FILES.toolStats, DEFAULT_TOOL_STATS);
}

export function recordToolUsage(toolName: string): void {
  const stats = loadToolStats();
  stats.totalToolCalls += 1;
  stats.toolUsage[toolName] = (stats.toolUsage[toolName] || 0) + 1;
  stats.lastUpdated = new Date().toISOString();
  writeJsonFile(STORE_FILES.toolStats, stats);
}

// ============= Export all as namespace =============

export const MemoryManager = {
  // Preferences
  loadPreferences,
  savePreferences,
  
  // Conversations
  loadConversationStore,
  saveConversationStore,
  getConversation,
  saveConversation,
  deleteConversation,
  setActiveConversation,
  createNewConversation,
  addMessageToConversation,
  updateMessageInConversation,
  
  // Tool stats
  loadToolStats,
  recordToolUsage,

  // Compaction
  compactConversation,
  getConversationArchive,

  // Search & Export
  searchConversations,
  exportConversationAsMarkdown,
  exportConversationAsJSON,
};

export default MemoryManager;
