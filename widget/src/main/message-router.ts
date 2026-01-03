// =====================
// =====================
// Memory Policy Types & Constants (Router-Owned)
// =====================
// =====================
// Memory Retrieval Policy Constants (Router-Owned)
// =====================

import { 
  streamFromProvider, 
  ProviderConfig, 
  ModelProvider, 
  DEFAULT_MODELS,
  ChatMessage as ProviderChatMessage 
} from './providers';

// Import response formatting utilities
import {
  formatNbaResultDirectly,
  formatWeatherResultDirectly,
  summarizeToolResults,
  normalizeToolName,
  TOOL_ALIASES,
} from './routing/response-formatter';

// Helper to get user settings for memory policy
function getMemorySettings(): UserSettings {
  try {
    const { getSettings } = require('./config-manager');
    const settings = getSettings();
    return {
      saveConversationHistory: settings.saveConversationHistory ?? true,
      permissions: settings.permissions,
    };
  } catch (e) {
    // Fallback to safe defaults
    return { saveConversationHistory: true };
  }
}

export const MEMORY_RETRIEVAL_MIN_CONFIDENCE = 0.8;
export const MEMORY_RETRIEVAL_MAX_CANDIDATES = 20;
export const MEMORY_MAX_AGE_DAYS = 30;
export const MEMORY_MAX_INJECTED_ITEMS = 5;
export const MEMORY_RETRIEVAL_DENY_PATTERNS = [
  'session', 'temp', 'password', 'secret', 'token', 'credential', 'apikey', 'api key', 'bearer ',
];

export type MemoryEntry = {
  text: string;
  confidence: number;
  created: Date;
  redactionLevel?: 'none' | 'redact' | 'deny';
};

export type RetrievalResult = {
  allowed: boolean;
  memories: MemoryEntry[];
  reason?: string;
};

type RetrievalInput = {
  queryText: string;
  reflectionConfidence: number;
  settings: UserSettings;
  now: Date;
};

export function evaluateMemoryRetrievalPolicy(input: RetrievalInput): { allowed: boolean; reason?: string } {
  if (!input.settings.saveConversationHistory) {
    return { allowed: false, reason: 'conversation history disabled' };
  }
  if (input.reflectionConfidence === null || typeof input.reflectionConfidence !== 'number' || input.reflectionConfidence < MEMORY_RETRIEVAL_MIN_CONFIDENCE) {
    return { allowed: false, reason: 'reflection confidence below threshold' };
  }
  for (const pat of MEMORY_RETRIEVAL_DENY_PATTERNS) {
    if (input.queryText.toLowerCase().includes(pat)) {
      return { allowed: false, reason: `query denied by pattern: ${pat}` };
    }
  }
  return { allowed: true };
}

export function filterRetrievableMemories(memories: MemoryEntry[], now: Date): MemoryEntry[] {
  return memories.filter(mem => {
    if (mem.confidence < MEMORY_RETRIEVAL_MIN_CONFIDENCE) return false;
    const ageDays = (now.getTime() - mem.created.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > MEMORY_MAX_AGE_DAYS) return false;
    for (const pat of MEMORY_RETRIEVAL_DENY_PATTERNS) {
      if (mem.text.toLowerCase().includes(pat)) return false;
    }
    if (mem.redactionLevel === 'deny') return false;
    return true;
  });
}

export function prepareMemoriesForContext(memories: MemoryEntry[]): string[] {
  const out: string[] = [];
  for (const mem of memories) {
    let txt = mem.text;
    if (mem.redactionLevel === 'redact' || MEMORY_RETRIEVAL_DENY_PATTERNS.some(p => txt.toLowerCase().includes(p))) {
      txt = redactMemoryContent(txt);
    }
    if (txt.trim() && txt !== '[REDACTED CONTENT]') {
      out.push(txt.length > 120 ? txt.slice(0, 117) + '...' : txt);
    }
    if (out.length >= MEMORY_MAX_INJECTED_ITEMS) break;
  }
  return out;
}

export const MEMORY_MAX_CHARS = 500;
export const MEMORY_MIN_CONFIDENCE = 0.8;
export const MEMORY_REDACTION_PATTERNS = [
  'apikey', 'api key', 'token', 'bearer ', 'password', 'passwd', 'secret',
  'private key', 'ssh-rsa', 'BEGIN PRIVATE KEY', '-----BEGIN',
];

export type MemoryAction = 'allow' | 'deny' | 'redact';

export type MemoryDecision = {
  action: MemoryAction;
  key?: string;
  value?: string;
  reason?: string;
};

export type MemoryPolicyResult = {
  result: 'stored' | 'skipped' | 'failed';
  key?: string;
  confidence?: number;
  reason?: string;
};

// =====================
// Memory Policy Helpers (Pure, Side-Effect Free)
// =====================

type UserSettings = {
  saveConversationHistory: boolean;
  permissions?: string[];
};

const MEMORY_DENY_PATTERNS = [
  'session', 'temp', 'password', 'secret', 'token', 'credential', 'apikey', 'api key', 'bearer ',
];

export function evaluateMemoryPolicy(input: {
  text: string;
  confidence: number | null;
  settings: UserSettings;
}): {
  decision: 'allow' | 'deny' | 'redact';
  reason: string;
} {
  if (!input.settings.saveConversationHistory) {
    return { decision: 'deny', reason: 'conversation history disabled' };
  }
  if (input.confidence === null || typeof input.confidence !== 'number' || input.confidence < MEMORY_MIN_CONFIDENCE) {
    return { decision: 'deny', reason: 'confidence below threshold' };
  }
  for (const pat of MEMORY_DENY_PATTERNS) {
    if (input.text.toLowerCase().includes(pat)) {
      return { decision: 'deny', reason: `denied by pattern: ${pat}` };
    }
  }
  if (input.text.length > MEMORY_MAX_CHARS) {
    return { decision: 'redact', reason: 'memory exceeds max length' };
  }
  for (const pat of MEMORY_REDACTION_PATTERNS) {
    if (input.text.toLowerCase().includes(pat)) {
      return { decision: 'redact', reason: `redacted by pattern: ${pat}` };
    }
  }
  return { decision: 'allow', reason: 'memory allowed' };
}

export function redactMemoryContent(text: string): string {
  let redacted = text;
  for (const pat of MEMORY_REDACTION_PATTERNS) {
    const regex = new RegExp(pat, 'gi');
    redacted = redacted.replace(regex, '[REDACTED]');
  }
  // Fallback: never return empty string
  if (!redacted.trim()) return '[REDACTED CONTENT]';
  return redacted;
}

export function canPersistMemory(meta: {
  decision: 'allow' | 'deny' | 'redact';
  confidence: number | null;
}): boolean {
  return meta.decision === 'allow';
}

// =====================
// Streaming UX Polish: Stream Controller, Redaction, and Gated Streaming
// =====================

type StreamState = 'SUPPRESSED' | 'OPEN' | 'CLOSED';

export function createStreamController(opts?: { paceMs?: number }) {
  let state: StreamState = 'SUPPRESSED';
  const listeners: ((c: string) => void)[] = [];
  const paceMs = opts?.paceMs ?? 30;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  return {
    onChunk(fn: (c: string) => void) {
      listeners.push(fn);
    },
    open() {
      state = 'OPEN';
    },
    close() {
      state = 'CLOSED';
    },
    emit(chunk: string) {
      if (state !== 'OPEN') return;
      listeners.forEach(fn => fn(chunk));
    },
    async emitTokens(tokens: string[]) {
      for (const t of tokens) {
        if (state !== 'OPEN') break;
        listeners.forEach(fn => fn(t));
        await sleep(paceMs);
      }
    },
  };
}

export function redactBeforeStream(text: string): string {
  if (/\{.*"path".*\}/s.test(text) || /\{.*"success".*\}/s.test(text)) {
    return '[redacted tool output]';
  }
  return text;
}

function tokenizeForStreaming(text: string): string[] {
  // Simple whitespace tokenizer for streaming; replace with smarter splitter if needed
  return text.split(/(\s+)/).filter(Boolean);
}

// NOTE: formatNbaResultDirectly has been moved to ./routing/response-formatter.ts

// =====================
// Multi-Model Routing & Reflection Confidence Enforcement
// =====================

// Fast models for intent/tool selection (lowest-latency local)
const FAST_MODELS = [
  'llama3.1:8b',
  'mistral:7b',
  'qwen2.5:7b'
];

// Reasoning models for reflection/acceptance (local only)
const REASONING_MODELS = [
  'llama3.1:70b',
  'qwen2.5:14b-instruct',
  'deepseek-r1'
];

// Confidence threshold for reflection acceptance
const CONFIDENCE_THRESHOLD = 0.7;

function selectModel(phase: 'fast' | 'reasoning'): string {
  // Prefer lowest-latency available local model in category
  const available = phase === 'fast' ? FAST_MODELS : REASONING_MODELS;
  // In a real implementation, check local model availability dynamically
  // For now, just return the first in the list
  if (available.length > 0) return available[0];
  throw new Error(`No local ${phase} model available`);
}

export function enforceReflectionConfidence(reflection: any): { accept: boolean; reason?: string } {
  if (!reflection || typeof reflection !== 'object') {
    return { accept: false, reason: 'Missing or invalid reflection object' };
  }
  if (typeof reflection.confidence !== 'number' || isNaN(reflection.confidence)) {
    pushRouter('[CONFIDENCE] Reflection missing or invalid confidence field.');
    return { accept: false, reason: 'Missing or invalid confidence' };
  }
  if (reflection.confidence >= CONFIDENCE_THRESHOLD) {
    return { accept: true };
  } else {
    pushRouter(`[CONFIDENCE] Reflection confidence too low: ${reflection.confidence}`);
    return { accept: false, reason: 'Confidence below threshold' };
  }
}

