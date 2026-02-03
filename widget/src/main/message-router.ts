import { ipcMain, BrowserWindow, IpcMainEvent } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { permissionRequester } from './permission-requester';
import { looksLikeToolJson } from './tool-helpers';
import axios from 'axios';
import { debug as logDebug, error as logError } from '../shared/logger';
import streamFromSadieProxy from './stream-proxy-client';
import { SadieRequest, SadieResponse, SadieRequestWithImages, ImageAttachment, DocumentAttachment } from '../shared/types';
import { IPC_SEND_MESSAGE, SADIE_WEBHOOK_PATH, DEFAULT_OLLAMA_URL } from '../shared/constants';
import { SADIE_SYSTEM_PROMPT } from '../shared/system-prompt';
import { initializeTools, getOllamaTools, executeToolBatch, ToolCall, ToolContext } from './tools';
import { documentToolHandlers } from './tools/documents';
import { isE2E, isPackagedBuild } from './env';
import { getSettings, saveSettings } from './config-manager';
import { streamFromCustomLLM, validateCustomLLMConfig } from './custom-llm-client';

const E2E = isE2E;
const PACKAGED = isPackagedBuild;

const DEFAULT_TIMEOUT = 30000;
const OLLAMA_URL = process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;

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

// Exported for potential future use and testing
export function clearHistory(conversationId: string) {
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

// Exported deterministic intent router so it can be used by the message handler
// and imported directly by unit tests.
export async function preProcessIntent(userMessage: string): Promise<{ calls: any[] } | null> {
  if (!userMessage || typeof userMessage !== 'string') return null;
  const m = userMessage.toLowerCase();

  // SPORTS / NBA intents - match team names and basketball terms
  // Common NBA team names for fuzzy matching
  const nbaTeams = ['warriors', 'lakers', 'celtics', 'bulls', 'heat', 'nets', 'knicks', 'suns', 'bucks', 'nuggets', 
                   'clippers', 'spurs', 'rockets', 'mavericks', 'thunder', 'jazz', 'kings', 'pelicans', 'grizzlies',
                   'hawks', 'hornets', 'cavaliers', 'pistons', 'pacers', 'magic', 'wizards', 'raptors', 'timberwolves', 'blazers', '76ers', 'sixers'];
  const hasNbaTeam = nbaTeams.some(team => m.includes(team));
  
  if (hasNbaTeam || /\b(nba|basketball|game(s)?|scores?|playing|play next|play today|schedule)\b/i.test(m)) {
    // Extract team name
    let teamQuery = '';
    for (const team of nbaTeams) {
      if (m.includes(team)) {
        teamQuery = team;
        break;
      }
    }
    const dateRange = /last week|this week|last_7_days|last 7 days/i.test(m) ? 'last_7_days' : '';
    const call = { name: 'nba_query', arguments: { type: 'games', date: dateRange, perPage: 10, query: teamQuery } };
    return { calls: [call] };
  }

  // WEATHER intents - very fuzzy match for weather/weater/wether/whether etc
  if (/w[eh]a?th?e?r/i.test(m) || /\b(forecast|temperature|rain|sunny|cloudy)\b/i.test(m)) {
    // Extract location - look for "in <location>" pattern
    const locMatch = m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]*?)(?:\s+tomorrow|\s+today|\s+tonight|\s+this week|$)/i) ||
                     m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]+)/i);
    let location = locMatch ? locMatch[1].trim() : '';
    // Remove trailing time words
    location = location.replace(/\s*(tomorrow|today|tonight|this week|next week)$/i, '').trim();
    if (location) return { calls: [{ name: 'get_weather', arguments: { location } }] };
    // If no location found, don't match - let LLM handle it
    return null;
  }

  // WEB SEARCH intents
  if (/\b(search for|find|who is|what is|look up|tell me about|google)\b/i.test(m)) {
    const q = userMessage.trim();
    return { calls: [{ name: 'web_search', arguments: { query: q, maxResults: 5, fetchTopResult: true } }] };
  }

  return null;
}

// Centralized routing decision type and analyzer. This is the single canonical
// place that decides whether a message should invoke tools or be handled by
// the LLM. Other modules should consume the resulting RoutingDecision.
export type RoutingDecision =
  | { type: 'tools'; calls: ToolCall[] }
  | { type: 'llm' }
  | { type: 'error'; reason: string };

