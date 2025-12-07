/**
 * Memory Manager - Handles persistence of conversations, settings, and tool usage stats
 * All data is stored locally in JSON files under the memory/json-store/ directory
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Message, Settings } from '../shared/types';

// Resolve memory store path relative to app root (not asar)
function getMemoryStorePath(): string {
  // In development, use the project's memory folder
  // In production, this would be relative to the app installation
  const isDev = !app.isPackaged;
  if (isDev) {
    // Go up from widget/dist/main to widget, then up to sadie root
    return path.resolve(__dirname, '..', '..', '..', '..', 'memory', 'json-store');
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
  ollamaEndpoint: 'http://localhost:11434',
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

function writeJsonFile<T>(filename: string, data: T): boolean {
  const storePath = getMemoryStorePath();
  ensureDir(storePath);
  const filePath = path.join(storePath, filename);
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`[MemoryManager] Error writing ${filename}:`, err);
    return false;
  }
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
    createdAt: now,
    updatedAt: now,
  };
  
  saveConversation(conversation);
  setActiveConversation(id);
  
  return conversation;
}

export function addMessageToConversation(conversationId: string, message: Message): boolean {
  const conversation = getConversation(conversationId);
  if (!conversation) {
    return false;
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
  
  return saveConversation(conversation);
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
};

export default MemoryManager;