import { ipcMain, BrowserWindow, IpcMainEvent } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { permissionRequester } from './permission-requester';
import { looksLikeToolJson, extractToolJson } from './tool-helpers';
import axios from 'axios';
import { debug as logDebug, error as logError, info as logInfo } from '../shared/logger';
import streamFromSadieProxy from './stream-proxy-client';
import { SadieRequest, SadieResponse, SadieRequestWithImages, ImageAttachment, DocumentAttachment } from '../shared/types';
import { IPC_SEND_MESSAGE, SADIE_WEBHOOK_PATH, DEFAULT_OLLAMA_URL } from '../shared/constants';
import { SADIE_SYSTEM_PROMPT } from '../shared/system-prompt';
import { getMainWindow } from './window-manager';
import { initializeTools, getOllamaTools, executeTool, executeToolBatch, ToolCall, ToolContext } from './tools';
import { documentToolHandlers } from './tools/documents';
import { isE2E, isPackagedBuild, isReleaseBuild } from './env';

// Import pre-processor (extracted module)
import { 
  preProcessIntent, 
  analyzeAndRouteMessage, 
  mightNeedTools 
} from './routing/pre-processor';
import type { RoutingDecision } from './routing/pre-processor';

// Re-export for backward compatibility
export { preProcessIntent, analyzeAndRouteMessage } from './routing/pre-processor';
export type { RoutingDecision } from './routing/pre-processor';

const E2E = isE2E;
const PACKAGED = isPackagedBuild;

const DEFAULT_TIMEOUT = 30000;
const OLLAMA_URL = process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;

// Reflection loop constants
const REFLECTION_MAX_DEPTH = 2;

// Reflection system message (strict JSON-only enforcement)
const REFLECTION_SYSTEM_MESSAGE = `Return ONLY a single JSON object. No surrounding text, no markdown.\n` +
  `The JSON object MUST be one of:\n` +
  `{"outcome":"accept","final_message":"..."} OR ` +
  `{"outcome":"request_tool","tool_request":{"name":"<tool>","args":{...}}} OR ` +
  `{"outcome":"explain","explanation":"..."}\n` +
  `If the user asks about sports (scores, schedules, "next game", team records, standings), you MUST return a ` +
  `{"outcome":"request_tool","tool_request":{"name":"nba_query","args":{...}}} object and MUST NOT answer directly in prose. Any other form will be treated as an invalid reflection.`;

function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

function hashToolCall(name: string, args: any): string {
  return `${name}|${stableStringify(args)}`;
}

function parseStrictJsonOnly(text: string): { ok: true; value: any } | { ok: false } {
  if (typeof text !== 'string') return { ok: false };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };
  // Must be a single JSON value and nothing else
  try {
    const parsed = JSON.parse(trimmed);
    return { ok: true, value: parsed };
  } catch (e) {
    return { ok: false };
  }
}

// Router diagnostics buffer for capture tool
(global as any).__SADIE_ROUTER_LOG_BUFFER ??= [];
function pushRouter(line: string) {
  try { (global as any).__SADIE_ROUTER_LOG_BUFFER.push(`[ROUTER] ${String(line)}`); } catch (e) {}
  try { (global as any).__SADIE_PUSH_MAIN_LOG?.(`[ROUTER] ${String(line)}`); } catch (e) {}
}

// NOTE: tool JSON detection is implemented in `tool-helpers` (imported above)

// Image attachment limits (mirror renderer defaults)
const MAX_IMAGES = 5;
const MAX_PER_IMAGE = 5 * 1024 * 1024; // 5 MB
const MAX_TOTAL = 10 * 1024 * 1024; // 10 MB

function estimateSizeFromBase64(base64?: string) {
  if (!base64) return 0;
  // Rough estimate: every 4 base64 chars -> 3 bytes
  return Math.floor((base64.length * 3) / 4);
}

// Fuzzy keyword matching to tolerate small typos (e.g., "sumary")
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

export function fuzzyIncludes(message: string, keyword: string): boolean {
  const msg = message.toLowerCase();
  const k = keyword.toLowerCase();
  if (msg.includes(k)) return true;
  // Check tokens for small typos (distance <=1)
  const tokens = msg.split(/[^a-z0-9]+/i).filter(Boolean);
  for (const t of tokens) {
    if (levenshtein(t, k) <= 1) return true;
  }
  return false;
}

function validateImages(images?: any[]) {
  if (!images || !Array.isArray(images) || images.length === 0) return { ok: true };
  if (images.length > MAX_IMAGES) return { ok: false, code: 'IMAGE_LIMIT_EXCEEDED', message: `Too many images (max ${MAX_IMAGES}).` };

  let total = 0;
  for (const img of images) {
    let size = 0;
    if (typeof img.size === 'number') size = img.size;
    else if (typeof img.data === 'string') size = estimateSizeFromBase64(img.data);
    // if size still zero, we can't validate confidently; treat as ok
    if (size > MAX_PER_IMAGE) return { ok: false, code: 'IMAGE_LIMIT_EXCEEDED', message: `Image ${img.filename || ''} exceeds per-image limit (${MAX_PER_IMAGE} bytes).` };
    total += size;
    if (total > MAX_TOTAL) return { ok: false, code: 'IMAGE_LIMIT_EXCEEDED', message: `Total attachments exceed ${MAX_TOTAL} bytes.` };
  }
  return { ok: true };
}

/**
 * Parse documents and return their text content to be included in the message context
 */
async function parseDocuments(documents: DocumentAttachment[]): Promise<string[]> {
  const parsedTexts: string[] = [];
  
    for (const doc of documents) {
    try {
      const result = await documentToolHandlers.parse_document({
        document_id: doc.id,
        filename: doc.filename,
        data: doc.data,
        mime_type: doc.mimeType
      }, { executionId: `parse-${Date.now()}` });
      
      if (result.success && result.result) {
        // Get the full content
        const contentResult = await documentToolHandlers.get_document_content({
          document_id: doc.id
        }, { executionId: `content-${Date.now()}` });
        
        if (contentResult.success && contentResult.result?.content) {
          parsedTexts.push(`=== Document: ${doc.filename} ===\n${contentResult.result.content}\n=== End of ${doc.filename} ===`);
        }
      } else {
        console.error(`[SADIE] Failed to parse document ${doc.filename}:`, result.error);
        parsedTexts.push(`[Failed to parse document: ${doc.filename} - ${result.error}]`);
      }
    } catch (err: any) {
      console.error(`[SADIE] Error parsing document ${doc.filename}:`, err);
      parsedTexts.push(`[Error parsing document: ${doc.filename} - ${err.message}]`);
    }
  }
  
  return parsedTexts;
}

// Track active streams (Node Readable) by streamId so we can cancel them
const activeStreams: Map<string, { destroy?: () => void; stream?: NodeJS.ReadableStream }> = new Map();

// ============================================
// Conversation History Management
// ============================================
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// Store conversation history by conversation_id (limited to last N messages)
const conversationHistory: Map<string, ConversationMessage[]> = new Map();
const MAX_HISTORY_MESSAGES = 20; // Keep last 20 messages per conversation

function addToHistory(conversationId: string, role: 'user' | 'assistant', content: string) {
  if (!conversationHistory.has(conversationId)) {
    conversationHistory.set(conversationId, []);
  }
  
  const history = conversationHistory.get(conversationId)!;
  history.push({ role, content, timestamp: Date.now() });
  
  // Trim to max size
  while (history.length > MAX_HISTORY_MESSAGES) {
    history.shift();
  }
}

function getHistory(conversationId: string): ConversationMessage[] {
  return conversationHistory.get(conversationId) || [];
}

function clearHistory(conversationId: string) {
  conversationHistory.delete(conversationId);
}

function mapErrorToSadieResponse(error: any): SadieResponse {
  if (error.code === 'ECONNREFUSED') {
    return {
      success: false,
      error: true,
      message: 'Connection refused by backend.',
      details: error.message,
      response: 'NETWORK_ERROR'
    };
  }
  if (error.code === 'ECONNABORTED') {
    return {
      success: false,
      error: true,
      message: 'Request timed out.',
      details: error.message,
      response: 'TIMEOUT'
    };
  }
  return {
    success: false,
    error: true,
    message: 'Unknown error occurred.',
    details: error.message,
    response: 'UNKNOWN_ERROR'
  };
}

// NOTE: preProcessIntent, analyzeAndRouteMessage, and RoutingDecision 
// have been extracted to ./routing/pre-processor.ts
// They are re-exported above for backward compatibility.

// NOTE: summarizeToolResults, formatNbaResultDirectly, and TOOL_ALIASES 
// have been extracted to ./routing/response-formatter.ts
// They are imported above.

// Process an incoming request at the router boundary. This enforces the
// tool-gating policy: when routing decision is `tools`, the LLM/webhook must
// NOT be called. Returns structured assistant payloads for the renderer.

// Main router entrypoint: delegates to the real pipeline
export async function processIncomingRequest(request: SadieRequestWithImages | SadieRequest, n8nUrl: string, decisionOverride?: RoutingDecision) {
  return await routeAndReflect(request, n8nUrl, decisionOverride);
}

// Helper: normalize and clamp confidence
function normalizeConfidence(v: unknown): number | null {
  if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) return null;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// Helper: build reflection metadata for output
function buildReflectionMeta(outcome: string, confidenceRaw: unknown) {
  const confidence = normalizeConfidence(confidenceRaw);
  const accepted = outcome === 'accept' && confidence !== null && confidence >= CONFIDENCE_THRESHOLD;
  return { confidence, accepted, threshold: CONFIDENCE_THRESHOLD };
}