export async function analyzeAndRouteMessage(message: string): Promise<RoutingDecision> {
  if (!message || typeof message !== 'string') return { type: 'error', reason: 'invalid_message' };
  try {
    const pre = await preProcessIntent(message);
    if (pre && Array.isArray(pre.calls) && pre.calls.length > 0) {
      return { type: 'tools', calls: pre.calls as ToolCall[] };
    }
    return { type: 'llm' };
  } catch (err: any) {
    return { type: 'error', reason: String(err?.message || err) };
  }
}

// Summarize tool results into a human-readable assistant message. Keep this
// deterministic and brief so the UI can present a helpful summary after tools
// execute.
function takeSentences(text: string, maxChars = 400, maxSentences = 3): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  let out = '';
  let count = 0;
  for (const part of cleaned.split(/(?<=[.!?])\s+/)) {
    if (!part) continue;
    const candidate = out ? `${out} ${part}` : part;
    if (candidate.length > maxChars || count >= maxSentences) break;
    out = candidate;
    count++;
  }
  return out || cleaned.slice(0, maxChars);
}

function extractKeySnippets(text: string, maxItems = 2): string[] {
  const sentences = (text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
  const interesting: string[] = [];
  const signal = /(\bjan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec\b|\b\d{1,2}[\/\-]\d{1,2}\b|\b\d{1,2}\s?(am|pm)\b|\bvs\b|\bat\b)/i;
  for (const s of sentences) {
    if (!s) continue;
    if (signal.test(s)) {
      interesting.push(s.trim());
      if (interesting.length >= maxItems) break;
    }
  }
  return interesting;
}

function formatWebSearchResult(payload: any): string {
  const res = payload?.result ?? payload;
  if (!res) return '';
  const parts: string[] = [];
  const top = res.topResultContent;
  const firstResult = Array.isArray(res.results) && res.results.length > 0 ? res.results[0] : undefined;
  const content = (top?.contentText || top?.content || firstResult?.snippet || '').trim();

  if (top?.title) parts.push(top.title);
  const condensed = takeSentences(content, 320, 3);
  if (condensed) parts.push(condensed);

   // Surface up to two high-signal snippets (dates, times, vs/at) to answer schedule-like queries quickly.
  const highlights = extractKeySnippets(content, 2);
  if (highlights.length > 0) {
    parts.push(highlights.map(h => `- ${h}`).join('\n'));
  }

  if (firstResult?.url) parts.push(`Top link: ${firstResult.title || firstResult.url} ΓÇö ${firstResult.url}`);
  else if (top?.url) parts.push(`Source: ${top.url}`);

  if (res.note) parts.push(res.note);
  return parts.filter(Boolean).join('\n');
}

function summarizeToolResults(results: any[]): string {
  if (!results || results.length === 0) return 'No results returned from tools.';
  const parts: string[] = [];
  for (const r of results) {
    if (r === null || r === undefined) continue;
    if (r.success === false) {
      parts.push(`Tool failed: ${r.error || r.message || 'unknown error'}`);
      continue;
    }
    const webSummary = formatWebSearchResult(r.result || r);
    if (webSummary) {
      parts.push(webSummary);
      continue;
    }
    // Heuristic extraction for common result shapes
    if (r.result && typeof r.result === 'string') parts.push(r.result);
    else if (r.result && typeof r.result === 'object') {
      // Try to stringify concise keys
      if (r.result.summary) parts.push(r.result.summary);
      else if (r.result.content) parts.push(r.result.content);
      else parts.push(JSON.stringify(r.result).slice(0, 400));
    } else if (r.output && typeof r.output === 'string') parts.push(r.output);
    else parts.push(JSON.stringify(r).slice(0, 400));
  }
  return parts.join('\n\n');
}

// Process an incoming request at the router boundary. This enforces the
// tool-gating policy: when routing decision is `tools`, the LLM/webhook must
// NOT be called. Returns structured assistant payloads for the renderer.
export async function processIncomingRequest(request: SadieRequestWithImages | SadieRequest, n8nUrl: string, decisionOverride?: RoutingDecision) {
  try {
    const decision = decisionOverride ?? await analyzeAndRouteMessage(request.message as string);
    // diagnostic log for tests
    try { console.log('[ROUTER DIAG] decision=', JSON.stringify(decision)); } catch (e) {}

    if (decision.type === 'error') {
      return { success: false, error: true, message: `Routing error: ${decision.reason}` };
    }

    if (decision.type === 'tools') {
      // Execute tools atomically and return deterministic assistant summary.
      const toolContext: ToolContext = { executionId: `pre-${Date.now()}` } as any;
      try {
        const results = await executeToolBatch(decision.calls, toolContext as any);

        // If any result indicates missing permissions, surface that explicitly.
        const needsConfirmation = (results || []).find((r: any) => r && r.status === 'needs_confirmation');
        if (needsConfirmation) {
          return {
            success: true,
            data: {
              assistant: {
                role: 'assistant',
                content: `This action requires permissions: ${(needsConfirmation.missingPermissions || []).join(', ')}`,
                status: 'needs_confirmation',
                missingPermissions: needsConfirmation.missingPermissions || []
              },
              toolResults: results,
              routed: true
            }
          };
        }

        // If any tool failed for other reasons, return a structured error.
        const failed = (results || []).filter((r: any) => r && r.success === false && r.status !== 'needs_confirmation');
        if (failed.length > 0) {
          const msgs = failed.map((f: any) => f.error || f.message || JSON.stringify(f)).join('; ');
          return {
            success: true,
            data: {
              assistant: {
                role: 'assistant',
                content: `Tool execution error: ${msgs}`,
                status: 'error'
              },
              toolResults: results,
              routed: true
            }
          };
        }

        // Normal success path: deterministic assistant summary
        const assistantText = summarizeToolResults(results as any[]);
        return {
          success: true,
          data: {
            assistant: {
              role: 'assistant',
              content: assistantText
            },
            toolResults: results,
            routed: true
          }
        };
      } catch (toolErr: any) {
        return { success: true, data: { assistant: { role: 'assistant', content: `Tool execution failed: ${String(toolErr?.message || toolErr)}`, status: 'error' }, routed: true } };
      }
    }

    // Only if decision.type === 'llm' do we call the upstream orchestrator/webhook.
    if (decision.type === 'llm') {
      const response = await axios.post(`${n8nUrl}${SADIE_WEBHOOK_PATH}`, request, {
        timeout: DEFAULT_TIMEOUT,
        headers: { 'Content-Type': 'application/json' }
      });
      return { success: true, data: response.data };
    }

    return { success: false, error: true, message: 'Unhandled routing decision' };
  } catch (err: any) {
    return mapErrorToSadieResponse(err);
  }
}

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

// Simple greeting patterns that shouldn't trigger tool calls
const SIMPLE_GREETING_PATTERNS = /^(hi|hello|hey|yo|sup|howdy|greetings|good\s*(morning|afternoon|evening)|what'?s\s*up|hiya)[\s!?.]*$/i;

/**
 * Check if a message is a simple greeting that doesn't need tools
 */
function isSimpleGreeting(message: string): boolean {
  return SIMPLE_GREETING_PATTERNS.test(message.trim());
}

// Wrapper function that routes to either Ollama or Custom LLM based on settings
export async function streamFromLLM(
  message: string, 
  images: ImageAttachment[] | undefined,
  conversationId: string,
  onChunk: (text: string) => void, 
  onToolCall: (toolName: string, args: any) => void,
  onToolResult: (result: any) => void,
  onEnd: () => void, 
  onError: (err: any) => void,
  requestConfirmation?: (msg: string) => Promise<boolean>,
  requestPermission?: (missingPermissions: string[], reason: string) => Promise<{ decision: 'allow_once'|'always_allow'|'cancel'; missingPermissions?: string[] }>,
  options?: { hasDocuments?: boolean }
): Promise<{ cancel: () => void }> {
  const settings = await getSettings();
  
  // Check if custom LLM is enabled and configured
  if ((settings as any).useCustomLLM && (settings as any).customLLM) {
    const validation = validateCustomLLMConfig((settings as any).customLLM);
    if (validation.valid) {
      console.log(`[SADIE] Using custom LLM: ${(settings as any).customLLM.name} (${(settings as any).customLLM.provider})`);
      
      // Custom LLMs currently don't support tool calling or images
      if (images && images.length > 0) {
        onChunk('\n\n⚠️ Image attachments are not yet supported with custom LLM APIs. Using Ollama vision model instead.\n\n');
        // Fall back to Ollama for images
        return streamFromOllamaWithTools(message, images, conversationId, onChunk, onToolCall, onToolResult, onEnd, onError, requestConfirmation, requestPermission, options);
      }
      
      const controller = new AbortController();
      const history = getHistory(conversationId);
      
      streamFromCustomLLM(
        message,
        history.map(m => ({ role: m.role as any, content: m.content })),
        (settings as any).customLLM,
        SADIE_SYSTEM_PROMPT,
        onChunk,
        onEnd,
        onError,
        controller.signal
      );
      
      return {
        cancel: () => controller.abort()
      };
    } else {
      console.warn(`[SADIE] Invalid custom LLM config: ${validation.error}. Falling back to Ollama.`);
      onChunk(`\n\n⚠️ Custom LLM configuration error: ${validation.error}\nFalling back to Ollama...\n\n`);
    }
  }
  
  // Default: use Ollama
  return streamFromOllamaWithTools(message, images, conversationId, onChunk, onToolCall, onToolResult, onEnd, onError, requestConfirmation, requestPermission, options);
}

// Stream from Ollama with tool calling support
export async function streamFromOllamaWithTools(
  message: string, 
  images: ImageAttachment[] | undefined,
  conversationId: string,
  onChunk: (text: string) => void, 
  _onToolCall: (toolName: string, args: any) => void,
  onToolResult: (result: any) => void,
  onEnd: () => void, 
  onError: (err: any) => void,
  requestConfirmation?: (msg: string) => Promise<boolean>,
  requestPermission?: (missingPermissions: string[], reason: string) => Promise<{ decision: 'allow_once'|'always_allow'|'cancel'; missingPermissions?: string[] }>,
  options?: { hasDocuments?: boolean }
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
  
  // Check if we have images - use vision model if so (vision models typically don't support tools)
  const hasImages = images && images.length > 0;
  // Select model: vision > uncensored > normal
  const chatModel = uncensoredModeEnabled ? OLLAMA_UNCENSORED_MODEL : OLLAMA_CHAT_MODEL;
  const model = hasImages ? OLLAMA_VISION_MODEL : chatModel;
  
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
  
  // Get tools (disable for vision models, models that don't support tools, and simple greetings)
  // dolphin-llama3 doesn't support Ollama tool calling
  const modelSupportsTools = !hasImages && model !== OLLAMA_UNCENSORED_MODEL;
  const skipToolsForGreeting = isSimpleGreeting(message);
  const hasDocuments = options?.hasDocuments ?? false;
  
  // Only include document tools when documents are actually attached to THIS message
  const tools = (modelSupportsTools && !skipToolsForGreeting) 
    ? getOllamaTools({ excludeDocumentTools: !hasDocuments })
    : undefined;
  
  console.log(`[SADIE] streamFromOllamaWithTools: model=${model}, images=${imageData.length}, tools=${tools?.length || 0}, history=${history.length}, uncensored=${uncensoredModeEnabled}, hasDocuments=${hasDocuments}, isGreeting=${skipToolsForGreeting}, message="${message.substring(0, 30)}..."`);
  
  // Tool execution context
  const toolContext: ToolContext = {
    executionId: `exec-${Date.now()}`,
    requestConfirmation
  };

  // Recursive function to handle tool calls
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
      // looks like raw tool JSON, parse and route it through the tool
      // execution pipeline rather than rendering it as plain text.
      if (pendingToolCalls.length === 0 && looksLikeToolJson(assistantContent)) {
        try {
          const parsed = JSON.parse(assistantContent);
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
        const TOOL_ALIASES: Record<string, string> = { nba_scores: 'nba_query' };
        const calls = pendingToolCalls.map((c: any) => {
          const toolName = c.function?.name || c.name;
          const normalizedName = TOOL_ALIASES[toolName] || toolName;
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
          onToolResult(result);
          messages.push({ role: 'tool', content: JSON.stringify(result) });
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

export function registerMessageRouter(_mainWindow: BrowserWindow, n8nUrl: string) {
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
            try {
              const probe = await axios.get(streamUrl, { timeout: 3000, validateStatus: () => true });
              if (probe && probe.status >= 400) {
                try { console.log('[E2E-TRACE] stream POST target probe returned error', { streamId, status: probe.status }); } catch (e) {}
                try { event.sender.send('sadie:stream-error', { error: true, message: 'Upstream error (n8n unavailable)', details: `probe:${probe.status}`, streamId }); } catch (e) {}
                try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                try { activeStreams.delete(streamId); } catch (e) {}
                return;
              }
            } catch (e: any) {
              try { console.log('[E2E-TRACE] stream POST target probe failed', { streamId, error: e?.message || e }); } catch (e) {}
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Upstream error (n8n unavailable)', details: e?.message || String(e), streamId }); } catch (e) {}
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              try { activeStreams.delete(streamId); } catch (e) {}
              return;
            }
          }
          // notify renderer that stream is starting
                    event.sender.send('sadie:stream-start', { streamId });

        // E2E MOCK MODE: Replace all real streaming with deterministic chunks
        // Allow opt-out of the deterministic mock via `SADIE_E2E_BYPASS_MOCK=1` when we want
        // to exercise the real streaming/fallback paths in tests.
        if (E2E && process.env.SADIE_E2E_BYPASS_MOCK !== '1') {
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

          try {
            // SMART ROUTING: Use intent detection first to handle known patterns reliably
            const intentResult = await preProcessIntent(enhancedMessage);
            console.log('[SADIE] Intent result:', intentResult);
            let shouldUseDirectTools = false;
            let toolResults: any[] | null = null;
            
            if (intentResult && intentResult.calls && intentResult.calls.length > 0) {
              console.log('[SADIE] Intent detected, executing tools directly:', intentResult.calls.map((c: any) => c.name));
              
              // Execute tools directly without involving the LLM
              try {
                toolResults = await executeToolBatch(intentResult.calls as ToolCall[], {
                  executionId: `intent-${Date.now()}`,
                  requestConfirmation,
                  requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason)
                } as ToolContext);
                
                console.log('[SADIE] Intent tool results:', toolResults);
                
                // Check if results are empty/useless (0 items returned) OR failed
                const hasUsefulResults = toolResults.some((r: any) => {
                  if (!r) return false;
                  // Check for failures
                  if (r.success === false) return false;
                  if (!r.result) return false;
                  // Check for empty arrays
                  if (r.result.events && Array.isArray(r.result.events) && r.result.events.length === 0) return false;
                  if (r.result.players && Array.isArray(r.result.players) && r.result.players.length === 0) return false;
                  if (r.result.teams && Array.isArray(r.result.teams) && r.result.teams.length === 0) return false;
                  if (r.result.articles && Array.isArray(r.result.articles) && r.result.articles.length === 0) return false;
                  if (r.result.resultCount === 0) return false;
                  return true;
                });
                
                if (!hasUsefulResults) {
                  console.log('[SADIE] Tool results empty or failed, falling back to web search');
                  // Fall back to web search - add context based on original intent
                  let searchQuery = enhancedMessage;
                  // If original call was NBA-related, add context to avoid wrong results
                  const wasNbaQuery = intentResult.calls.some((c: any) => c.name === 'nba_query');
                  if (wasNbaQuery && !/\b(nba|basketball|golden state)\b/i.test(searchQuery)) {
                    searchQuery = `NBA basketball ${searchQuery}`;
                  }
                  const webSearchCall: ToolCall = {
                    name: 'web_search',
                    arguments: {
                      query: searchQuery,
                      maxResults: 3,
                      fetchTopResult: true
                    }
                  };
                  
                  toolResults = await executeToolBatch([webSearchCall], {
                    executionId: `websearch-${Date.now()}`,
                    requestConfirmation,
                    requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason)
                  } as ToolContext);
                  
                  console.log('[SADIE] Web search results:', toolResults);
                }
                
                shouldUseDirectTools = true;
              } catch (toolErr: any) {
                console.error('[SADIE] Intent tool execution failed:', toolErr);
                // Try web search as ultimate fallback - add context based on original intent
                try {
                  console.log('[SADIE] Trying web search as fallback after error');
                  let fallbackQuery = enhancedMessage;
                  const wasNbaQuery = intentResult.calls.some((c: any) => c.name === 'nba_query');
                  if (wasNbaQuery && !/\b(nba|basketball|golden state)\b/i.test(fallbackQuery)) {
                    fallbackQuery = `NBA basketball ${fallbackQuery}`;
                  }
                  const webSearchCall: ToolCall = {
                    name: 'web_search',
                    arguments: {
                      query: fallbackQuery,
                      maxResults: 3,
                      fetchTopResult: true
                    }
                  };
                  toolResults = await executeToolBatch([webSearchCall], {
                    executionId: `websearch-fallback-${Date.now()}`,
                    requestConfirmation,
                    requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason)
                  } as ToolContext);
                  shouldUseDirectTools = true;
                } catch (webErr) {
                  console.error('[SADIE] Web search fallback also failed:', webErr);
                  // Continue to LLM fallback
                }
              }
            }
            
            // If we have tool results from intent detection, stream them as the response
            if (shouldUseDirectTools && toolResults) {
              // Ensure stream is tracked
              if (!activeStreams.has(streamId)) {
                activeStreams.set(streamId, { destroy: () => {} });
              }

              // Format tool results into a nice response
              let responseText = '';
              for (const result of toolResults) {
                if (result.result) {
                  // Handle NBA games
                  if (result.result.events && result.result.events.length > 0) {
                    responseText += 'Here are the games:\n\n';
                    result.result.events.slice(0, 5).forEach((game: any) => {
                      const teams = game.competitions?.[0]?.competitors?.map((c: any) => c.team.displayName).join(' vs ') || 'Unknown matchup';
                      const status = game.status?.type?.shortDetail || game.status?.type?.description || 'Scheduled';
                      responseText += `${teams} - ${status}\n`;
                    });
                  } 
                  // Handle web search results
                  else if (result.result.topResultContent) {
                    const topContent = result.result.topResultContent.content || result.result.topResultContent.contentText;
                    if (topContent) {
                      responseText += topContent + '\n\n';
                    }
                    if (result.result.topResultContent.url) {
                      responseText += `Source: ${result.result.topResultContent.url}\n`;
                    }
                    if (!topContent && result.result.note) {
                      responseText += `${result.result.note}\n`;
                    }
                  }
                  // Handle generic results with results array
                  else if (result.result.results && Array.isArray(result.result.results) && result.result.results.length > 0) {
                    result.result.results.slice(0, 3).forEach((item: any) => {
                      if (item.title) responseText += `ΓÇó ${item.title}\n`;
                      if (item.snippet) responseText += `  ${item.snippet}\n`;
                      if (item.url) responseText += `  ${item.url}\n`;
                      responseText += '\n';
                    });
                    if (result.result.note) {
                      responseText += `${result.result.note}\n`;
                    }
                  }
                  // Handle plain content/summary
                  else if (result.result.content) {
                    responseText += result.result.content + '\n';
                  } else if (result.result.summary) {
                    responseText += result.result.summary + '\n';
                  } 
                  // Last resort: stringify
                  else {
                    responseText += JSON.stringify(result.result).slice(0, 500) + '\n';
                  }
                }
              }

              // If nothing was assembled, dump the raw result to avoid silent empties
              if (!responseText.trim() && toolResults.length > 0) {
                responseText = JSON.stringify(toolResults[0].result).slice(0, 500);
              }
              
              if (responseText.trim()) {
                // Stream the formatted response
                addToHistory(convId, 'user', enhancedMessage);
                addToHistory(convId, 'assistant', responseText);
                
                // Send as a single chunk to avoid silent failures
                try { event.sender.send('sadie:stream-chunk', { chunk: responseText, streamId }); } catch (e) {}
                try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                activeStreams.delete(streamId);
                return;
              }
            }
            
            // Otherwise, use LLM with tool calling as usual
            const hasCurrentDocuments = !!(request.documents && request.documents.length > 0);
            const handler = await streamFromLLM(
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
              (missingPermissions: string[], reason: string) => permissionRequester.request(event.sender, streamId, missingPermissions, reason),
              { hasDocuments: hasCurrentDocuments }
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
            // Don't await ΓÇö fire and forget
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
        const e2eEnabled = Boolean(isE2E) || process.env.NODE_ENV === 'test';
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
            try { const s = getSettings(); s.permissions = s.permissions || {}; for (const p of missing) s.permissions[p] = true; saveSettings(s); } catch (e) {}
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