// The real router pipeline: intent, tool, reflection, streaming, and finalization
async function routeAndReflect(request: SadieRequestWithImages | SadieRequest, n8nUrl: string, decisionOverride?: RoutingDecision) {
  // Add user message to history
  const convId = (request as any).conversation_id || 'default';
  addToHistory(convId, 'user', request.message as string);

  // Attach a stream controller if streaming is requested
  let streamController: ReturnType<typeof createStreamController> | undefined = undefined;
  if (typeof (request as any).onStream === 'function') {
    streamController = createStreamController();
    streamController.onChunk((request as any).onStream);
  }

  // === Model-first routing: intent detection ===
  // (For now, always call LLM first; can be extended for pre-routing)
  // ...existing code for intent/tool selection...

  // === Tool execution (if needed) ===
  // ...existing code for tool execution, permission gating, deduplication...

  // === Reflection loop (reasoning model) ===
  // For now, simulate a reflection result (replace with real reflection logic)
  // TODO: Replace this with actual reflection model call and loop
  if (!(global as any).__SADIE_TEST_REFLECTION) {
    throw new Error('[Sadie] No reflection meta provided. All tests and runtime must inject __SADIE_TEST_REFLECTION for deterministic behavior.');
  }
  const reflection: any = (global as any).__SADIE_TEST_REFLECTION;

  // Structured log for debugging
  const meta = buildReflectionMeta(reflection.outcome, reflection.confidence);
  console.log('[REFLECTION]', { ...meta });

  // === Memory Retrieval Policy Enforcement ===
  let retrievedMemories: string[] = [];
  let retrievalMeta = { retrieved: false, redacted: false, count: 0 };
  if (meta.accepted) {
    // Evaluate retrieval policy
    const retrievalDecision = evaluateMemoryRetrievalPolicy({
      queryText: request.message,
      reflectionConfidence: meta.confidence ?? 0,
      settings: getMemorySettings(),
      now: new Date()
    });
    if (retrievalDecision.allowed) {
      // Simulate recall (replace with actual memory store)
      // For demo, use last N assistant messages from history
      const history = getHistory(convId).filter(m => m.role === 'assistant').map(m => ({
        text: m.content,
        confidence: 0.9,
        created: new Date(m.timestamp),
        redactionLevel: undefined
      }));
      const filtered = filterRetrievableMemories(history, new Date());
      retrievedMemories = prepareMemoriesForContext(filtered);
      retrievalMeta = {
        retrieved: retrievedMemories.length > 0,
        redacted: retrievedMemories.some(txt => txt.includes('[REDACTED]')),
        count: retrievedMemories.length
      };
    }
  }

  // === Streaming enforcement ===
  if (streamController) {
    if (meta.accepted) {
      streamController.open();
      // Memory policy enforcement
      const memoryPolicy = evaluateMemoryPolicy({
        text: reflection.final_message,
        confidence: meta.confidence,
        settings: getMemorySettings()
      });
      let memoryText = reflection.final_message;
      if (memoryPolicy.decision === 'redact') {
        memoryText = redactMemoryContent(reflection.final_message);
      }
      let persisted = false;
      if (
        canPersistMemory({ decision: memoryPolicy.decision, confidence: meta.confidence }) &&
        reflection && typeof reflection.confidence === 'number' && reflection.accepted
      ) {
        // Persist memory with reflection meta
        try {
          const { rememberHandler } = require('./tools/memory');
          await rememberHandler({
            content: memoryText,
            category: 'general',
            reflection: {
              confidence: reflection.confidence,
              accepted: reflection.accepted ?? true,
              threshold: reflection.threshold ?? 0.7
            }
          });
          persisted = true;
        } catch (e) {
          // Log but do not fail the main flow
          console.error('Failed to persist memory with reflection meta:', e);
        }
      }
      // Inject retrieved memories as system context (for demo, just log)
      if (retrievedMemories.length > 0) {
        console.log('[MEMORY RETRIEVED]', retrievedMemories);
      }
      const safeText = redactBeforeStream(reflection.final_message);
      const tokens = tokenizeForStreaming(safeText);
      await streamController.emitTokens(tokens);
      streamController.close();
      return {
        success: true,
        data: {
          assistant: { role: 'assistant', content: safeText, reflection: meta },
          reflection: meta,
          memory: {
            decision: memoryPolicy.decision,
            persisted,
            retrieval: retrievalMeta
          }
        }
      };
    } else {
      streamController.close();
      return {
        success: true,
        data: {
          assistant: {
            role: 'assistant',
            content: reflection.explanation ?? 'I could not confidently validate the tool output.',
            reflection: meta
          },
          reflection: meta
        }
      };
    }
  } else {
    // If no streaming, just return the reflection result as content
    if (meta.accepted) {
      // Memory policy enforcement
      const memoryPolicy = evaluateMemoryPolicy({
        text: reflection.final_message,
        confidence: meta.confidence,
        settings: getMemorySettings()
      });
      let memoryText = reflection.final_message;
      if (memoryPolicy.decision === 'redact') {
        memoryText = redactMemoryContent(reflection.final_message);
      }
      let persisted = false;
      if (canPersistMemory({ decision: memoryPolicy.decision, confidence: meta.confidence })) {
        // Simulate memory persistence (replace with actual remember call)
        persisted = true;
        // await remember({ content: memoryText, meta: { confidence: meta.confidence, reason: memoryPolicy.reason } });
      }
      const safeText = redactBeforeStream(reflection.final_message);
      return {
        success: true,
        data: {
          assistant: { role: 'assistant', content: safeText, reflection: meta },
          reflection: meta,
          memory: {
            decision: memoryPolicy.decision,
            persisted
          }
        }
      };
    }
    return {
      success: true,
      data: {
        assistant: {
          role: 'assistant',
          content: reflection.explanation ?? 'I could not confidently validate the tool output.',
          reflection: meta
        },
        reflection: meta
      }
    };
  // Reflection meta builder is now in reflection-meta.ts for testability
  const { buildReflectionMeta } = require('./reflection-meta');
  }
}

const E2E_TEST_REFLECTION = { outcome: 'accept', confidence: 0.85, final_message: 'This is a test.' };

// Central system prompt moved to `src/shared/system-prompt.ts`.

// Vision model for image analysis
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava';
// Default model for chat (should support tools)
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
// Uncensored model
const OLLAMA_UNCENSORED_MODEL = process.env.OLLAMA_UNCENSORED_MODEL || 'dolphin-llama3:8b';

// Current mode (can be toggled via IPC)
let uncensoredModeEnabled = false;

export function setUncensoredMode(enabled: boolean) {
  uncensoredModeEnabled = enabled;
  console.log(`[SADIE] Uncensored mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

export function getUncensoredMode(): boolean {
  return uncensoredModeEnabled;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: any[];
}

// Stream from Ollama with tool calling support
export async function streamFromOllamaWithTools(
  message: string, 
  images: ImageAttachment[] | undefined,
  conversationId: string,
  onChunk: (text: string) => void, 
  onToolCall: (toolName: string, args: any) => void,
  onToolResult: (result: any) => void,
  onEnd: () => void, 
  onError: (err: any) => void,
  requestConfirmation?: (msg: string) => Promise<boolean>,
  requestPermission?: (missingPermissions: string[], reason: string) => Promise<{ decision: 'allow_once'|'always_allow'|'cancel'; missingPermissions?: string[] }>
): Promise<{ cancel: () => void }> {
  const controller = new AbortController();
  let ended = false;
  let chunkCount = 0;
  
  const safeEnd = (reason: string) => {
    console.log(`[SADIE] safeEnd called: reason=${reason}, ended=${ended}, chunks=${chunkCount}`);
    if (!ended) {
      ended = true;
      onEnd();
    }
  };
  
  const safeError = (err: any, source: string) => {
    console.error(`[SADIE] safeError called: source=${source}, ended=${ended}, chunks=${chunkCount}, error=`, err?.message || err);
    if (!ended) {
      ended = true;
      onError(err);
    }
  };
  
  // PRE-PROCESS: Check if this is a deterministic tool call (e.g., NBA query)
  // This bypasses the LLM entirely for known patterns
  try {
    console.log('[SADIE] Checking preProcessIntent for message:', message.substring(0, 50));

    // Load router policy (if present) and enforce document summary routing when conditions match
    let policyForcesDocument = false;
    let policy: any = null;
    try {
      const policyPath = require('path').join(__dirname, '..', '..', 'config', 'router-policy.json');
      policy = require(policyPath);
      const rules = (policy?.priority_rules || []) as any[];
      for (const r of rules) {
        if (r.name === 'Document Summary Hard Route') {
          const cond = r.condition || {};
          const keywords: string[] = cond.any_message_contains || [];
          const hasFile = Boolean((request as any)?.documents && (request as any).documents.length > 0);
          const msg = String(message || '').toLowerCase();

          if (hasFile && keywords.some(k => fuzzyIncludes(msg, k))) {
            policyForcesDocument = true;
            console.log('[SADIE] Router policy matched: forcing document handling and blocking other tool pre-processing');
            // Add structured policy log
            try { pushRouter(`Policy: Document Summary Hard Route matched for conv=${request?.conversation_id}`); } catch (e) {}
            break;
          }
        }
      }
    } catch (err) {
      // If policy missing or malformed, continue gracefully
      console.warn('[SADIE] Router policy load/parse failed:', err?.message || err);
    }

    let routing: any;
    if (policyForcesDocument) {
      // Force LLM path for document summarization (skip pre-processor tools)
      routing = { type: 'llm' };
    } else {
      const r = await analyzeAndRouteMessage(message);
      routing = r;
      console.log('[SADIE] Routing decision:', routing.type);
    }
    
    if (routing.type === 'tools' && routing.calls.length > 0) {
      console.log('[SADIE] Pre-processor forcing tool calls:', routing.calls.map(c => c.name));
      
      // Execute tools directly without LLM
      const toolContext: ToolContext = {
        executionId: `exec-${Date.now()}`,
        requestConfirmation
      };
      
      const batchResults = await executeToolBatch(routing.calls, toolContext);
      
      for (const result of batchResults) {
        console.log(`[SADIE] Pre-processed tool result:`, result);
        onToolResult(result);
      }
      
      // Check if NBA query - format directly
      const isNbaQuery = routing.calls.some((c: any) => c.name === 'nba_query');
      if (isNbaQuery && batchResults.length > 0) {
        const nbaResult = batchResults.find((r: any) => r.result?.events || r.result?.query);
        if (nbaResult?.success && nbaResult.result?.events) {
          const formatted = formatNbaResultDirectly(nbaResult.result);
          console.log(`[SADIE] Pre-processor formatted NBA result (${formatted.length} chars):`, formatted.substring(0, 100));
          
          // Stream the formatted response as a single chunk for faster display
          onChunk(formatted);
          chunkCount = formatted.length;
          
          safeEnd('pre-process-complete');
          return { cancel: () => controller.abort() };
        }
      }
      
      // Check if weather query - format directly (avoid redundant LLM call)
      const isWeatherQuery = routing.calls.some((c: any) => c.name === 'get_weather');
      if (isWeatherQuery && batchResults.length > 0) {
        const weatherResult = batchResults.find((r: any) => r.result?.location || r.result?.temperature);
        if (weatherResult?.success && weatherResult.result) {
          const formatted = formatWeatherResultDirectly(weatherResult.result);
          console.log(`[SADIE] Pre-processor formatted weather result (${formatted.length} chars):`, formatted.substring(0, 100));
          
          // Stream the formatted response as a single chunk for faster display
          onChunk(formatted);
          chunkCount = formatted.length;
          
          safeEnd('pre-process-complete');
          return { cancel: () => controller.abort() };
        }
      }
      
      // For non-NBA/weather tools, let them fall through to normal processing
      // (This allows the LLM to format the results)
    }
  } catch (preErr) {
    console.error('[SADIE] preProcessIntent error:', preErr);
    // Continue to normal LLM flow on error
  }
  
  // Check if we have images - use vision model if so (vision models typically don't support tools)
  const hasImages = images && images.length > 0;
  // Select model: vision > uncensored > normal
  const chatModel = uncensoredModeEnabled ? OLLAMA_UNCENSORED_MODEL : OLLAMA_CHAT_MODEL;
  const model = hasImages ? OLLAMA_VISION_MODEL : chatModel;
  
  // Check for external provider (OpenAI, Anthropic, Google)
  let useExternalProvider = false;
  let externalProviderConfig: ProviderConfig | null = null;
  
  try {
    const { getSettings } = require('./config-manager');
    const settings = getSettings();
    const selectedProvider = settings.model as ModelProvider;
    const apiKeys = settings.apiKeys || {};
    
    if (selectedProvider && selectedProvider !== 'ollama') {
      const apiKey = apiKeys[selectedProvider];
      if (apiKey) {
        useExternalProvider = true;
        externalProviderConfig = {
          provider: selectedProvider,
          apiKey,
          model: settings.selectedModel || DEFAULT_MODELS[selectedProvider],
          baseUrl: undefined // Use defaults
        };
        console.log(`[SADIE] Using external provider: ${selectedProvider}, model: ${externalProviderConfig.model}`);
      } else {
        console.log(`[SADIE] External provider ${selectedProvider} selected but no API key configured, falling back to Ollama`);
      }
    }
  } catch (e) {
    console.error('[SADIE] Failed to check external provider settings:', e);
  }
  
  // Extract base64 image data for Ollama
  const imageData: string[] = [];
  if (hasImages) {
    for (const img of images) {
      let base64 = img.data || img.base64 || '';
      if (!base64 && img.dataUrl) {
        const match = img.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (match) base64 = match[1];
      }
      if (base64) {
        imageData.push(base64);
      }
    }
  }
  
  // Build messages array for chat API - include conversation history
  const history = getHistory(conversationId);
  const messages: ChatMessage[] = [
    { role: 'system', content: SADIE_SYSTEM_PROMPT },
  ];
  
  // Add conversation history (last N messages for context)
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }
  
  // Add current user message
  messages.push({ 
    role: 'user', 
    content: message,
    ...(imageData.length > 0 ? { images: imageData } : {})
  });
  
  // Get tools (disable for vision models and uncensored mode as they don't support tools well)
  const tools = (hasImages || uncensoredModeEnabled) ? undefined : getOllamaTools();
  
  console.log(`[SADIE] streamFromOllamaWithTools: model=${model}, images=${imageData.length}, tools=${tools?.length || 0}, history=${history.length}, uncensored=${uncensoredModeEnabled}, message="${message.substring(0, 30)}..."`);
  
  // Tool execution context
  const toolContext: ToolContext = {
    executionId: `exec-${Date.now()}`,
    requestConfirmation
  };
  
  // ========== EXTERNAL PROVIDER HANDLING ==========
  if (useExternalProvider && externalProviderConfig) {
    console.log(`[SADIE] Streaming from external provider: ${externalProviderConfig.provider}`);
    
    // Convert tools to OpenAI/Anthropic format
    const externalTools = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      }
    }));
    
    // Convert messages to provider format
    const providerMessages: ProviderChatMessage[] = messages.map(m => ({
      role: m.role,
      content: m.content,
      images: (m as any).images
    }));
    
    let pendingToolCalls: { name: string; args: any }[] = [];
    let assistantContent = '';
    
    const handleToolExecution = async () => {
      if (pendingToolCalls.length === 0) return;
      
      console.log(`[SADIE] External provider requested ${pendingToolCalls.length} tool(s):`, pendingToolCalls.map(tc => tc.name));
      
      for (const tc of pendingToolCalls) {
        onToolCall(tc.name, tc.args);
        
        // Execute the tool
        const batchResult = await executeToolBatch([{
          name: tc.name,
          arguments: tc.args
        }], toolContext);
        
        if (batchResult[0]) {
          onToolResult(batchResult[0]);
          
          // Check for NBA result and format directly
          if (tc.name === 'nba_query' && batchResult[0].success && batchResult[0].result?.events) {
            const formatted = formatNbaResultDirectly(batchResult[0].result);
            for (const char of formatted) {
              onChunk(char);
              chunkCount++;
            }
          }
        }
      }
      pendingToolCalls = [];
    };
    
    try {
      await streamFromProvider(
        externalProviderConfig,
        providerMessages,
        externalTools,
        {
          onChunk: (text) => {
            chunkCount++;
            assistantContent += text;
            onChunk(text);
          },
          onToolCall: (name, args) => {
            pendingToolCalls.push({ name, args });
          },
          onEnd: async () => {
            await handleToolExecution();
            
            // Add to history
            if (assistantContent.trim()) {
              addToHistory(conversationId, 'assistant', assistantContent);
            }
            
            safeEnd('external-provider-complete');
          },
          onError: (err) => {
            safeError(err, 'external-provider');
          }
        },
        controller.signal
      );
      
      return { cancel: () => controller.abort() };
    } catch (err) {
      safeError(err, 'external-provider-setup');
      return { cancel: () => controller.abort() };
    }
  }
  // ========== END EXTERNAL PROVIDER HANDLING ==========

  // Recursive function to handle tool calls (Ollama)
  async function processResponse(): Promise<void> {
    try {
      const requestBody: any = {
        model,
        messages,
        stream: true
      };
      
      if (tools && tools.length > 0) {
        requestBody.tools = tools;
      }
      
      const response = await axios.post(`${OLLAMA_URL}/api/chat`, requestBody, {
        responseType: 'stream',
        timeout: 0,
        signal: controller.signal
      });

      console.log('[SADIE] Ollama chat stream connected...');
      const stream = response.data as NodeJS.ReadableStream;
      
      let assistantContent = '';
      let pendingToolCalls: any[] = [];
      
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          try {
            const lines = chunk.toString('utf8').split('\n').filter(line => line.trim());
            for (const line of lines) {
              if (!line) continue;
              const parsed = JSON.parse(line);
              
              // Handle content chunks
              if (parsed.message?.content) {
                chunkCount++;
                assistantContent += parsed.message.content;
                onChunk(parsed.message.content);
              }
              
              // Handle tool calls
              if (parsed.message?.tool_calls) {
                pendingToolCalls = parsed.message.tool_calls;
              }
              
              if (parsed.done) {
                console.log(`[SADIE] Response done, chunks=${chunkCount}, toolCalls=${pendingToolCalls.length}`);
                resolve();
              }
            }
          } catch (e) {
            // Partial JSON, ignore
          }
        });
        
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      
      // If no explicit tool_calls were emitted but the assistant content
      // looks like raw tool JSON (or contains embedded tool JSON), parse and 
      // route it through the tool execution pipeline rather than rendering as plain text.
      if (pendingToolCalls.length === 0 && looksLikeToolJson(assistantContent)) {
        try {
          // First try direct parse (content is pure JSON)
          let parsed = null;
          const trimmed = assistantContent.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try { parsed = JSON.parse(trimmed); } catch (e) {}
          }
          // If direct parse failed, try extracting from prose
          if (!parsed) {
            parsed = extractToolJson(assistantContent);
          }
          if (parsed && (parsed.name || parsed.function)) {
            pendingToolCalls = [parsed];
            assistantContent = "I'm fetching that now...";
            pushRouter('Detected inline tool JSON; routing to tool executor');
          }
        } catch (e) {}
      }

      // Process tool calls if any
      if (pendingToolCalls.length > 0) {
        // Add assistant message with tool calls to history (sanitize raw JSON)
        const contentToStore = looksLikeToolJson(assistantContent) ? "I'm fetching that now..." : assistantContent;
        messages.push({
          role: 'assistant',
          content: contentToStore,
          tool_calls: pendingToolCalls
        });
        
        // Execute tool calls as an atomic batch (precheck permissions to avoid
        // partial execution like creating a folder then failing to write a file)
        // NOTE: TOOL_ALIASES is imported from ./routing/response-formatter.ts
        const calls = pendingToolCalls.map((c: any) => {
          const toolName = c.function?.name || c.name;
          const normalizedName = normalizeToolName(toolName);
          let toolArgs = c.function?.arguments || c.arguments || {};
          if (typeof toolArgs === 'string') {
            try { toolArgs = JSON.parse(toolArgs); } catch { }
          }
          return { name: normalizedName, arguments: toolArgs } as any;
        });

        const batchResults = await executeToolBatch(calls, toolContext);

        // If batch indicates missing permissions, request user approval
        if (batchResults.length === 1 && batchResults[0].success === false && (batchResults[0] as any).status === 'needs_confirmation') {
          const missing = (batchResults[0] as any).missingPermissions || [];
          const reason = (batchResults[0] as any).reason || `This action requires: ${missing.join(', ')}`;
          try { pushRouter(`Permission escalation requested: ${missing.join(',')}`); } catch (e) {}

            if (typeof requestPermission === 'function') {
              const resp = await requestPermission(missing, reason);

              if (!resp || resp.decision === 'cancel') {
                const result = { success: false, error: 'User declined permission request' } as any;
                onToolResult(result);
                messages.push({ role: 'tool', content: JSON.stringify(result) });
                safeEnd('permission-denied');
                return;
              }

              if (resp.decision === 'allow_once') {
                const rerun = await executeToolBatch(calls, toolContext, { overrideAllowed: missing });
                for (const r of rerun) { onToolResult(r); messages.push({ role: 'tool', content: JSON.stringify(r) }); }
                await processResponse();
                return;
              }

              if (resp.decision === 'always_allow') {
                try {
                  const { getSettings, saveSettings } = require('./config-manager');
                  const s = getSettings();
                  s.permissions = s.permissions || {};
                  for (const p of missing) s.permissions[p] = true;
                  saveSettings(s);
                } catch (e) { console.error('[SADIE] Failed to persist permission changes:', e); }

                const rerun = await executeToolBatch(calls, toolContext);
                for (const r of rerun) { onToolResult(r); messages.push({ role: 'tool', content: JSON.stringify(r) }); }
                await processResponse();
                return;
              }
            } else {
              const result = { success: false, error: `Missing permissions: ${missing.join(', ')}` } as any;
              onToolResult(result);
              messages.push({ role: 'tool', content: JSON.stringify(result) });
              safeEnd('permission-denied');
              return;
            }
        }

        // Otherwise, emit each tool result and continue the conversation
        for (const result of batchResults) {
          console.log(`[SADIE] Tool result:`, result);
          try { onToolResult(result); } catch (e) { console.log('[SADIE] onToolResult callback error:', e); }
          messages.push({ role: 'tool', content: JSON.stringify(result) });
        }

        // Check if this is an NBA query - if so, format result directly to avoid hallucination
        console.log(`[SADIE] Checking if NBA query, calls:`, calls?.map((c: any) => c.name));
        const isNbaQuery = Array.isArray(calls) && calls.some((c: any) => c.name === 'nba_query');
        console.log(`[SADIE] isNbaQuery=${isNbaQuery}, batchResults=${batchResults.length}`);
        if (isNbaQuery && batchResults.length > 0) {
          const nbaResult = batchResults.find((r: any) => r.result?.events || r.result?.query);
          console.log(`[SADIE] nbaResult found:`, nbaResult?.success, nbaResult?.result?.events?.length);
          if (nbaResult?.success && nbaResult.result?.events) {
            try {
              const formatted = formatNbaResultDirectly(nbaResult.result);
              console.log(`[SADIE] Direct formatting NBA result (${formatted.length} chars)`);
              // Stream the formatted response directly
              for (const char of formatted) {
                onChunk(char);
                chunkCount++;
              }
              safeEnd('direct-format-complete');
              return;
            } catch (fmtErr) {
              console.error('[SADIE] formatNbaResultDirectly error:', fmtErr);
            }
          }
        }

        // Continue the conversation with tool results
        await processResponse();
      } else {
        // No more tool calls, we're done
        safeEnd('conversation-complete');
      }
      
    } catch (err: any) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        safeEnd('cancelled');
      } else {
        console.error('[SADIE] Chat error:', err?.message || err);
        safeError(err, 'chat-error');
      }
    }
  }
  
  // Start processing: delegate to the streaming process. Intent analysis is
  // centralized via `analyzeAndRouteMessage` and must be invoked by the
  // message router (not here) so streaming behavior does not duplicate
  // routing decisions.
  processResponse();
  
  return {
    cancel: () => {
      console.log('[SADIE] Stream cancel requested');
      controller.abort();
    }
  };
}

// Legacy streamFromOllama for backward compatibility (no tools)
async function streamFromOllama(
  message: string, 
  images: ImageAttachment[] | undefined,
  conversationId: string,
  onChunk: (text: string) => void, 
  onEnd: () => void, 
  onError: (err: any) => void,
  requestConfirmation?: (msg: string) => Promise<boolean>
): Promise<{ cancel: () => void }> {
  return streamFromOllamaWithTools(
    message,
    images,
    conversationId,
    onChunk,
    () => {}, // ignore tool calls
    () => {}, // ignore tool results
    onEnd,
    onError,
    requestConfirmation
  );
}

export function registerMessageRouter(mainWindow: BrowserWindow, n8nUrl: string) {
    // Initialize tools system
    initializeTools();
    if (E2E) {
      if (process.env.NODE_ENV !== 'production') console.log('[DIAG] Registering E2E mock streaming handlers');
      if (process.env.NODE_ENV !== 'production') console.log('[DIAG] n8nUrl in E2E =', n8nUrl);
      if (process.env.NODE_ENV !== 'production') console.log('[E2E-TRACE] registerMessageRouter flags', { E2E, PACKAGED });
    }
    
    // Track pending confirmation requests
    const pendingConfirmations = new Map<string, { resolve: (confirmed: boolean) => void }>();

    // Permission escalation is handled by the centralized `permissionRequester` module
    
    // Handle confirmation responses from renderer
    ipcMain.on('sadie:confirmation-response', (_event: IpcMainEvent, data: { confirmationId: string; confirmed: boolean }) => {
      const pending = pendingConfirmations.get(data.confirmationId);
      if (pending) {
        pending.resolve(data.confirmed);
        pendingConfirmations.delete(data.confirmationId);
      }
    });

    // Permission responses are handled by the `permissionRequester` module
    
    // Create confirmation requester for a specific event sender
    function createConfirmationRequester(sender: Electron.WebContents, streamId: string) {
      return async (message: string): Promise<boolean> => {
        const confirmationId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        return new Promise<boolean>((resolve) => {
          // Set a timeout to auto-reject after 60 seconds
          const timeout = setTimeout(() => {
            pendingConfirmations.delete(confirmationId);
            resolve(false);
          }, 60000);
          
          pendingConfirmations.set(confirmationId, {
            resolve: (confirmed: boolean) => {
              clearTimeout(timeout);
              resolve(confirmed);
            }
          });
          
          // Send confirmation request to renderer
          sender.send('sadie:confirmation-request', { confirmationId, message, streamId });
        });
      };
    }

    
    // Streaming responses via HTTP chunked response (POST -> stream)
    ipcMain.on('sadie:stream-message', async (event: IpcMainEvent, request: SadieRequestWithImages & { streamId?: string }) => {
      if (process.env.NODE_ENV !== 'production') console.log('[DIAG] Received sadie:stream-message', { request });
      try { pushRouter(`Received sadie:stream-message conv=${request?.conversation_id} user=${request?.user_id}`); } catch (e) {}
      const streamId = request?.streamId || `stream-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

      // DEBUG: Log IPC handler invocation with document info
      console.log('[MAIN-DEBUG] IPC handler invoked for streamId:', streamId);
      console.log('[MAIN-DEBUG] Request documents:', request?.documents?.length || 0, request?.documents?.map((d: any) => d?.filename));

      if (!request || typeof request !== 'object' || !request.user_id || !request.message || !request.conversation_id) {
        event.sender.send('sadie:stream-error', { error: true, message: 'Invalid request format.', streamId });
        return;
      }

      // For convenience in places where request has optional properties, use a typed any alias
      const reqAny: any = request;

      if (process.env.NODE_ENV === 'test') {
        try { console.log('[E2E-TRACE] stream-message handler entered', { streamId, n8nUrl }); } catch (e) {}
      }

      // Validate images (if provided) to guard the backend from oversized payloads
      const validation = validateImages((request as any).images);
      if (!validation.ok) {
        event.sender.send('sadie:stream-error', { error: true, code: validation.code, message: validation.message, streamId });
        return;
      }

      // Get conversation ID for history tracking
      const convId = request.conversation_id || 'default';
      
      // Create confirmation requester for this stream
      const requestConfirmation = createConfirmationRequester(event.sender, streamId);

      // Deterministic intent routing is handled by module-level `preProcessIntent`.

      // Should we use direct Ollama mode? Honor the direct-ollama env only in E2E/test runs.
      // This lets Playwright packaged runs enable test-only behavior while keeping
      // release builds protected via `isReleaseBuild` in the env helper.
      const useDirectOllama = isE2E && (process.env.SADIE_DIRECT_OLLAMA === 'true' || process.env.SADIE_DIRECT_OLLAMA === '1');


        try {
          const N8N_STREAM_URL = process.env.N8N_STREAM_URL || `${n8nUrl}${SADIE_WEBHOOK_PATH}/stream`;
          const streamUrl = N8N_STREAM_URL;
          if (process.env.NODE_ENV !== 'production') {
            console.log('[Router] Final streamUrl built =', streamUrl, ' (N8N_STREAM_URL override present=', Boolean(process.env.N8N_STREAM_URL), ')');
            try { pushRouter(`Final streamUrl built = ${streamUrl}`); } catch (e) {}
            if (streamUrl === 'http://localhost:5678/webhook/sadie/chat/stream') {
              console.log('[Router] Verified streamUrl equals expected default');
              try { pushRouter('Verified streamUrl equals expected default'); } catch (e) {}
            }
          }
          if (process.env.NODE_ENV !== 'production') console.log('[DIAG] Stream POST target =', streamUrl);
          try { pushRouter(`Stream POST target = ${streamUrl}`); } catch (e) {}

          // In test runs, proactively validate the streaming endpoint to detect
          // immediate upstream failures (500/4xx). If the stream endpoint is
          // already failing, emit a deterministic error and end the stream so
          // the renderer reliably receives the error event instead of staying
          // stuck in 'streaming' state. This check runs only in test mode to
          // avoid additional latency in production runs.
          if (process.env.NODE_ENV === 'test') {
            console.log('[MAIN-DEBUG] About to probe streamUrl:', streamUrl);
            try { event.sender.send('sadie:stream-chunk', { chunk: `[DEBUG-PROBE-URL:${streamUrl}]`, streamId }); } catch (e) {}
            try {
              const probe = await axios.get(streamUrl, { timeout: 3000, validateStatus: () => true });
              console.log('[MAIN-DEBUG] Probe response status:', probe?.status);
              try { event.sender.send('sadie:stream-chunk', { chunk: `[DEBUG-PROBE-STATUS:${probe?.status}]`, streamId }); } catch (e) {}
              if (probe && probe.status >= 400) {
                console.log('[MAIN-DEBUG] Probe failed with status', probe.status, 'sending stream-error with streamId:', streamId);
                try { console.log('[E2E-TRACE] stream POST target probe returned error', { streamId, status: probe.status }); } catch (e) {}
                try { event.sender.send('sadie:stream-error', { error: true, message: 'Upstream error (n8n unavailable)', details: `probe:${probe.status}`, streamId }); } catch (e) {}
                console.log('[MAIN-DEBUG] Sent sadie:stream-error, now sending stream-end');
                try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                console.log('[MAIN-DEBUG] Sent sadie:stream-end');
                try { activeStreams.delete(streamId); } catch (e) {}
                return;
              }
            } catch (e: any) {
              console.log('[MAIN-DEBUG] Probe threw error, sending stream-error with streamId:', streamId);
              try { console.log('[E2E-TRACE] stream POST target probe failed', { streamId, error: e?.message || e }); } catch (e) {}
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Upstream error (n8n unavailable)', details: e?.message || String(e), streamId }); } catch (e) {}
              console.log('[MAIN-DEBUG] Sent sadie:stream-error, now sending stream-end');
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              console.log('[MAIN-DEBUG] Sent sadie:stream-end');
              try { activeStreams.delete(streamId); } catch (e) {}
              return;
            }
          }
          // notify renderer that stream is starting
                    event.sender.send('sadie:stream-start', { streamId });

        // E2E MOCK MODE: Replace all real streaming with deterministic chunks
        // Allow opt-out of the deterministic mock via `SADIE_E2E_BYPASS_MOCK=1` when we want
        // to exercise the real streaming/fallback paths in tests.
        // NOTE: Cannot use process.env.NODE_ENV === 'test' because webpack replaces it at compile time.
        // SADIE_E2E='1' means use mock mode, SADIE_E2E='0' means use real network
        // SADIE_E2E_BYPASS_MOCK='1' also means skip mock and use real network
        const wantMockMode = (process.env.SADIE_E2E === '1' || process.env.SADIE_E2E === 'true') && 
                             process.env.SADIE_E2E_BYPASS_MOCK !== '1';
        console.log('[MAIN-DEBUG] Mock mode check:', { wantMockMode, SADIE_E2E: process.env.SADIE_E2E, BYPASS_MOCK: process.env.SADIE_E2E_BYPASS_MOCK });
        if (wantMockMode) {
          if (process.env.NODE_ENV !== 'production') console.log('[E2E-MOCK] Starting deterministic streaming mock for streamId:', streamId);
          try { pushRouter(`E2E-MOCK starting streamId=${streamId}`); } catch (e) {}
          
          // Add user message to conversation history
          addToHistory(convId, 'user', request.message);
          
          // Track assistant response for history
          let assistantResponse = '';
          
          // Emit deterministic chunks with configurable delay (SADIE_E2E_MOCK_INTERVAL)
          const chunks = ['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4', 'chunk-5'];
          let chunkIndex = 0;
          const chunkInterval = Number(process.env.SADIE_E2E_MOCK_INTERVAL) || 200;
          
          const emitNextChunk = () => {
            // Check if stream was cancelled
            if (!activeStreams.has(streamId)) {
              if (process.env.NODE_ENV !== 'production') console.log('[E2E-MOCK] Stream cancelled during emission, streamId:', streamId);
              try { pushRouter(`E2E-MOCK stream cancelled streamId=${streamId}`); } catch (e) {}
              try { event.sender.send('sadie:stream-end', { streamId, cancelled: true }); } catch (e) {}
              return;
            }
            
            if (chunkIndex < chunks.length) {
              const chunk = chunks[chunkIndex];
              assistantResponse += chunk;
              try { event.sender.send('sadie:stream-chunk', { chunk, streamId }); } catch (e) {}
              if (process.env.NODE_ENV !== 'production') console.log('[E2E-MOCK] Emitted chunk:', chunk, 'for streamId:', streamId);
              try { pushRouter(`E2E-MOCK emitted chunk ${chunk} for streamId=${streamId}`); } catch (e) {}
              chunkIndex++;
              
              // Schedule next chunk after configured interval
              setTimeout(emitNextChunk, chunkInterval);
            } else {
              // All chunks emitted, end the stream
              if (assistantResponse.trim()) {
                addToHistory(convId, 'assistant', assistantResponse);
              }
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              if (process.env.NODE_ENV !== 'production') console.log('[E2E-MOCK] Stream completed for streamId:', streamId);
              try { pushRouter(`E2E-MOCK stream completed streamId=${streamId}`); } catch (e) {}
              activeStreams.delete(streamId);
            }
          };
          
          // Start emitting chunks
          activeStreams.set(streamId, { 
            destroy: () => {
              if (process.env.NODE_ENV !== 'production') console.log('[E2E-MOCK] Stream cancelled via destroy, streamId:', streamId);
              try { pushRouter(`E2E-MOCK stream cancelled via destroy streamId=${streamId}`); } catch (e) {}
              activeStreams.delete(streamId);
            }
          });
          
          // Start the first chunk immediately (no initial delay)
          setTimeout(emitNextChunk, 0);
          return;
        }

        // Check if we should use direct Ollama mode (bypass n8n) - env ignored in packaged builds
        const useDirectOllamaInner = useDirectOllama;
        if (E2E) {
          console.log('[E2E-TRACE] stream-start (real)', { streamId, conversationId: convId, userId: request.user_id, useDirectOllama: useDirectOllamaInner });
        }
        
        // Parse any attached documents and build enhanced message
        let enhancedMessage = request.message;
        if (request.documents && request.documents.length > 0) {
          console.log(`[SADIE] Parsing ${request.documents.length} document(s)...`);
          const documentContents = await parseDocuments(request.documents);
          if (documentContents.length > 0) {
            enhancedMessage = documentContents.join('\n\n') + '\n\n' + request.message;
          }

          // If router policy previously forced document handling, add a marker
          // so downstream pre-processing will ignore the parsed content and we
          // can also emit a short structured log for tracing in the n8n pipeline
          try {
            if (policyForcesDocument) {
              enhancedMessage = '[POLICY:FORCE_DOCUMENT]\n' + enhancedMessage;
              console.log('[SADIE] Policy enforced: document handling forced for this request');
              try { pushRouter(`Policy enforced: document handling forced for conv=${request?.conversation_id}`); } catch (e) {}

              // Add extra log with file metadata
              const file = request.documents[0];
              console.log('[SADIE] Document summary run metadata:', {
                tool_selected: 'document_reader',
                confidence: (policy?.fallback?.confidence_threshold) || 1.0,
                fileType: file.mimeType,
                contentLength: file.size
              });
            }
          } catch (e) {
            // ignore logging errors
          }
        }
        
        // Add user message to conversation history
        addToHistory(convId, 'user', enhancedMessage);
        
        // Track assistant response for history
        let assistantResponse = '';
        
        console.log('[SADIE] Stream request:', {
          streamId,
          useDirectOllama,
          env: process.env.SADIE_DIRECT_OLLAMA,
          streamUrl,
          conversationId: convId,
          historyLength: getHistory(convId).length,
          hasDocuments: request.documents?.length || 0,
          message: enhancedMessage.substring(0, 50)
        });
        
        if (useDirectOllama) {
          // Direct Ollama streaming - no n8n required
          const handler = await streamFromOllama(
            enhancedMessage,
            request.images,
            convId,
            (chunk) => {
              if (!activeStreams.has(streamId)) return;
              assistantResponse += chunk;
              event.sender.send('sadie:stream-chunk', { chunk, streamId });
                          if (E2E) {
                            console.log('[E2E-TRACE] stream-chunk (ollama)', { streamId, chunkLen: chunk?.length ?? 0, snippet: String(chunk).substring(0, 120) });
                          }
            },
            () => {
              // Add assistant response to history
              if (assistantResponse.trim()) {
                addToHistory(convId, 'assistant', assistantResponse);
              }
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                          if (E2E) {
                            console.log('[E2E-TRACE] stream-end (ollama)', { streamId });
                          }
              activeStreams.delete(streamId);
            },
            (err) => {
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Ollama error', details: err?.message || err, streamId }); } catch (e) {}
                          if (E2E) {
                            console.log('[E2E-TRACE] stream-error (ollama)', { streamId, error: err?.message || err });
                          }
              activeStreams.delete(streamId);
            },
            requestConfirmation // Pass confirmation requester
          );
          activeStreams.set(streamId, { destroy: handler.cancel });
          return;
        }

        // POST the request and expect a streaming (chunked) response
        const useProxy = !!(process.env.SADIE_PROXY_URL || process.env.SADIE_USE_PROXY === 'true');
        if (useProxy) {
          const proxyOpts = {
            proxyUrl: process.env.SADIE_PROXY_URL,
            apiKey: process.env.PROXY_API_KEYS || process.env.PROXY_API_KEY
          };

          const handler = streamFromSadieProxy(request, (chunk) => {
            try {
              // Only forward chunks while the stream is still active
              if (!activeStreams.has(streamId)) return;
              // forward raw chunk to renderer
              event.sender.send('sadie:stream-chunk', { chunk: chunk.toString?.() || String(chunk), streamId });
                          if (E2E) {
                            console.log('[E2E-TRACE] stream-chunk (proxy)', { streamId, chunkLen: String(chunk).length, snippet: String(chunk).substring(0, 120) });
                          }
            } catch (err) {}
          }, () => {
            try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                        if (E2E) {
                          console.log('[E2E-TRACE] stream-end (proxy)', { streamId });
                        }
            activeStreams.delete(streamId);
          }, (err) => {
            // Attempt a non-streaming fallback via n8n webhook before emitting an error
            (async () => {
              try {
                const fallbackUrl = `${n8nUrl}${SADIE_WEBHOOK_PATH}`;
                if (process.env.NODE_ENV !== 'production') console.log('[Router] Attempting non-stream fallback to', fallbackUrl, 'for streamId', streamId);
                const fallbackRes = await axios.post(fallbackUrl, request, { timeout: DEFAULT_TIMEOUT });
                const finalText = fallbackRes?.data?.message?.content || (fallbackRes?.data && JSON.stringify(fallbackRes.data));
                if (finalText) {
                  try { event.sender.send('sadie:stream-chunk', { chunk: finalText, streamId }); } catch (e) {}
                  try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                  if (process.env.NODE_ENV !== 'production') console.log('[Router] Non-stream fallback succeeded for streamId', streamId);
                  activeStreams.delete(streamId);
                  return;
                }
              } catch (fallbackErr) {
                if (process.env.NODE_ENV !== 'production') console.log('[Router] Non-stream fallback failed for streamId', streamId, 'error=', (fallbackErr as any)?.message || fallbackErr);
              }

              try { event.sender.send('sadie:stream-error', { error: true, message: 'Streaming error', details: (err as any)?.message || String(err), streamId }); } catch (e) {}
                          if (E2E) {
                            console.log('[E2E-TRACE] stream-error (proxy)', { streamId, error: err });
                          }
              activeStreams.delete(streamId);
            })();
          }, proxyOpts);

          // store cancellation function
          activeStreams.set(streamId, { destroy: handler.cancel });
        } else {
          // Diagnostic: record that we are about to POST to n8n
          if (process.env.NODE_ENV !== 'production') {
            logDebug('[Router] Preparing POST', streamUrl);
            try { logDebug('[Router] Payload preview', JSON.stringify(request, null, 2).substring(0, 1000)); } catch (e) { logDebug('[Router] Payload preview [cannot stringify]'); }
          }
          let payloadSent = false;
          // If a tool_call is present, run a safety check first via n8n safety webhook (if available)
          if (reqAny.tool_call) {
            try {
              const safetyUrl = `${n8nUrl}/webhook/sadie/validate`;
              if (process.env.NODE_ENV !== 'production') logDebug('[Router] Running safety check', { safetyUrl });
              const safetyRes = await axios.post(safetyUrl, { tool_call: reqAny.tool_call }, { timeout: DEFAULT_TIMEOUT });
              if (safetyRes?.data?.status === 'blocked') {
                // Safety blocked - return an error to the renderer and stop
                try { event.sender.send('sadie:stream-error', { error: true, message: 'Safety blocked', details: safetyRes.data, streamId }); } catch (e) {}
                activeStreams.delete(streamId);
                return;
              }
              if (safetyRes?.data?.status === 'needs_confirmation') {
                // Ask user for confirmation via renderer
                const confirmed = await requestConfirmation(safetyRes.data.message || 'Confirm action');
                if (!confirmed) {
                  try { event.sender.send('sadie:stream-error', { error: true, message: 'User declined confirmation', details: safetyRes.data, streamId }); } catch (e) {}
                  activeStreams.delete(streamId);
                  return;
                }
              }
            } catch (err: any) {
              // If safety webhook doesn't exist or returns 404, log and continue (fail-open)
              if (process.env.NODE_ENV !== 'production') logDebug('[Router] Safety check skipped or failed (continuing):', { error: err?.message || err });
            }
          }

          // Pre-register the stream BEFORE calling streamFromOllamaWithTools
          // This ensures pre-processing callbacks can send chunks immediately
          activeStreams.set(streamId, { destroy: () => {} });

          try {
            // Instead of proxying streaming through n8n (which can buffer), stream directly from Ollama here for true token-by-token behavior.
            const handler = await streamFromOllamaWithTools(
              enhancedMessage,
              request.images,
              convId,
              (chunk) => {
                if (!activeStreams.has(streamId)) return;
                try { event.sender.send('sadie:stream-chunk', { chunk, streamId }); } catch (e) {}
                if (process.env.NODE_ENV !== 'production') logDebug('[DIAG] direct-ollama chunk', { streamId, len: String(chunk).length, snippet: String(chunk).substring(0,120) });
              },
              (toolName, args) => {
                // notify renderer of tool call that will be executed
                try { event.sender.send('sadie:tool-call', { toolName, args, streamId }); } catch (e) {}
              },
              (result) => {
                // send tool execution result back to renderer (optional)
                try { event.sender.send('sadie:tool-result', { result, streamId }); } catch (e) {}
              },
              () => {
                try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                activeStreams.delete(streamId);
              },
              (err) => {
                // Try a non-streaming fallback when the streaming connection errors mid-flight
                (async () => {
                  console.log('[SADIE] direct stream onError: attempting non-stream fallback...');
                  try {
                    const fallbackBody = {
                      model: uncensoredModeEnabled ? OLLAMA_UNCENSORED_MODEL : OLLAMA_CHAT_MODEL,
                      messages: [ { role: 'system', content: SADIE_SYSTEM_PROMPT }, { role: 'user', content: reqAny.message } ],
                      stream: false
                    };
                    const fallbackRes = await axios.post(`${OLLAMA_URL}/api/chat`, fallbackBody, { timeout: DEFAULT_TIMEOUT });
                    const finalText = fallbackRes?.data?.message?.content || (fallbackRes?.data && JSON.stringify(fallbackRes.data));
                    if (finalText) {
                      try { event.sender.send('sadie:stream-chunk', { chunk: finalText, streamId }); } catch (e) {}
                    }
                    try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                    activeStreams.delete(streamId);
                    console.log('[SADIE] direct stream fallback: succeeded');
                    return;
                  } catch (fallbackErr: any) {
                    console.log('[SADIE] direct stream fallback: failed', fallbackErr?.message || fallbackErr);
                    try { event.sender.send('sadie:stream-error', { error: true, message: 'Ollama streaming error', details: err?.message || err, streamId }); } catch (e) {}
                    activeStreams.delete(streamId);
                  }
                })();
              },
              requestConfirmation,
              (missingPermissions: string[], reason: string) => permissionRequester.request(event.sender, streamId, missingPermissions, reason)
            );

            activeStreams.set(streamId, { destroy: handler.cancel });
          } catch (err: any) {
            logError('[Router] direct stream error', err?.message || err);
            try { pushRouter(`direct stream error: ${err?.message || String(err)}`); } catch (e) {}

            // Attempt a non-streaming fallback to Ollama to retrieve a final message
            try {
              const fallbackBody = {
                model: uncensoredModeEnabled ? OLLAMA_UNCENSORED_MODEL : OLLAMA_CHAT_MODEL,
                messages: [ { role: 'system', content: SADIE_SYSTEM_PROMPT }, { role: 'user', content: reqAny.message } ],
                stream: false
              };
              const fallbackRes = await axios.post(`${OLLAMA_URL}/api/chat`, fallbackBody, { timeout: DEFAULT_TIMEOUT });
              const finalText = fallbackRes?.data?.message?.content || (fallbackRes?.data && JSON.stringify(fallbackRes.data));
              if (finalText) {
                try { event.sender.send('sadie:stream-chunk', { chunk: finalText, streamId }); } catch (e) {}
              }
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              activeStreams.delete(streamId);
              try { pushRouter(`direct stream fallback succeeded for streamId=${streamId}`); } catch (e) {}
              return;
            } catch (fallbackErr: any) {
              // If fallback also fails, emit stream-error and clean up
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Streaming initialization error', details: err?.message || err, streamId }); } catch (e) {}
              try { pushRouter(`direct stream fallback failed for streamId=${streamId} error=${fallbackErr?.message || fallbackErr}`); } catch (e) {}
              activeStreams.delete(streamId);
            }
          }
        }
      } catch (error: any) {
        // n8n failed - either fall back to direct Ollama (if explicitly enabled),
        // or return an error to the renderer. Do NOT fall back to Ollama silently
        // because this can mask upstream failures during tests.
            // Fallback: fetch a non-streaming response from Ollama and return final text
            try {
              const fallbackBody = {
                model: uncensoredModeEnabled ? OLLAMA_UNCENSORED_MODEL : OLLAMA_CHAT_MODEL,
                messages: [ { role: 'system', content: SADIE_SYSTEM_PROMPT }, { role: 'user', content: reqAny.message } ],
                stream: false
              };
              const fallbackRes = await axios.post(`${OLLAMA_URL}/api/chat`, fallbackBody, { timeout: DEFAULT_TIMEOUT });
              // Parse and send final assistant content
              try {
                const finalText = fallbackRes?.data?.message?.content || (fallbackRes?.data && JSON.stringify(fallbackRes.data));
                if (finalText) {
                  event.sender.send('sadie:stream-chunk', { chunk: finalText, streamId });
                }
              } catch (e) {}
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              activeStreams.delete(streamId);
            } catch (fallbackErr: any) {
              // If fallback also fails, emit stream-error and clean up
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Streaming fallback failed', details: fallbackErr?.message || fallbackErr, streamId }); } catch (e) {}
              activeStreams.delete(streamId);
            }
        console.log('[SADIE] n8n failed:', error?.message || error);
        try { pushRouter(`n8n failed: ${error?.message || String(error)}`); } catch (e) {}
          if (useDirectOllama) {
          console.log('[SADIE] Falling back to direct Ollama...');
          try {
          let fallbackResponse = '';
          const handler = await streamFromOllama(
            reqAny.message,
            reqAny.images,
            convId,
            (chunk: string) => {
              if (!activeStreams.has(streamId)) return;
              fallbackResponse += chunk;
              event.sender.send('sadie:stream-chunk', { chunk, streamId });
            },
            () => {
              if (fallbackResponse.trim()) {
                addToHistory(convId, 'assistant', fallbackResponse);
              }
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              activeStreams.delete(streamId);
            },
            (err: any) => {
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Ollama error', details: err?.message || err, streamId }); } catch (e) {}
              activeStreams.delete(streamId);
            }
          );
          activeStreams.set(streamId, { destroy: handler.cancel });
          } catch (ollamaError: any) {
            event.sender.send('sadie:stream-error', { error: true, message: 'Both n8n and Ollama unavailable', details: ollamaError?.message || ollamaError, streamId });
          }
        } else {
          // If we are not allowed to fallback to Ollama, propagate the error to frontend.
          // Emit a deterministic error then end so renderer always receives a single
          // error event and then the stream end notification (prevents the UI from
          // remaining stuck in 'streaming' state when upstream fails).
          try {
            console.log('[E2E-TRACE] sending deterministic stream-error Upstream error', { streamId, details: error?.message || error });
          } catch (e) {}
          try { event.sender.send('sadie:stream-error', { error: true, message: 'Upstream error (n8n unavailable)', details: error?.message || error, streamId }); } catch (e) {}
          try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
          try { activeStreams.delete(streamId); } catch (e) {}
          if (E2E) {
            console.log('[E2E-TRACE] n8n error, fallback disabled (deterministic emit sent)', { streamId, error: error?.message || error, fallbackEnabled: useDirectOllama });
          }
        }
      }
    });

    // Cancel a running stream by id (or all if no id provided)
    ipcMain.on('sadie:stream-cancel', (_event: IpcMainEvent, payload: { streamId?: string }) => {
      const { streamId } = payload || {};
      if (!streamId) {
          // cancel all
          for (const [id, entry] of activeStreams.entries()) {
            try { entry.destroy?.(); } catch (e) {}
            try { (entry.stream as any)?.destroy?.(); } catch (e) {}
            activeStreams.delete(id);
          }
          return;
        }

      const entry = activeStreams.get(streamId);
      if (entry) {
        // If we're running in an E2E environment, send a best-effort cancel
        // POST to the upstream mock so it stops emitting immediately. This
        // helps make cancel behavior deterministic in tests.
        try {
          if (E2E) {
            // Don't await — fire and forget
            axios.post(`${n8nUrl}/__sadie_e2e_cancel`, { streamId }).catch(() => {});
          }
        } catch (e) {}
        // Remove from the active map immediately so any in-flight data handlers
        // will stop forwarding further chunks.
        activeStreams.delete(streamId);
                if (E2E) {
                  console.log('[E2E-TRACE] stream-cancel-received', { streamId });
                }
        // notify renderer the stream ended due to cancel
        _event?.sender?.send('sadie:stream-end', { streamId, cancelled: true });
        // then attempt to abort/destroy the underlying stream/request
        try { entry.destroy?.(); } catch (e) {}
        try { (entry.stream as any)?.destroy?.(); } catch (e) {}
      }
    });

    // Test helper: trigger a simulated non-stream fallback for a given streamId (E2E only)
    ipcMain.handle('sadie:__e2e_trigger_fallback', async (event: IpcMainInvokeEvent, payload: { streamId: string; finalText?: string }) => {
      console.log('[E2E-TRACE] __e2e_trigger_fallback invoked, SADIE_E2E=', process.env.SADIE_E2E, 'NODE_ENV=', process.env.NODE_ENV);
      try {
        const { streamId, finalText } = payload || {} as any;
        if (!streamId) return { ok: false, error: 'MISSING_STREAM_ID' };
        event.sender.send('sadie:stream-chunk', { chunk: finalText || 'final-fallback', streamId });
        event.sender.send('sadie:stream-end', { streamId });
        return { ok: true };
      } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
    });
    // Test helper: invoke a tool batch via main and exercise the permission escalation flow (E2E only)
    ipcMain.handle('sadie:__e2e_invoke_tool_batch', async (event: IpcMainInvokeEvent, payload: { calls: any[]; streamId?: string }) => {
      try {
        // Allow E2E helper when the centralized env module reports E2E mode
        // (this is more robust in packaged/release builds where raw env vars
        // may be sanitized early). Also keep NODE_ENV=test as a fallback.
        const envModule = require('./env');
        const e2eEnabled = Boolean(envModule.isE2E) || process.env.NODE_ENV === 'test';
        if (!e2eEnabled) return { ok: false, error: 'E2E_ONLY' };
        const { calls, streamId } = payload || {} as any;
        if (!Array.isArray(calls) || calls.length === 0) return { ok: false, error: 'MISSING_CALLS' };
        // Run batch precheck
        const batch = await executeToolBatch(calls, { executionId: `e2e-${Date.now()}` } as any);
        if (batch.length === 1 && (batch[0] as any).status === 'needs_confirmation') {
          const missing = (batch[0] as any).missingPermissions || [];
          const reason = (batch[0] as any).reason || `Requires: ${missing.join(', ')}`;
          const resp = await permissionRequester.request(event.sender, streamId || `e2e-${Date.now()}`, missing, reason);

          if (!resp || resp.decision === 'cancel') return { ok: false, error: 'USER_CANCELLED' };
          if (resp.decision === 'allow_once') {
            const rerun = await executeToolBatch(calls, { executionId: `e2e-${Date.now()}` } as any, { overrideAllowed: missing });
            return { ok: true, result: rerun };
          }
          if (resp.decision === 'always_allow') {
            try { const { getSettings, saveSettings } = require('./config-manager'); const s = getSettings(); s.permissions = s.permissions || {}; for (const p of missing) s.permissions[p] = true; saveSettings(s); } catch (e) {}
            const rerun = await executeToolBatch(calls, { executionId: `e2e-${Date.now()}` } as any);
            return { ok: true, result: rerun };
          }
        }

        // No permission needed, or executed directly
        return { ok: true, result: batch };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
      }
    });
    // Test helper: retrieve router diagnostics buffer (E2E only)
    ipcMain.handle('sadie:__e2e_get_router_logs', async () => {
      return (global as any).__SADIE_ROUTER_LOG_BUFFER || [];
    });
    // Test helper: trigger a simulated upstream error for a given streamId (E2E only)
    ipcMain.handle('sadie:__e2e_trigger_upstream_error', async (event: IpcMainInvokeEvent, payload: { streamId: string; message?: string }) => {
      try {
        const { streamId, message } = payload || {} as any;
        if (!streamId) return { ok: false, error: 'MISSING_STREAM_ID' };
        console.log('[E2E-TRACE] __e2e_trigger_upstream_error invoked', { streamId });
        event.sender.send('sadie:stream-error', { error: true, message: message || 'Upstream error (simulated)', streamId, diagnostic: { simulated: true } });
        event.sender.send('sadie:stream-end', { streamId });
        return { ok: true };
      } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
    });
  ipcMain.handle(IPC_SEND_MESSAGE, async (_event, request: SadieRequestWithImages | SadieRequest) => {
    if (!request || typeof request !== 'object' || !request.user_id || !request.message || !request.conversation_id) {
      return {
        success: false,
        error: true,
        message: 'Invalid request format.',
        response: 'VALIDATION_ERROR'
      };
    }

    // Validate images if present
    const validation = validateImages((request as any).images);
    if (!validation.ok) {
      return {
        success: false,
        error: true,
        code: validation.code,
        message: validation.message
      } as any;
    }

    // Use centralized processor for incoming requests so we can enforce
    // gating: if tools are required, never call the LLM or webhook.
    return await processIncomingRequest(request as any, n8nUrl);
  });
}
