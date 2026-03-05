import { ipcMain, BrowserWindow, IpcMainEvent } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { permissionRequester } from './permission-requester';
import { looksLikeToolJson, extractToolCallsFromText, extractProseToolCalls } from './tool-helpers';
import axios from 'axios';
import { debug as logDebug, error as logError } from '../shared/logger';
import streamFromSadieProxy from './stream-proxy-client';
import { SadieRequest, SadieResponse, SadieRequestWithImages, ImageAttachment, DocumentAttachment } from '../shared/types';
import { IPC_SEND_MESSAGE, SADIE_WEBHOOK_PATH, DEFAULT_OLLAMA_URL } from '../shared/constants';
import { SADIE_SYSTEM_PROMPT } from '../shared/system-prompt';
import { initializeTools, getOllamaTools, getAllToolDefinitions, executeToolBatch, ToolCall, ToolContext } from './tools';
import { documentToolHandlers } from './tools/documents';
import { isE2E, isPackagedBuild } from './env';
import { getSettings, saveSettings } from './config-manager';
import { logTelemetryEvent } from './utils/logger';
import { streamFromCustomLLM, validateCustomLLMConfig } from './custom-llm-client';
import { setTavilyApiKey, setSerperApiKey, setOpenaiApiKey } from './tools/web';
import { MemoryManager } from './memory-manager';
import { enrichNbaGames, enrichWeather, enrichGenericQuery } from './tools/enrichment';

const E2E = isE2E;
const PACKAGED = isPackagedBuild;

const DEFAULT_TIMEOUT = 30000;

/**
 * Check user settings to decide whether automatic tool execution is enabled.
 * Default is true for backwards compatibility; explicit false disables auto tools.
 */
function autoExecuteToolsEnabled(): boolean {
  try {
    const s: any = getSettings();
    // Support multiple possible flag names for compatibility
    if (s && (s.allowAutoTools === false || s.autoToolExecution === false || s.allowAutomaticToolExecution === false || s.autoExecuteTools === false)) return false;
    return true;
  } catch (e) {
    return true;
  }
}

/**
 * Format a file path as a clickable markdown link for the chat UI
 * Uses file:// protocol which the renderer handles specially
 */
function formatFileLink(filePath: string, displayName?: string): string {
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '/').replace(/%5C/g, '/').replace(/%3A/g, ':');
  const name = displayName || require('path').basename(filePath);
  return `[📄 ${name}](file://${encodedPath})`;
}
const OLLAMA_URL = process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;

// Track if we've already warned about custom LLM config (to avoid spamming)
let customLLMWarningShown = false;

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

  // HELP / CAPABILITY CARD — must be first so "help" doesn't hit other patterns
  if (/^\s*(help|\?|commands|what can you do|what do you do|capabilities|show capabilities|show commands|what tools|show tools|what can sadie do|what are your (skills|abilities|features))\s*[?!.]?\s*$/i.test(userMessage.trim())) {
    return { calls: [{ name: '__help', arguments: {} }] };
  }

  // If the message already contains embedded document content (from attachments),
  // let the LLM summarize it directly — do NOT route to web search or other tools.
  if (m.includes('=== document:') && m.includes('=== end of ')) {
    return null; // LLM already has the document text in context
  }

  // ─── COMPOUND FILE INTENTS ───
  // Check these FIRST so "make a file with NBA games" doesn't just return
  // NBA results without writing a file.
  const wantsFile = /\b(create|make|write|save|put|give\s+me)\b/i.test(m) &&
                    /\b(file|document|note|text)\b/i.test(m);

  if (wantsFile) {
    // COMPOUND: surf/swell + file → use web search, not weather API
    const isSurfFileQuery = /\b(surf|swell|waves?|tide|ocean|marine|break|beach\s*break)\b/i.test(m);
    if (isSurfFileQuery) {
      const locMatch = m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]*?)(?:\s+today|\s+tomorrow|\s+on|\s+and|$)/i) ||
                       m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]+)/i);
      let location = locMatch ? locMatch[1].trim() : '';
      location = location.replace(/\s*(today|tomorrow|tonight|this week|next week|on my|on the|and)$/i, '').trim();
      if (!location) location = 'New Zealand';
      return { calls: [
        { name: '__compound_surf_file', arguments: { location, query: userMessage } }
      ] };
    }

    // COMPOUND: weather + file (no surf keywords)
    if (/\b(weather|forecast|temperature|rain|sunny|cloudy|humidity)\b/i.test(m)) {
      const locMatch = m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]*?)(?:\s+today|\s+tomorrow|\s+on|\s+and|$)/i) ||
                       m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]+)/i);
      let location = locMatch ? locMatch[1].trim() : '';
      location = location.replace(/\s*(today|tomorrow|tonight|this week|next week|on my|on the|and)$/i, '').trim();
      if (!location) location = 'your location';
      return { calls: [
        { name: '__compound_weather_file', arguments: { location, query: userMessage } }
      ] };
    }

    // COMPOUND: NBA/sports + file
    if (/\b(nba|basketball|game(s)?|scores?|schedule|season|remaining|upcoming)\b/i.test(m)) {
      let teamQuery = '';
      const nbaTeamsForFile = ['warriors', 'lakers', 'celtics', 'bulls', 'heat', 'nets', 'knicks', 'suns', 'bucks', 'nuggets',
                       'clippers', 'spurs', 'rockets', 'mavericks', 'thunder', 'jazz', 'kings', 'pelicans', 'grizzlies',
                       'hawks', 'hornets', 'cavaliers', 'pistons', 'pacers', 'magic', 'wizards', 'raptors', 'timberwolves', 'blazers', '76ers', 'sixers'];
      for (const team of nbaTeamsForFile) {
        if (m.includes(team)) { teamQuery = team; break; }
      }
      const dateRange = /last week|this week|last_7_days|last 7 days/i.test(m) ? 'last_7_days' : '';
      const wantsSeason = /\b(season|remaining|upcoming|all)\b/i.test(m);
      return { calls: [
        { name: '__compound_nba_file', arguments: { teamQuery, dateRange, perPage: wantsSeason ? 50 : 10, query: userMessage } }
      ] };
    }

    // COMPOUND: generic topic + file  (e.g. "give me a file with links about X")
    // Extract the topic from the message
    const topicMatch = userMessage.match(/(?:file|document|note|text)\s+(?:with|containing|about|on|of)\s+(.+?)$/i) ||
                       userMessage.match(/(?:with|containing|about)\s+(?:links?\s+(?:to|about|on)\s+)?(.+?)$/i);
    if (topicMatch) {
      const topic = topicMatch[1].replace(/\s+/g, ' ').trim();
      if (topic.length > 3) {
        return { calls: [
          { name: '__compound_search_file', arguments: { topic, query: userMessage } }
        ] };
      }
    }
  }

  // SPORTS / NBA intents - match team names and basketball terms
  const nbaTeams = ['warriors', 'lakers', 'celtics', 'bulls', 'heat', 'nets', 'knicks', 'suns', 'bucks', 'nuggets', 
                   'clippers', 'spurs', 'rockets', 'mavericks', 'thunder', 'jazz', 'kings', 'pelicans', 'grizzlies',
                   'hawks', 'hornets', 'cavaliers', 'pistons', 'pacers', 'magic', 'wizards', 'raptors', 'timberwolves', 'blazers', '76ers', 'sixers'];
  const hasNbaTeam = nbaTeams.some(team => m.includes(team));

  // Helper: return YYYYMMDD string for America/New_York timezone + optional day offset
  const getEtDate = (dayOffset = 0): string => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  };
  
  // STANDINGS: check before the general NBA block to avoid falling through to 'games'
  if (/\b(nba|basketball)\b/i.test(m) && /\bstanding(s)?\b/i.test(m)) {
    return { calls: [{ name: 'nba_query', arguments: { type: 'standings' } }] };
  }

  if (hasNbaTeam || /\b(nba|basketball|game(s)?|scores?|playing|play next|play today|schedule)\b/i.test(m)) {
    let teamQuery = '';
    for (const team of nbaTeams) {
      if (m.includes(team)) { teamQuery = team; break; }
    }
    // Detect when user wants finished game results (not just the schedule)
    const wantsResults = /\b(result[s]?|who won|who win|final[s]?|finished|were[' ]?the scores?|what were.*scores?|scores?.*today|scores?.*last night|scores?.*tonight|any games?.*finish|games?.*finish|tonight'?s? results?|today'?s? results?|did.*play|played.*today|last night|recap)\b/i.test(m);
    let dateRange = '';
    if (/last week|last_7_days|last 7 days/i.test(m)) {
      dateRange = 'last_7_days';
    } else if (/this week/i.test(m)) {
      dateRange = 'last_7_days';
    } else if (/tomorrow/i.test(m)) {
      dateRange = getEtDate(1);
    } else if (/yesterday/i.test(m)) {
      dateRange = getEtDate(-1);
    } else {
      // Use America/New_York date — prevents NZ system date querying wrong US slate
      dateRange = getEtDate(0);
    }
    return { calls: [{ name: 'nba_query', arguments: { type: 'games', date: dateRange, perPage: 10, query: teamQuery, wantsResults } }] };
  }

  // SURF / SWELL intents (standalone) — use web search for real surf data
  if (/\b(surf|swell|waves?|tide|ocean\s*conditions|beach\s*break)\b/i.test(m) && !/\b(weather|temperature|rain|forecast)\b/i.test(m)) {
    const locMatch = m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]*?)(?:\s+tomorrow|\s+today|\s+tonight|\s+this week|\s+give|$)/i) ||
                     m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]+)/i);
    let location = locMatch ? locMatch[1].trim() : '';
    location = location.replace(/\s*(tomorrow|today|tonight|this week|next week|give)$/i, '').trim();
    if (!location) location = 'New Zealand';
    return { calls: [{ name: '__surf_conditions', arguments: { location, query: userMessage } }] };
  }

  // WEATHER intents (standalone, no surf keywords)
  if (/w[eh]a?th?e?r/i.test(m) || /\b(forecast|temperature|rain|sunny|cloudy|humidity)\b/i.test(m)) {
    const locMatch = m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]*?)(?:\s+tomorrow|\s+today|\s+tonight|\s+this week|\s+give|$)/i) ||
                     m.match(/(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]+)/i);
    let location = locMatch ? locMatch[1].trim() : '';
    location = location.replace(/\s*(tomorrow|today|tonight|this week|next week|give)$/i, '').trim();
    if (location) return { calls: [{ name: 'get_weather', arguments: { location } }] };
    return null;
  }

  // DOCUMENT / FILE READING intents
  if (/\b(read|open|summarize|summar|analyse|analyze|parse|what'?s in|show me|review)\b/i.test(m) &&
      (/\b(document|doc|file|pdf|cv|resume|report|letter|paper|essay|cover\s*letter)\b/i.test(m) ||
       /\.(pdf|docx?|txt|md)\b/i.test(m))) {
    let filePath = '';
    const pathPatterns = [
      /([a-zA-Z]:\\[^"'\n]+\.\w+)/i,
      /([a-zA-Z]:\/[^"'\n]+\.\w+)/i,
      /(~\/[^"'\s]+\.\w+)/i,
      /((?:desktop|documents|downloads)\/[^"'\s]+\.\w+)/i,
      /((?:desktop|documents|downloads)\\[^"'\s]+\.\w+)/i,
      /([\w\s.-]+\.(?:pdf|docx?|txt|md))(?:\s|$)/i,
    ];
    for (const pattern of pathPatterns) {
      const match = userMessage.match(pattern);
      if (match) { filePath = match[1].trim(); break; }
    }
    if (filePath) {
      return { calls: [{ name: 'parse_document_from_path', arguments: { path: filePath } }] };
    }
    // No exact filename — list the desktop to find matching files
    return { calls: [{ name: 'list_directory', arguments: { path: 'Desktop' } }] };
  }

  // "what is this document" / "what is this" without attachment markers = LLM handles
  // (attached docs are caught by the document-marker check at top)

  // REMINDER intents
  if (/\bremind\s+me\b/i.test(m) || /\bset\s+a?\s*reminder\b/i.test(m)) {
    const delayMatch = m.match(/\bin\s+(\d+)\s*(second|sec|minute|min|hour|hr)s?\b/i);
    let delay_seconds = 60;
    if (delayMatch) {
      const num = parseInt(delayMatch[1]);
      const unit = delayMatch[2].toLowerCase();
      if (/^s/.test(unit)) delay_seconds = num;
      else if (/^m/.test(unit)) delay_seconds = num * 60;
      else if (/^h/.test(unit)) delay_seconds = num * 3600;
    }
    const msgMatch = userMessage.match(/remind\s+me\s+(?:in\s+[\w\s]+\s+)?to\s+(.+)/i) ||
                     userMessage.match(/(?:reminder|remind\s+me)\s*[:—-]\s*(.+)/i);
    const message = msgMatch ? msgMatch[1].trim() :
      userMessage.replace(/^(set\s+a?\s*reminder|remind\s+me)\s*/i, '').trim() || 'This is your reminder';
    return { calls: [{ name: 'set_reminder', arguments: { message, delay_seconds, label: message.slice(0, 40) } }] };
  }
  if (/\b(show|list|what|see)\s+.{0,15}(my\s+)?reminder/i.test(m)) {
    return { calls: [{ name: 'list_reminders', arguments: {} }] };
  }

  // NOTIFICATION intent
  if (/\b(notify\s+me|send\s+(?:me\s+)?a\s+notification|show\s+a\s+notification|alert\s+me)\b/i.test(m)) {
    const bodyMatch = userMessage.match(/(?:saying|that|:)\s*(.+)/i);
    const body = bodyMatch ? bodyMatch[1].trim() :
      userMessage.replace(/^(notify\s+me|send\s+(me\s+)?a\s+notification|show\s+a?\s+notification|alert\s+me)\s*/i, '').trim() || 'Notification from SADIE';
    return { calls: [{ name: 'show_notification', arguments: { title: 'SADIE', body } }] };
  }

  // NEWS intents
  if (/\b(news|headlines|top\s*stories?|latest\s*news|what'?s\s+happening|what'?s\s+new)\b/i.test(m) &&
      !/\b(document|doc|file|pdf)\b/i.test(m)) {
    const sourceKeywords: [RegExp, string][] = [
      [/\btechcrunch\b/i, 'techcrunch'],
      [/\bhacker\s*news\b/i, 'hacker_news'],
      [/\bars\s*technica\b/i, 'ars_technica'],
      [/\bguardian\b/i, 'guardian'],
      [/\breuters\b/i, 'reuters'],
      [/\bnpr\b/i, 'npr'],
      [/\bespn\b/i, 'espn'],
      [/\bsports?\s+news\b/i, 'espn'],
      [/\btech\s+news\b/i, 'techcrunch'],
    ];
    let source = 'bbc';
    for (const [re, s] of sourceKeywords) { if (re.test(m)) { source = s; break; } }
    const topicMatch = m.match(/\b(?:about|on|covering)\s+(.+?)(?:\s+news|\s+headlines|$)/i);
    const topic_filter = topicMatch ? topicMatch[1].trim() : undefined;
    return { calls: [{ name: 'get_news', arguments: { source, limit: 10, ...(topic_filter ? { topic_filter } : {}) } }] };
  }

  // PROCESS MANAGER intents
  if (/\b(what|which|show|list)\b.{0,20}\bprocesses?\b/i.test(m) ||
      /\bprocesses?\s+(are\s+)?running\b/i.test(m) ||
      /\bwhat'?s\s+(using|taking|consuming)\b.{0,20}\b(memory|ram|cpu)\b/i.test(m) ||
      /\btask\s+manager\b/i.test(m)) {
    const sort_by = /\b(memory|ram)\b/i.test(m) ? 'memory' : 'cpu';
    const filterMatch = m.match(/\b(?:call|name|for|like)\w*\s+(\w+)\b/i);
    return { calls: [{ name: 'list_processes', arguments: { sort_by, limit: 20, ...(filterMatch ? { filter: filterMatch[1] } : {}) } }] };
  }
  if (/\b(kill|stop|end|terminate)\b.{0,20}\b(process|task|program|app)\b/i.test(m)) {
    const nameMatch = m.match(/\b(?:kill|stop|end|terminate)\s+(?:the\s+)?(?:process\s+)?(\w+)/i);
    return { calls: [{ name: 'kill_process', arguments: { name: nameMatch?.[1] || '' } }] };
  }

  // CONTACTS intents
  if (/\b(find|search|look\s*up|get)\b.{0,25}\bcontact/i.test(m) ||
      /\b(contact|email|phone)\s+(for|of)\s+\w/i.test(m)) {
    const qMatch = userMessage.match(/(?:find|search|look\s*up)\s+(?:contact\s+)?(.+?)(?:\s+in\s+contacts|\s*$)/i) ||
                   userMessage.match(/(?:contact|email|phone)\s+(?:for|of)\s+(.+)/i);
    return { calls: [{ name: 'search_contacts', arguments: { query: qMatch?.[1]?.trim() || userMessage } }] };
  }
  if (/\b(add|save|create)\s+(?:a?\s*(?:new\s+)?)?contact\b/i.test(m)) {
    const nameMatch = userMessage.match(/contact\s+(?:for\s+)?(.+?)(?:\s+with\s+|\s+email\s+|\s+phone\s+|$)/i);
    const emailMatch = userMessage.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
    const phoneMatch = userMessage.match(/\b(\+?[\d][\d\s\-().]{6,})\b/);
    return { calls: [{ name: 'add_contact', arguments: {
      name: nameMatch?.[1]?.trim() || '',
      ...(emailMatch ? { email: emailMatch[1] } : {}),
      ...(phoneMatch ? { phone: phoneMatch[1].trim() } : {})
    } }] };
  }

  // GIT intents
  if (/\bgit\s+status\b/i.test(m) || /\b(what'?s\s+changed|working\s+tree|staged\s+files?)\b/i.test(m)) {
    return { calls: [{ name: 'git_status', arguments: {} }] };
  }
  if (/\bgit\s+log\b/i.test(m) || /\b(show|recent|last)\s+commits?\b/i.test(m) || /\bcommit\s+history\b/i.test(m)) {
    const limitMatch = m.match(/last\s+(\d+)\s+commits?/i);
    return { calls: [{ name: 'git_log', arguments: { limit: limitMatch ? parseInt(limitMatch[1]) : 10 } }] };
  }
  if (/\bgit\s+diff\b/i.test(m)) {
    return { calls: [{ name: 'git_diff', arguments: { target: /\bstaged\b/i.test(m) ? 'staged' : 'unstaged' } }] };
  }

  // RUN CODE intent (when code is provided inline)
  if (/\b(run|execute)\s+(?:this\s+)?(?:python|powershell)\b/i.test(m) ||
      (/\b(run|execute)\s+(?:this\s+)?(?:code|script)\b/i.test(m) && /```/.test(userMessage))) {
    const langMatch = m.match(/\b(python|powershell)\b/i);
    const lang = (langMatch?.[1]?.toLowerCase() === 'powershell') ? 'powershell' : 'python';
    const codeBlock = userMessage.match(/```(?:\w+)?\n?([\s\S]+?)```/);
    const codeAfterColon = userMessage.match(/(?:python|powershell|code|script)\s*:\s*(.+)/is);
    const code = (codeBlock?.[1] || codeAfterColon?.[1] || '').trim();
    if (code) return { calls: [{ name: 'run_code', arguments: { language: lang, code } }] };
  }

  // IMAGE GENERATION intents
  if (/\b(draw|generate|create|make|paint|sketch|render|design)\b.{0,30}\b(image|picture|photo|illustration|art|portrait|wallpaper|logo|icon|scene)\b/i.test(m) ||
      /\b(image|picture|photo|illustration)\b.{0,20}\b(of|showing|with|featuring)\b/i.test(m)) {
    const prompt = userMessage
      .replace(/^(draw|generate|create|make|paint|sketch|render|design)\s*(me\s*)?(an?\s*|a\s+)?/i, '')
      .trim();
    return { calls: [{ name: 'image_generate', arguments: { prompt, width: 512, height: 512, steps: 20 } }] };
  }

  // WEB SEARCH intents — be careful not to match "what is this document" etc.
  if (/\b(search for|look up|tell me about|google)\b/i.test(m)) {
    const q = userMessage.trim();
    return { calls: [{ name: 'web_search', arguments: { query: q, maxResults: 5, fetchTopResult: true } }] };
  }
  // "who is X" / "what is X" — only match if no document/file words nearby
  if (/\b(who is|what is|find)\b/i.test(m) &&
      !/\b(this|document|doc|file|pdf|cv|resume|report|letter)\b/i.test(m)) {
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
      // Respect user setting to disable automatic tool execution
      if (!autoExecuteToolsEnabled()) {
        console.log('[ROUTER] Automatic tool execution disabled by settings; routing to LLM');
        return { type: 'llm' };
      }
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
      // Document parsing results
      if (r.result.preview || r.result.word_count) {
        let docSummary = `📄 **${r.result.filename || 'Document'}**`;
        if (r.result.page_count) docSummary += ` (${r.result.page_count} pages, ${r.result.word_count} words)`;
        else if (r.result.word_count) docSummary += ` (${r.result.word_count} words)`;
        docSummary += '\n\n' + (r.result.content || r.result.preview || '');
        parts.push(docSummary);
      }
      // Directory listing results
      else if (r.result.entries && Array.isArray(r.result.entries)) {
        let listing = `📂 Contents of ${r.result.path}:\n`;
        for (const entry of r.result.entries.slice(0, 30)) {
          const icon = entry.type === 'directory' ? '📁' : '📄';
          const size = entry.size != null ? ` (${(entry.size / 1024).toFixed(1)} KB)` : '';
          listing += `${icon} ${entry.name}${size}\n`;
        }
        parts.push(listing);
      }
      // File write results (write_file tool)
      else if (r.result.path && r.result.message && (r.result.message.includes('written') || r.result.message.includes('appended'))) {
        const fileLink = formatFileLink(r.result.path);
        const sizeKb = r.result.size ? ` (${(r.result.size / 1024).toFixed(1)} KB)` : '';
        parts.push(`✅ ${r.result.message}${sizeKb}\n\n${fileLink}`);
      }
      // Try to stringify concise keys
      else if (r.result.summary) parts.push(r.result.summary);
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
      const targetUrl = `${n8nUrl}${SADIE_WEBHOOK_PATH}`;
      try {
        try { pushRouter(`POSTing to n8n webhook = ${targetUrl}`); } catch (e) {}
        const response = await axios.post(targetUrl, request, {
          timeout: DEFAULT_TIMEOUT,
          headers: { 'Content-Type': 'application/json' }
        });
        try { pushRouter(`n8n webhook POST succeeded, status=${response?.status}`); } catch (e) {}
        return { success: true, data: response.data };
      } catch (err: any) {
        try { pushRouter(`n8n webhook POST failed: ${String(err?.message || err)}`); } catch (e) {}
        throw err;
      }
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
  
  // Build system prompt with user's chat guidelines if set
  const userGuidelines = (settings as any).chatGuidelines?.trim();
  const systemPromptWithGuidelines = userGuidelines 
    ? `${SADIE_SYSTEM_PROMPT}\n\n## User Guidelines\n${userGuidelines}`
    : SADIE_SYSTEM_PROMPT;

  // Check if custom LLM is enabled and configured
  if ((settings as any).useCustomLLM && (settings as any).customLLM) {
    const validation = validateCustomLLMConfig((settings as any).customLLM);
    if (validation.valid) {
      console.log(`[SADIE] Using custom LLM: ${(settings as any).customLLM.name} (${(settings as any).customLLM.provider})`);
      
      // Fall back to Ollama for image attachments (custom APIs don't support vision yet)
      if (images && images.length > 0) {
        onChunk('\n\n⚠️ Image attachments are not yet supported with cloud APIs. Using Ollama vision model instead.\n\n');
        return streamFromOllamaWithTools(message, images, conversationId, onChunk, onToolCall, onToolResult, onEnd, onError, requestConfirmation, requestPermission, options);
      }
      
      const controller = new AbortController();
      const history = getHistory(conversationId);
      const customConfig = (settings as any).customLLM as import('../shared/types').CustomLLMConfig;
      
      // Get tool definitions for providers that support function calling
      const providerSupportsTools = customConfig.provider === 'openai' || customConfig.provider === 'openrouter' || customConfig.provider === 'custom';
      const toolDefs = providerSupportsTools ? getAllToolDefinitions() : undefined;
      
      // Track whether a tool call was received (to know if onEnd should be deferred)
      let toolCallReceived = false;
      
      // Handle tool call round-trip: execute tool, then feed result back to LLM
      const handleToolCall = async (tc: { name: string; arguments: any; id?: string }) => {
        toolCallReceived = true;
        console.log(`[SADIE] Custom LLM tool call: ${tc.name}`, tc.arguments);
        onToolCall(tc.name, tc.arguments);
        
        try {
          const results = await executeToolBatch(
            [{ name: tc.name, arguments: tc.arguments }] as ToolCall[],
            {
              executionId: `custom-llm-tool-${Date.now()}`,
              requestConfirmation,
              requestPermission: requestPermission as any
            } as ToolContext
          );
          
          const toolResult = results?.[0]?.result ?? results?.[0]?.error ?? 'No result';
          onToolResult(toolResult);
          console.log('[SADIE] Custom LLM tool result, sending follow-up...');
          
          // Send the tool result back to the LLM for a follow-up response
          const updatedHistory = [
            ...history.map(m => ({ role: m.role as any, content: m.content })),
            { role: 'user' as const, content: message },
            { role: 'assistant' as const, content: '', tool_calls: [{
              id: tc.id || `call_${Date.now()}`,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
            }] },
            { role: 'tool' as const, content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult), tool_call_id: tc.id || `call_${Date.now()}` }
          ];
          
          // Stream the follow-up (no tools this time to avoid infinite loops)
          await streamFromCustomLLM(
            '', // empty — context is in the history
            updatedHistory,
            customConfig,
            systemPromptWithGuidelines,
            onChunk,
            onEnd,
            onError,
            controller.signal
          );
        } catch (err: any) {
          console.error('[SADIE] Custom LLM tool execution failed:', err.message);
          onChunk(`\n⚠️ Tool execution failed: ${err.message}`);
          onEnd();
        }
      };
      
      // Wrap onEnd: if a tool call was received, the tool handler manages onEnd after the follow-up.
      // If no tool call happened (plain text response), fire onEnd normally.
      const wrappedOnEnd = () => {
        if (!toolCallReceived) {
          onEnd();
        }
        // else: handleToolCall will call onEnd after the follow-up stream completes
      };
      
      streamFromCustomLLM(
        message,
        history.map(m => ({ role: m.role as any, content: m.content })),
        customConfig,
        systemPromptWithGuidelines,
        onChunk,
        wrappedOnEnd,
        onError,
        controller.signal,
        toolDefs,
        providerSupportsTools ? handleToolCall : undefined
      );
      
      return {
        cancel: () => controller.abort()
      };
    } else {
      // Silently fall back to Ollama if custom LLM isn't fully configured
      // Only log once per session to avoid spamming
      if (!customLLMWarningShown) {
        console.log(`[SADIE] Custom LLM not ready: ${validation.error}. Using Ollama.`);
        customLLMWarningShown = true;
      }
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
  const settings = getSettings();
  const preferredChatModel = settings.chatModel || OLLAMA_CHAT_MODEL;
  const preferredUncensoredModel = settings.uncensoredModel || OLLAMA_UNCENSORED_MODEL;
  const preferredVisionModel = settings.visionModel || OLLAMA_VISION_MODEL;

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
  const chatModel = uncensoredModeEnabled ? preferredUncensoredModel : preferredChatModel;
  const model = hasImages ? preferredVisionModel : chatModel;
  
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

  // If this conversation has a custom system prompt, prepend it to the default
  const storedConv = MemoryManager.getConversation(conversationId);
  const convPrompt = storedConv?.systemPrompt?.toString().trim();

  const messages: ChatMessage[] = [];
  // In uncensored mode skip ALL system prompts so the model runs completely unfiltered
  if (!uncensoredModeEnabled) {
    if (convPrompt) {
      messages.push({ role: 'system', content: convPrompt });
    }
    // Always include the global SADIE prompt after the conversation prompt
    // Append user's chat guidelines if set
    const chatGuidelines = settings.chatGuidelines?.trim();
    const systemPromptWithGuidelines = chatGuidelines
      ? `${SADIE_SYSTEM_PROMPT}\n\n## User Guidelines\n${chatGuidelines}`
      : SADIE_SYSTEM_PROMPT;
    messages.push({ role: 'system', content: systemPromptWithGuidelines });
  }

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
  const modelSupportsTools = !hasImages && model !== preferredUncensoredModel;
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
      // Buffer chunks so we can detect tool JSON before sending to the UI.
      // Flush progressively after a short delay; if tool JSON is detected
      // on stream end we replace the content.
      const chunkBuffer: string[] = [];
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let flushedLength = 0; // how many chars of assistantContent we already sent

      function scheduleFlush(): void {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          // Only flush if we have unflushed content and no tool_calls detected yet
          if (flushedLength < assistantContent.length && pendingToolCalls.length === 0) {
            const unflushed = assistantContent.slice(flushedLength);
            // Quick check: if accumulated content is starting to look like tool JSON, hold off
            if (looksLikeToolJson(assistantContent)) return;
            onChunk(unflushed);
            flushedLength = assistantContent.length;
          }
        }, 120); // Small delay to batch-check content
      }
      
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
                chunkBuffer.push(parsed.message.content);
                scheduleFlush();
              }
              
              // Handle tool calls
              if (parsed.message?.tool_calls) {
                pendingToolCalls = parsed.message.tool_calls;
              }
              
              if (parsed.done) {
                if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
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
        // Try extracting tool calls from mixed text (models like mistral
        // often embed tool JSON inside descriptive prose)
        const extracted = extractToolCallsFromText(assistantContent);
        if (extracted && extracted.length > 0) {
          pendingToolCalls = extracted;
          assistantContent = "I'm working on that now...";
          pushRouter('Detected inline tool JSON in prose; routing to tool executor');
        } else {
          // Fall back to simple JSON parse for pure JSON output
          try {
            const parsed = JSON.parse(assistantContent.trim());
            if (parsed && (parsed.name || parsed.function)) {
              pendingToolCalls = [parsed];
              assistantContent = "I'm fetching that now...";
              pushRouter('Detected inline tool JSON; routing to tool executor');
            }
          } catch (e) {}
        }
      }

      // Final fallback: detect prose-style tool descriptions like
      // "write_file path='...' content='...'" that models sometimes output
      // instead of using the proper tool_call mechanism.
      if (pendingToolCalls.length === 0) {
        const proseCalls = extractProseToolCalls(assistantContent);
        if (proseCalls && proseCalls.length > 0) {
          pendingToolCalls = proseCalls;
          assistantContent = "I'm working on that now...";
          pushRouter(`Detected ${proseCalls.length} prose-style tool call(s); routing to tool executor`);
        }
      }

      // Flush any remaining buffered content that wasn't sent during streaming.
      // If tool JSON was detected, send the replacement message instead.
      if (pendingToolCalls.length > 0 && flushedLength > 0) {
        // We already sent some raw JSON to the UI — send a replacement signal
        onChunk('\n___REPLACE___' + assistantContent);
      } else if (pendingToolCalls.length > 0) {
        // Never flushed, good — send the clean replacement message
        onChunk(assistantContent);
      } else if (flushedLength < assistantContent.length) {
        // Normal text, flush remainder
        onChunk(assistantContent.slice(flushedLength));
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
          // Format structured results so the LLM gets human-readable context
          // instead of raw JSON which it often regurgitates verbatim
          let toolContent = JSON.stringify(result);
          const r = result?.result;
          if (r && r.temperature && r.condition) {
            // Weather result — format nicely for the LLM
            toolContent = `Weather for ${r.location || 'the location'}:\n`;
            toolContent += `Temperature: ${r.temperature.celsius || ''}`;
            if (r.temperature.feelsLike) toolContent += ` (feels like ${r.temperature.feelsLike})`;
            toolContent += `\nCondition: ${r.condition}`;
            if (r.wind) toolContent += `\nWind: ${r.wind.speed || ''} ${r.wind.direction || ''}`;
            if (r.humidity) toolContent += `\nHumidity: ${r.humidity}`;
            if (r.visibility) toolContent += `\nVisibility: ${r.visibility}`;
            if (r.uvIndex) toolContent += `\nUV Index: ${r.uvIndex}`;
            if (r.precipitation) toolContent += `\nPrecipitation: ${r.precipitation}`;
          }
          messages.push({ role: 'tool', content: toolContent });
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

    // Load search API keys from persisted settings
    try {
      const settings = getSettings();
      if (settings.tavilyApiKey) {
        setTavilyApiKey(settings.tavilyApiKey);
        console.log('[SADIE] Tavily API key loaded from settings');
      }
      if (settings.serperApiKey) {
        setSerperApiKey(settings.serperApiKey);
        console.log('[SADIE] Serper API key loaded from settings');
      }
      if (settings.openaiApiKey) {
        setOpenaiApiKey(settings.openaiApiKey);
        console.log('[SADIE] OpenAI API key loaded from settings');
      }
    } catch (e) {
      console.log('[SADIE] Could not load search API keys from settings');
    }

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
      console.log('[DIAG] Received sadie:stream-message', { request, env: { SADIE_DIRECT_OLLAMA: process.env.SADIE_DIRECT_OLLAMA, isE2E, NODE_ENV: process.env.NODE_ENV } });
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
      const useDirectOllama = isE2E;
      if (process.env.NODE_ENV !== 'production') {
        console.log('[DIAG] useDirectOllama calculation:', { isE2E, SADIE_DIRECT_OLLAMA: process.env.SADIE_DIRECT_OLLAMA, useDirectOllama });
        try { pushRouter(`useDirectOllama=${useDirectOllama} isE2E=${isE2E} env=${process.env.SADIE_DIRECT_OLLAMA}`); } catch (e) {}
      }

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
                try { event.sender.send('sadie:stream-error', { error: true, message: 'Upstream error (n8n unavailable)', details: `probe:${probe.status}`, streamId, diagnostic: { url: streamUrl, httpStatus: probe.status, n8nResponded: true } }); } catch (e) {}
                try { logTelemetryEvent('stream_failure', { streamId, reason: 'n8n_probe_error', httpStatus: probe.status, url: streamUrl }); } catch (e) {}
                try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                try { activeStreams.delete(streamId); } catch (e) {}
                return;
              }
            } catch (e: any) {
              try { console.log('[E2E-TRACE] stream POST target probe failed', { streamId, error: e?.message || e }); } catch (e) {}
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Upstream error (n8n unavailable)', details: e?.message || String(e), streamId, diagnostic: { url: streamUrl, errorText: e?.message || String(e), n8nResponded: false } }); } catch (e) {}
              try { logTelemetryEvent('stream_failure', { streamId, reason: 'n8n_probe_failed', error: e?.message || String(e), url: streamUrl }); } catch (e) {}
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
        
        // ─── SMART ROUTING (applies to ALL modes: direct Ollama, proxy, n8n) ───
        // Run intent detection BEFORE streaming so deterministic tool execution
        // takes priority over unreliable LLM tool-calling.
        {
          const intentResult = await preProcessIntent(enhancedMessage);
          console.log('[SADIE] preProcessIntent called with:', enhancedMessage.substring(0, 60));
          console.log('[SADIE] Intent result:', intentResult ? JSON.stringify(intentResult).substring(0, 200) : 'null');

          if (intentResult && intentResult.calls && intentResult.calls.length > 0) {
            if (!autoExecuteToolsEnabled()) {
              console.log('[SADIE] Intent detected but automatic tool execution is disabled; proceeding with LLM path');
            } else {
              console.log('[SADIE] Intent detected, executing tools directly:', intentResult.calls.map((c: any) => c.name));
              
              // Ensure stream is tracked
              if (!activeStreams.has(streamId)) {
                activeStreams.set(streamId, { destroy: () => {} });
              }

              let toolResults: any[] | null = null;

            // COMPOUND INTENT: weather → write_file chain
            const isCompound = intentResult.calls[0]?.name === '__compound_weather_file';
            if (isCompound) {
              const { location } = intentResult.calls[0].arguments;
              console.log('[SADIE] Compound intent (enriched): get weather for', location, 'then write file');

              // Step 1: Get structured weather from API
              const weatherResults = await executeToolBatch(
                [{ name: 'get_weather', arguments: { location } }] as ToolCall[],
                { executionId: `compound-weather-${Date.now()}`, requestConfirmation,
                  requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason) } as ToolContext
              );
              const wr = weatherResults?.[0]?.result;

              // Build clean text summary from structured API data
              let weatherSummary = `🌤️ **Weather for ${location}**\n\n`;
              if (wr?.temperature) {
                weatherSummary += `**Temperature:** ${wr.temperature.celsius || wr.temperature.fahrenheit || ''}${wr.temperature.feelsLike ? ` (feels like ${wr.temperature.feelsLike})` : ''}\n`;
              }
              if (wr?.condition) weatherSummary += `**Condition:** ${wr.condition}\n`;
              if (wr?.wind) weatherSummary += `**Wind:** ${wr.wind.speed || ''} ${wr.wind.direction || ''}\n`;
              if (wr?.humidity) weatherSummary += `**Humidity:** ${wr.humidity}\n`;
              if (wr?.uvIndex) weatherSummary += `**UV Index:** ${wr.uvIndex}\n`;
              if (wr?.precipitation) weatherSummary += `**Precipitation:** ${wr.precipitation}\n`;
              if (wr?.visibility) weatherSummary += `**Visibility:** ${wr.visibility}\n`;
              if (wr?.text) weatherSummary += `\n${wr.text}\n`;

              // Step 2: Write file to Desktop
              const fileLabel = 'weather';
              const fileName = `${fileLabel}_${location.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
              const now = new Date().toLocaleString();
              const fileContent = `Weather Report for ${location}\nGenerated: ${now}\n\n${weatherSummary.replace(/\*\*/g, '').replace(/🌤️|📊/g, '')}`;
              const HOME = process.env.HOME || process.env.USERPROFILE || '';
              const desktopPath = require('path').join(HOME, 'Desktop', fileName);
              let writeSuccess = false;
              let writeError = '';
              try {
                require('fs').writeFileSync(desktopPath, fileContent, 'utf-8');
                writeSuccess = true;
                console.log('[SADIE] Compound: file written to', desktopPath);
              } catch (writeErr: any) {
                writeError = writeErr.message || String(writeErr);
                console.error('[SADIE] Compound: file write FAILED:', writeError);
              }

              if (writeSuccess) {
                const fileLink = formatFileLink(desktopPath, fileName);
                toolResults = [{ result: { summary: `${weatherSummary}\n✅ Saved to ${fileLink}` } }];
              } else {
                toolResults = [{ result: { summary: `${weatherSummary}\n❌ Could not save file: ${writeError}` } }];
              }
            }
            // COMPOUND INTENT: NBA → write_file chain (with web enrichment)
            else if (intentResult.calls[0]?.name === '__compound_nba_file') {
              const { teamQuery, dateRange, perPage } = intentResult.calls[0].arguments;
              console.log('[SADIE] Compound NBA+file intent (enriched):', { teamQuery, dateRange, perPage });

              const nbaResults = await executeToolBatch(
                [{ name: 'nba_query', arguments: { type: 'games', date: dateRange, perPage: perPage || 50, query: teamQuery } }] as ToolCall[],
                { executionId: `compound-nba-${Date.now()}`, requestConfirmation,
                  requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason) } as ToolContext
              );

              // Use enrichment for detailed results with web context
              const events = nbaResults?.[0]?.result?.events || [];
              const enriched = await enrichNbaGames(events, teamQuery || '', {
                maxWebResults: 3,
                fetchContent: true
              });

              // Build file content from enriched summary
              const nbaContent = `NBA Games Report\nGenerated: ${new Date().toLocaleString()}\n\n${enriched.summary.replace(/\*\*/g, '').replace(/📰|🏀|🏆|📍|🏟️/g, '')}`;

              // Write to file
              const HOME = process.env.HOME || process.env.USERPROFILE || '';
              const teamSuffix = teamQuery ? `_${teamQuery}` : '';
              const nbaFileName = `nba_games${teamSuffix}.txt`;
              const nbaDesktopPath = require('path').join(HOME, 'Desktop', nbaFileName);
              let nbaWriteOk = false;
              try {
                require('fs').writeFileSync(nbaDesktopPath, nbaContent, 'utf-8');
                nbaWriteOk = true;
                console.log('[SADIE] Compound NBA: file written to', nbaDesktopPath);
              } catch (e: any) {
                console.error('[SADIE] Compound NBA: file write FAILED:', e.message);
              }

              const gameCount = events?.length || 0;
              if (nbaWriteOk) {
                const fileLink = formatFileLink(nbaDesktopPath, nbaFileName);
                toolResults = [{ result: { summary: `${enriched.summary}\n\n✅ Saved ${gameCount} games to ${fileLink}` } }];
              } else {
                toolResults = [{ result: { summary: `${enriched.summary}\n\n❌ Could not save file.` } }];
              }
            }
            // COMPOUND INTENT: web_search → write_file chain
            else if (intentResult.calls[0]?.name === '__compound_search_file') {
              const { topic } = intentResult.calls[0].arguments;
              console.log('[SADIE] Compound search+file intent (enriched):', topic);

              // Use enrichment for comprehensive results
              const enriched = await enrichGenericQuery(topic, null, {
                maxWebResults: 5,
                fetchContent: true
              });

              // Build file content
              const searchContent = `${topic}\nGenerated: ${new Date().toLocaleString()}\n\n${enriched.summary.replace(/\*\*/g, '').replace(/📄|🔗/g, '')}`;

              // Write to file
              const HOME = process.env.HOME || process.env.USERPROFILE || '';
              const safeFileName = topic.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 40) + '.txt';
              const searchFilePath = require('path').join(HOME, 'Desktop', safeFileName);
              let searchWriteOk = false;
              try {
                require('fs').writeFileSync(searchFilePath, searchContent, 'utf-8');
                searchWriteOk = true;
                console.log('[SADIE] Compound search: file written to', searchFilePath);
              } catch (e: any) {
                console.error('[SADIE] Compound search: file write FAILED:', e.message);
              }

              if (searchWriteOk) {
                const fileLink = formatFileLink(searchFilePath, safeFileName);
                toolResults = [{ result: { summary: `${enriched.summary}\n\n✅ Saved to ${fileLink}` } }];
              } else {
                toolResults = [{ result: { summary: `${enriched.summary}\n\n❌ Could not save file.` } }];
              }
            }
            // STANDALONE SURF INTENT: enriched surf conditions
            else if (intentResult.calls[0]?.name === '__surf_conditions') {
              const { location } = intentResult.calls[0].arguments;
              console.log('[SADIE] Surf conditions intent (enriched):', location);

              // Fetch web search results for surf data
              const surfSearchResult = await executeToolBatch(
                [{ name: 'web_search', arguments: { query: `${location} surf report wave height swell period conditions today`, maxResults: 4, fetchTopResult: true } }] as ToolCall[],
                { executionId: `surf-${Date.now()}`, requestConfirmation,
                  requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason) } as ToolContext
              );

              // Route through LLM synthesis (same as web search path)
              const sr = surfSearchResult?.[0]?.result;
              if (sr) {
                const contextParts: string[] = [];
                if (sr.aiAnswer) contextParts.push(`Summary: ${sr.aiAnswer}`);
                if (sr.topResultContent?.content || sr.topResultContent?.contentText) {
                  const raw = (sr.topResultContent.content || sr.topResultContent.contentText || '').replace(/\s+/g, ' ').trim();
                  const cleaned = raw.split(/\n/).filter((l: string) => !/(\[&>|]:h-|]:w-|class=|style=)/.test(l)).join(' ').trim();
                  contextParts.push(takeSentences(cleaned, 1500, 10));
                  if (sr.topResultContent.url) contextParts.push(`Source: ${sr.topResultContent.url}`);
                }
                if (Array.isArray(sr.results) && sr.results.length > 0) {
                  contextParts.push(sr.results.slice(0, 4).map((r: any, i: number) =>
                    `${i + 1}. ${r.title}: ${r.snippet}${r.url ? ` (${r.url})` : ''}`
                  ).join('\n'));
                }
                const searchContext = contextParts.filter(Boolean).join('\n\n');
                const augmentedMessage = `[SEARCH RESULTS]\n${searchContext}\n[/SEARCH RESULTS]\n\nUsing the search results above, give a clear surf report for ${location} today. Include wave height, swell period/direction, wind, and any relevant conditions. Be concise.`;

                const handler = await streamFromLLM(
                  augmentedMessage, undefined, convId,
                  (chunk) => { if (!activeStreams.has(streamId)) return; assistantResponse += chunk; try { event.sender.send('sadie:stream-chunk', { chunk, streamId }); } catch (e) {} },
                  () => {}, () => {},
                  () => { if (assistantResponse.trim()) addToHistory(convId, 'assistant', assistantResponse); try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {} activeStreams.delete(streamId); },
                  (err) => { try { event.sender.send('sadie:stream-error', { error: true, message: 'Surf LLM error', details: err?.message || err, streamId }); } catch (e) {} activeStreams.delete(streamId); },
                  requestConfirmation,
                  (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason)
                );
                activeStreams.set(streamId, { destroy: handler.cancel });
                return;
              }

              // Fallback if search returned nothing
              toolResults = [{ result: { summary: `🏄 No surf data found for ${location}. Try checking a surf forecast site like Surf-Forecast.com or Swellwatch.` } }];
            }
            // COMPOUND SURF + FILE INTENT
            else if (intentResult.calls[0]?.name === '__compound_surf_file') {
              const { location } = intentResult.calls[0].arguments;
              console.log('[SADIE] Compound surf+file intent (enriched):', location);

              // Fetch surf data via web search
              const surfResults = await executeToolBatch(
                [{ name: 'web_search', arguments: { query: `${location} surf report wave height swell period conditions today`, maxResults: 4, fetchTopResult: true } }] as ToolCall[],
                { executionId: `surf-file-${Date.now()}`, requestConfirmation,
                  requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason) } as ToolContext
              );
              const sr = surfResults?.[0]?.result;

              // Build snippet list for file
              let surfSummary = `🏄 Surf Conditions — ${location}\n`;
              if (sr?.aiAnswer) surfSummary += `\n${sr.aiAnswer}\n`;
              else if (Array.isArray(sr?.results) && sr.results.length > 0) {
                sr.results.slice(0, 5).forEach((r: any) => { surfSummary += `\n• ${r.title}\n  ${r.snippet || ''}\n  ${r.url || ''}`; });
              }

              const surfFileName = `surf_conditions_${location.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
              const surfContent = `Surf Conditions for ${location}\nGenerated: ${new Date().toLocaleString()}\n\n${surfSummary}`;
              const HOME = process.env.HOME || process.env.USERPROFILE || '';
              const surfFilePath = require('path').join(HOME, 'Desktop', surfFileName);
              let surfWriteOk = false;
              try {
                require('fs').writeFileSync(surfFilePath, surfContent, 'utf-8');
                surfWriteOk = true;
                console.log('[SADIE] Compound surf: file written to', surfFilePath);
              } catch (e: any) {
                console.error('[SADIE] Compound surf: file write FAILED:', e.message);
              }

              const fileLink = formatFileLink(surfFilePath, surfFileName);
              toolResults = [{ result: { summary: `${surfSummary}\n\n${surfWriteOk ? `✅ Saved to ${fileLink}` : '❌ Could not save file.'}` } }];
            } else {
              // Normal single-step intent
              toolResults = await executeToolBatch(intentResult.calls as ToolCall[], {
                executionId: `intent-${Date.now()}`,
                requestConfirmation,
                requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason)
              } as ToolContext);
            }
            
            // ── WEB SEARCH: feed results to LLM for synthesis instead of dumping raw text ──
            const webSearchResult = (toolResults || []).find(
              (r: any) => r?.result && (r.result.results || r.result.topResultContent || r.result.aiAnswer)
            );
            if (webSearchResult) {
              // Build a concise context block from the search result
              const sr = webSearchResult.result;
              const contextParts: string[] = [];

              if (sr.aiAnswer) {
                contextParts.push(`AI Summary: ${sr.aiAnswer}`);
              }
              if (sr.topResultContent?.content || sr.topResultContent?.contentText) {
                const raw = (sr.topResultContent.content || sr.topResultContent.contentText || '').replace(/\s+/g, ' ').trim();
                // Strip obvious CSS/HTML noise: skip lines that look like class attribute soup
                const cleaned = raw.split(/\n/).filter((l: string) => !/(\[&>|]:h-|]:w-|]:mb-|]:rounded|]:overflow|]:max-h-)/.test(l)).join(' ').trim();
                contextParts.push(takeSentences(cleaned, 1200, 8));
                if (sr.topResultContent.url) contextParts.push(`Source: ${sr.topResultContent.url}`);
              }
              if (Array.isArray(sr.results) && sr.results.length > 0) {
                const snippets = sr.results.slice(0, 5).map((r: any, i: number) =>
                  `${i + 1}. ${r.title || ''}: ${r.snippet || ''}${r.url ? ` (${r.url})` : ''}`
                ).join('\n');
                contextParts.push(`Search results:\n${snippets}`);
              }

              const searchContext = contextParts.filter(Boolean).join('\n\n');
              const augmentedMessage = `[SEARCH RESULTS]\n${searchContext}\n[/SEARCH RESULTS]\n\nUsing only the search results above, answer this question concisely and directly — do not list snippets, give a real answer: ${enhancedMessage}`;

              // Stream the LLM synthesis
              const handler = await streamFromLLM(
                augmentedMessage,
                undefined,
                convId,
                (chunk) => {
                  if (!activeStreams.has(streamId)) return;
                  assistantResponse += chunk;
                  try { event.sender.send('sadie:stream-chunk', { chunk, streamId }); } catch (e) {}
                },
                () => {}, // onToolCall — not expected in synthesis pass
                () => {}, // onToolResult — not expected
                () => {
                  if (assistantResponse.trim()) addToHistory(convId, 'assistant', assistantResponse);
                  try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                  activeStreams.delete(streamId);
                },
                (err) => {
                  try { event.sender.send('sadie:stream-error', { error: true, message: 'LLM synthesis error', details: err?.message || err, streamId }); } catch (e) {}
                  activeStreams.delete(streamId);
                },
                requestConfirmation,
                (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason)
              );
              activeStreams.set(streamId, { destroy: handler.cancel });
              return;
            }
            // ── END WEB SEARCH SYNTHESIS ──

            // ── HELP / CAPABILITY CARD ──
            if (intentResult.calls[0]?.name === '__help') {
              const helpCard = [
                '# ✨ What can SADIE do?',
                '',
                '## 🌐 Web & Search',
                '- **Search the web** — _"search for…"_ / _"look up…"_',
                '- **Weather** — _"what\'s the weather in Auckland?"_',
                '- **Surf conditions** — _"what\'s the surf in Tauranga?"_',
                '- **News** — _"show me tech news"_ / _"what\'s happening today?"_',
                '',
                '## 🏀 Sports',
                '- **NBA games & scores** — _"what games are on today?"_ / _"NBA results"_',
                '- **Team schedule** — _"when do the Warriors play next?"_',
                '',
                '## 📁 Files & Documents',
                '- **Read files** — _"read my resume"_ / _"summarise this PDF"_',
                '- **Create files** — _"make a note about…"_ / _"save this to a file"_',
                '- **List files** — _"what\'s on my Desktop?"_',
                '',
                '## 💻 Code & System',
                '- **Run code** — _"run this Python: print(1+1)"_ / _"calculate 2^32 in Python"_',
                '- **Processes** — _"what processes are running?"_ / _"kill process chrome"_',
                '- **Git** — _"git status"_ / _"show recent commits"_ / _"git diff"_',
                '',
                '## 🧠 Memory & Contacts',
                '- **Remember things** — _"remember that…"_ / _"what do you know about…?"_',
                '- **Contacts** — _"find contact John"_ / _"add contact…"_',
                '',
                '## ⏰ Reminders & Notifications',
                '- **Set reminders** — _"remind me in 10 minutes to…"_',
                '- **List reminders** — _"what are my reminders?"_',
                '- **Notifications** — _"notify me that…"_',
                '',
                '## 🖼️ Images',
                '- **Generate images** — _"draw me a cat"_ / _"generate an image of…"_',
                '- **Attach images** — use the 📷 button in the input box',
                '',
                '## 📋 Tips',
                '- Use `🔧` in the header to browse all available tools',
                '- Use `💾` to export this conversation as Markdown',
                '- Use `🎤` in the input box for voice input',
                '- Shift+Enter for a new line in the input box',
              ].join('\n');
              try { event.sender.send('sadie:stream-chunk', { chunk: helpCard, streamId }); } catch (e) {}
              addToHistory(convId, 'assistant', helpCard);
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              activeStreams.delete(streamId);
              return;
            }
            // ── END HELP CARD ──

            // ── IMAGE GENERATION: send base64 to renderer as special chunk ──
            const isImageIntent = intentResult.calls[0]?.name === 'image_generate';
            if (isImageIntent) {
              const imageResult = (toolResults || []).find(
                (r: any) => r?.result?.image_base64
              );
              if (imageResult) {
                const b64 = imageResult.result.image_base64 as string;
                const caption = `🎨 Generated: *${intentResult.calls[0]?.arguments?.prompt || message}*\n`;
                const imgChunk = `__SADIE_IMAGE__:${b64}`;
                try { event.sender.send('sadie:stream-chunk', { chunk: caption, streamId }); } catch (e) {}
                try { event.sender.send('sadie:stream-chunk', { chunk: imgChunk, streamId }); } catch (e) {}
                addToHistory(convId, 'assistant', caption + imgChunk);
              } else {
                // Tool failed — give a clear error instead of falling through to LLM
                const failedResult = (toolResults || []).find((r: any) => r?.error || r?.success === false);
                const errDetail = failedResult?.error || 'n8n webhook not reachable';
                const errMsg = `❌ Image generation is not available right now.\n\nThe \`image_generate\` tool requires **n8n** to be running locally with the webhook \`/webhook/sadie-image-generate\` configured to connect to an image API (e.g. Stable Diffusion, ComfyUI, or DALL-E).\n\nError: \`${errDetail}\``;
                try { event.sender.send('sadie:stream-chunk', { chunk: errMsg, streamId }); } catch (e) {}
                addToHistory(convId, 'assistant', errMsg);
              }
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              activeStreams.delete(streamId);
              return;
            }
            // ── END IMAGE GENERATION ──

            // Format tool results into a nice response
            let responseText = '';
            for (const result of (toolResults || [])) {
              if (!result?.result) continue;
              // Handle compound summary
              if (result.result.summary) {
                responseText += result.result.summary + '\n';
              }
              // Handle NBA standings
              else if (result.result.standings && Array.isArray(result.result.standings)) {
                result.result.standings.forEach((conf: any) => {
                  responseText += `🏀 **${conf.conference}**\n\n`;
                  responseText += `| # | Team | W | L | PCT | GB | Streak |\n`;
                  responseText += `|---|------|---|---|-----|----|--------|\n`;
                  conf.teams.forEach((t: any, i: number) => {
                    responseText += `| ${i + 1} | ${t.name} | ${t.wins} | ${t.losses} | ${t.pct} | ${t.gb} | ${t.streak || '-'} |\n`;
                  });
                  responseText += '\n';
                });
              }
              // Handle NBA games — use enrichNbaGames so news/highlights are included
              else if (result.result.events && result.result.events.length > 0) {
                try {
                  const enriched = await enrichNbaGames(result.result.events, result.result.query || '', {
                    maxWebResults: 3,
                    fetchContent: true,
                    context: {
                      executionId: `nba-enrich-${Date.now()}`,
                      requestConfirmation,
                      requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason)
                    } as ToolContext
                  });
                  responseText += enriched.summary + '\n';
                } catch (enrichErr: any) {
                  // Fallback to basic formatting if enrichment fails
                  console.error('[SADIE] NBA enrichment failed, using basic format:', enrichErr?.message);
                  const today = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                  responseText += `🏀 **NBA Games — ${today}**\n\n`;
                  result.result.events.slice(0, 10).forEach((game: any) => {
                  const comps = game.competitions?.[0];
                  const competitors = comps?.competitors || [];
                  const sorted = [...competitors].sort((a: any, b: any) => (a.homeAway === 'home' ? 1 : -1) - (b.homeAway === 'home' ? 1 : -1));
                  const away = sorted[0]; const home = sorted[1];
                  const awayName = away?.team?.displayName || 'Away';
                  const homeName = home?.team?.displayName || 'Home';
                  const isScheduled = game.status?.type?.state === 'pre' || game.status?.type?.description === 'Scheduled';
                  const awayScore = away?.score; const homeScore = home?.score;
                  const scores = (!isScheduled && awayScore != null && homeScore != null) ? ` **${awayScore}–${homeScore}**` : '';
                  const statusDetail = game.status?.type?.shortDetail || game.status?.type?.description || 'Scheduled';
                  const gameTime = game.date ? new Date(game.date).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '';
                  const timeStr = isScheduled && gameTime ? gameTime : statusDetail;
                  responseText += `**${awayName}** @ **${homeName}**${scores}\n📍 ${timeStr}\n\n`;
                  });
                }
              }
              // Handle weather results
              else if (result.result.temperature && result.result.condition) {
                responseText += `🌤️ **Weather for ${result.result.location || 'your location'}**\n\n`;
                responseText += `Temperature: ${result.result.temperature.celsius || ''}`;
                if (result.result.temperature.feelsLike) responseText += ` (feels like ${result.result.temperature.feelsLike})`;
                responseText += '\n';
                responseText += `Condition: ${result.result.condition}\n`;
                if (result.result.wind) responseText += `Wind: ${result.result.wind.speed || ''} ${result.result.wind.direction || ''}\n`;
                if (result.result.humidity) responseText += `Humidity: ${result.result.humidity}\n`;
                if (result.result.uvIndex) responseText += `UV Index: ${result.result.uvIndex}\n`;
                if (result.result.precipitation) responseText += `Precipitation: ${result.result.precipitation}\n`;
                if (result.result.visibility) responseText += `Visibility: ${result.result.visibility}\n`;
              }
              // Handle web search results
              else if (result.result.topResultContent || result.result.aiAnswer || (result.result.results && Array.isArray(result.result.results))) {
                // Prefer Tavily AI answer — it's already a synthesis
                if (result.result.aiAnswer) {
                  responseText += result.result.aiAnswer + '\n';
                  const firstResult = Array.isArray(result.result.results) && result.result.results[0];
                  if (firstResult?.url) responseText += `\nSource: ${firstResult.title || firstResult.url} — ${firstResult.url}\n`;
                } else {
                  // Use formatWebSearchResult which already applies takeSentences truncation
                  const formatted = formatWebSearchResult(result);
                  if (formatted) {
                    responseText += formatted + '\n';
                  } else if (Array.isArray(result.result.results) && result.result.results.length > 0) {
                    // Last resort: numbered snippet list
                    responseText += `Here are the top results for "${result.result.query || 'your search'}":\n\n`;
                    result.result.results.slice(0, 5).forEach((r: any, i: number) => {
                      responseText += `**${i + 1}. ${r.title || 'Result'}**\n`;
                      if (r.snippet) responseText += `${r.snippet}\n`;
                      if (r.url) responseText += `${r.url}\n`;
                      responseText += '\n';
                    });
                  }
                }
              }
              // Handle directory listing
              else if (result.result.entries && Array.isArray(result.result.entries)) {
                responseText += `📂 Contents of ${result.result.path}:\n\n`;
                for (const entry of result.result.entries.slice(0, 30)) {
                  const icon = entry.type === 'directory' ? '📁' : '📄';
                  const size = entry.size != null ? ` (${(entry.size / 1024).toFixed(1)} KB)` : '';
                  responseText += `${icon} ${entry.name}${size}\n`;
                }
              }
              // Handle document parsing
              else if (result.result.preview || result.result.word_count) {
                responseText += `📄 **${result.result.filename || 'Document'}**`;
                if (result.result.page_count) responseText += ` (${result.result.page_count} pages, ${result.result.word_count} words)`;
                responseText += '\n\n' + (result.result.content || result.result.preview || '') + '\n';
              }
              // Handle news headlines
              else if (result.result.items && Array.isArray(result.result.items)) {
                responseText += `📰 **${result.result.source || 'News'}**\n\n`;
                (result.result.items as any[]).forEach((item: any, i: number) => {
                  responseText += `**${i + 1}. ${item.title}**\n`;
                  if (item.summary) responseText += `${String(item.summary).slice(0, 200)}\n`;
                  if (item.link) responseText += `${item.link}\n`;
                  responseText += '\n';
                });
              }
              // Handle git status
              else if (result.result.branch !== undefined && result.result.staged !== undefined) {
                const r = result.result;
                if (r.clean) {
                  responseText += `✅ **Git Status** — \`${r.branch}\`\nWorking tree clean.\n`;
                } else {
                  responseText += `📋 **Git Status** — \`${r.branch}\`\n\n`;
                  if (r.staged?.length) responseText += `**Staged:**\n${(r.staged as string[]).map(f => `  ✅ ${f}`).join('\n')}\n\n`;
                  if (r.unstaged?.length) responseText += `**Unstaged:**\n${(r.unstaged as string[]).map(f => `  📝 ${f}`).join('\n')}\n\n`;
                  if (r.untracked?.length) responseText += `**Untracked:**\n${(r.untracked as string[]).map(f => `  ❓ ${f}`).join('\n')}\n`;
                }
              }
              // Handle git log
              else if (result.result.commits && Array.isArray(result.result.commits)) {
                responseText += `📜 **Git Log** (${result.result.count} commits)\n\n`;
                (result.result.commits as any[]).forEach((c: any) => {
                  responseText += `\`${String(c.hash).slice(0, 7)}\` **${c.message}**\n  👤 ${c.author} — ${c.date}\n\n`;
                });
              }
              // Handle git diff
              else if (result.result.diff !== undefined) {
                if (!String(result.result.diff).trim()) {
                  responseText += '✅ No changes.\n';
                } else {
                  responseText += `\`\`\`diff\n${String(result.result.diff).slice(0, 6000)}\n\`\`\`\n`;
                  if (result.result.truncated) responseText += `\n*(diff truncated — ${result.result.total_chars} chars total)*\n`;
                }
              }
              // Handle process list
              else if (result.result.processes && Array.isArray(result.result.processes)) {
                responseText += `⚙️ **Processes** (top ${result.result.count})\n\n`;
                (result.result.processes as any[]).slice(0, 20).forEach((p: any) => {
                  const cpu = p.CpuPercent != null ? ` CPU:${Number(p.CpuPercent).toFixed(1)}%` : '';
                  const mem = p.WorkingSetMB != null ? ` RAM:${Number(p.WorkingSetMB).toFixed(0)}MB` : '';
                  responseText += `**${p.Name || p.ProcessName}** (PID ${p.Id || p.PID})${cpu}${mem}\n`;
                });
              }
              // Handle contacts search
              else if (result.result.contacts !== undefined) {
                if (result.result.count === 0) {
                  responseText += '🔍 No contacts found.\n';
                } else {
                  responseText += `👤 **Contacts** (${result.result.count} found)\n\n`;
                  (result.result.contacts as any[]).slice(0, 10).forEach((c: any) => {
                    responseText += `**${c.name || c.displayName}**\n`;
                    if (c.email) responseText += `  📧 ${c.email}\n`;
                    if (c.phone) responseText += `  📞 ${c.phone}\n`;
                    if (c.company) responseText += `  🏢 ${c.company}\n`;
                    responseText += '\n';
                  });
                }
              }
              // Handle contact added
              else if (result.result.added) {
                const c = result.result.added as any;
                responseText += `✅ Contact saved: **${c.name}**${c.email ? ` <${c.email}>` : ''}\n`;
              }
              // Handle reminder set
              else if (result.result.fire_at && result.result.id) {
                const fireDate = new Date(result.result.fire_at as string).toLocaleString();
                responseText += `⏰ Reminder set!\n**"${result.result.message}"**\n🕐 Fires at: ${fireDate}\n`;
              }
              // Handle reminders list
              else if (result.result.reminders !== undefined) {
                if (result.result.count === 0) {
                  responseText += '⏰ No pending reminders.\n';
                } else {
                  responseText += `⏰ **Pending Reminders** (${result.result.count})\n\n`;
                  (result.result.reminders as any[]).forEach((r: any) => {
                    responseText += `**${r.message}**\n🕐 ${new Date(r.fireAt).toLocaleString()}\nID: \`${r.id}\`\n\n`;
                  });
                }
              }
              // Handle notification confirmed
              else if (result.result.title !== undefined && result.result.body !== undefined) {
                responseText += `🔔 Notification shown: **${result.result.title}** — ${result.result.body}\n`;
              }
              // Handle run_code output
              else if (result.result.stdout !== undefined || result.result.stderr !== undefined) {
                if (String(result.result.stdout || '').trim()) {
                  responseText += `\`\`\`\n${String(result.result.stdout).slice(0, 3000)}\n\`\`\`\n`;
                }
                if (String(result.result.stderr || '').trim()) {
                  responseText += `⚠️ stderr:\n\`\`\`\n${String(result.result.stderr).slice(0, 1000)}\n\`\`\`\n`;
                }
                if (result.result.exit_code !== undefined && result.result.exit_code !== 0) {
                  responseText += `Exit code: ${result.result.exit_code}\n`;
                }
              }
              // Handle generic content
              else if (result.result.content) {
                responseText += result.result.content + '\n';
              }
              // Last resort
              else {
                responseText += JSON.stringify(result.result).slice(0, 500) + '\n';
              }
            }
            
            if (!responseText.trim() && toolResults && toolResults.length > 0) {
              responseText = JSON.stringify(toolResults[0]?.result || toolResults[0]).slice(0, 500);
            }

            if (responseText.trim()) {
              addToHistory(convId, 'assistant', responseText);
              try { event.sender.send('sadie:stream-chunk', { chunk: responseText, streamId }); } catch (e) {}
              try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
              activeStreams.delete(streamId);
              return;
            }
            // If formatting produced nothing, fall through to LLM streaming
          }
        }
        // ─── END SMART ROUTING ───
        
        if (useDirectOllama) {
          if (process.env.NODE_ENV !== 'production') console.log('[DIAG] Taking direct Ollama path');
          try { pushRouter('Taking direct Ollama path'); } catch (e) {}
          // Direct Ollama streaming - no n8n required
          const handler = await streamFromOllama(
            enhancedMessage,
            request.images,
            convId,
            (chunk) => {
              if (!activeStreams.has(streamId)) return;
              assistantResponse += chunk;
              try { pushRouter(`OLLAMA emitted chunk streamId=${streamId} len=${String(chunk?.length ?? 0)}`); } catch (e) {}
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
              try { pushRouter(`PROXY emitted chunk streamId=${streamId} len=${String(chunk).length}`); } catch (e) {}
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
            
            if (intentResult && intentResult.calls && intentResult.calls.length > 0 && !autoExecuteToolsEnabled()) {
              console.log('[SADIE] Intent detected but automatic tool execution is disabled; proceeding with LLM/webhook path');
            }

            if (intentResult && intentResult.calls && intentResult.calls.length > 0 && autoExecuteToolsEnabled()) {
              console.log('[SADIE] Intent detected, executing tools directly:', intentResult.calls.map((c: any) => c.name));
              
              // Execute tools directly without involving the LLM
              try {
                // COMPOUND INTENT: weather → write_file chain (enriched, n8n path)
                const isCompound = intentResult.calls[0]?.name === '__compound_weather_file';
                if (isCompound) {
                  const { location, query } = intentResult.calls[0].arguments;
                  console.log('[SADIE] Compound intent (n8n path, enriched): get weather for', location, 'then write file');
                  
                  // Step 1: Get weather
                  const weatherResults = await executeToolBatch(
                    [{ name: 'get_weather', arguments: { location } }] as ToolCall[],
                    { executionId: `compound-weather-${Date.now()}`, requestConfirmation,
                      requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason) } as ToolContext
                  );
                  
                  const isSurf = /\b(surf|swell|waves?|ocean|marine|beach)\b/i.test(query || '');
                  const wr = weatherResults?.[0]?.result;
                  
                  // Use enrichment for detailed forecast with web context
                  const enriched = await enrichWeather(wr, location, {
                    maxWebResults: 3,
                    fetchContent: true,
                    customQuery: isSurf ? `${location} surf report wave height swell` : undefined
                  });
                  
                  const fileLabel = isSurf ? 'surf_conditions' : 'weather';
                  const fileName = `${fileLabel}_${location.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
                  const now = new Date().toLocaleString();
                  const fileContent = `${isSurf ? 'Surf Conditions' : 'Weather Report'} for ${location}\nGenerated: ${now}\n\n${enriched.summary.replace(/\*\*/g, '').replace(/🌤️|🏄|📊/g, '')}`;
                  
                  // Step 2: Write file to Desktop
                  const HOME = process.env.HOME || process.env.USERPROFILE || '';
                  const desktopPath = require('path').join(HOME, 'Desktop', fileName);
                  let writeSuccess = false;
                  let writeError = '';
                  try {
                    require('fs').writeFileSync(desktopPath, fileContent, 'utf-8');
                    writeSuccess = true;
                    console.log('[SADIE] Compound: file written successfully to', desktopPath);
                  } catch (writeErr: any) {
                    writeError = writeErr.message || String(writeErr);
                    console.error('[SADIE] Compound: file write FAILED:', writeError);
                  }
                  
                  // Build combined result
                  if (writeSuccess) {
                    const fileLink = formatFileLink(desktopPath, fileName);
                    toolResults = [
                      { result: { summary: `${enriched.summary}\n\n✅ Saved to ${fileLink}` } }
                    ];
                  } else {
                    toolResults = [
                      { result: { summary: `${enriched.summary}\n\n❌ Could not save file: ${writeError}` } }
                    ];
                  }
                }
                // COMPOUND INTENT: NBA → write_file chain (enriched, n8n path)
                else if (intentResult.calls[0]?.name === '__compound_nba_file') {
                  const { teamQuery, dateRange, perPage } = intentResult.calls[0].arguments;
                  console.log('[SADIE] Compound NBA+file intent (n8n path, enriched):', { teamQuery, dateRange, perPage });

                  const nbaResults = await executeToolBatch(
                    [{ name: 'nba_query', arguments: { type: 'games', date: dateRange, perPage: perPage || 50, query: teamQuery } }] as ToolCall[],
                    { executionId: `compound-nba-${Date.now()}`, requestConfirmation,
                      requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason) } as ToolContext
                  );

                  // Use enrichment for detailed results
                  const events = nbaResults?.[0]?.result?.events || [];
                  const enriched = await enrichNbaGames(events, teamQuery || '', {
                    maxWebResults: 3,
                    fetchContent: true
                  });

                  const nbaContent = `NBA Games Report\nGenerated: ${new Date().toLocaleString()}\n\n${enriched.summary.replace(/\*\*/g, '').replace(/📰|🏀|🏆|📍|🏟️/g, '')}`;

                  const HOME = process.env.HOME || process.env.USERPROFILE || '';
                  const teamSuffix = teamQuery ? `_${teamQuery}` : '';
                  const nbaFileName = `nba_games${teamSuffix}.txt`;
                  const nbaDesktopPath = require('path').join(HOME, 'Desktop', nbaFileName);
                  let nbaWriteOk = false;
                  try {
                    require('fs').writeFileSync(nbaDesktopPath, nbaContent, 'utf-8');
                    nbaWriteOk = true;
                  } catch (e: any) {
                    console.error('[SADIE] Compound NBA file write FAILED:', e.message);
                  }

                  const gameCount = events?.length || 0;
                  if (nbaWriteOk) {
                    const fileLink = formatFileLink(nbaDesktopPath, nbaFileName);
                    toolResults = [{ result: { summary: `${enriched.summary}\n\n✅ Saved ${gameCount} games to ${fileLink}` } }];
                  } else {
                    toolResults = [{ result: { summary: `${enriched.summary}\n\n❌ Could not save file.` } }];
                  }
                }
                // COMPOUND INTENT: web_search → write_file chain (enriched, n8n path)
                else if (intentResult.calls[0]?.name === '__compound_search_file') {
                  const { topic } = intentResult.calls[0].arguments;
                  console.log('[SADIE] Compound search+file intent (n8n path, enriched):', topic);

                  // Use enrichment for comprehensive results
                  const enriched = await enrichGenericQuery(topic, null, {
                    maxWebResults: 5,
                    fetchContent: true
                  });

                  const searchContent = `${topic}\nGenerated: ${new Date().toLocaleString()}\n\n${enriched.summary.replace(/\*\*/g, '').replace(/📄|🔗/g, '')}`;

                  const HOME = process.env.HOME || process.env.USERPROFILE || '';
                  const safeFileName = topic.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 40) + '.txt';
                  const searchFilePath = require('path').join(HOME, 'Desktop', safeFileName);
                  let searchWriteOk = false;
                  try {
                    require('fs').writeFileSync(searchFilePath, searchContent, 'utf-8');
                    searchWriteOk = true;
                  } catch (e: any) {
                    console.error('[SADIE] Compound search file write FAILED:', e.message);
                  }

                  if (searchWriteOk) {
                    const fileLink = formatFileLink(searchFilePath, safeFileName);
                    toolResults = [{ result: { summary: `${enriched.summary}\n\n✅ Saved to ${fileLink}` } }];
                  } else {
                    toolResults = [{ result: { summary: `${enriched.summary}\n\n❌ Could not save file.` } }];
                  }
                }
                // STANDALONE SURF INTENT (n8n path, enriched): web_search for surf conditions
                else if (intentResult.calls[0]?.name === '__surf_conditions') {
                  const { location } = intentResult.calls[0].arguments;
                  console.log('[SADIE] Surf conditions intent (n8n path, enriched):', location);

                  // Use enrichment for comprehensive surf data
                  const enriched = await enrichWeather(null, location, {
                    maxWebResults: 4,
                    fetchContent: true,
                    customQuery: `${location} surf report wave height swell period tide conditions today`
                  });

                  toolResults = [{ result: { summary: enriched.summary } }];
                }
                // COMPOUND SURF + FILE INTENT (n8n path, enriched)
                else if (intentResult.calls[0]?.name === '__compound_surf_file') {
                  const { location } = intentResult.calls[0].arguments;
                  console.log('[SADIE] Compound surf+file intent (n8n path, enriched):', location);

                  // Use enrichment for comprehensive surf data
                  const enriched = await enrichWeather(null, location, {
                    maxWebResults: 4,
                    fetchContent: true,
                    customQuery: `${location} surf report wave height swell period tide conditions today`
                  });

                  const surfContent = `Surf Conditions for ${location}\nGenerated: ${new Date().toLocaleString()}\n\n${enriched.summary.replace(/\*\*/g, '').replace(/🏄|📊/g, '')}`;

                  const HOME = process.env.HOME || process.env.USERPROFILE || '';
                  const surfFileName = `surf_conditions_${location.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
                  const surfFilePath = require('path').join(HOME, 'Desktop', surfFileName);
                  let surfWriteOk = false;
                  try {
                    require('fs').writeFileSync(surfFilePath, surfContent, 'utf-8');
                    surfWriteOk = true;
                  } catch (e: any) {
                    console.error('[SADIE] Compound surf file write FAILED:', e.message);
                  }

                  const fileLink = formatFileLink(surfFilePath, surfFileName);
                  const summary = `${enriched.summary}\n\n${surfWriteOk ? `✅ Saved to ${fileLink}` : '❌ Could not save file.'}`;
                  toolResults = [{ result: { summary } }];
                } else {
                  // Normal single-step intent
                  toolResults = await executeToolBatch(intentResult.calls as ToolCall[], {
                    executionId: `intent-${Date.now()}`,
                    requestConfirmation,
                    requestPermission: (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason)
                  } as ToolContext);
                }
                
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
                  // Handle NBA standings
                  if (result.result.standings && Array.isArray(result.result.standings)) {
                    result.result.standings.forEach((conf: any) => {
                      responseText += `🏀 **${conf.conference}**\n\n`;
                      responseText += `| # | Team | W | L | PCT | GB | Streak |\n`;
                      responseText += `|---|------|---|---|-----|----|--------|\n`;
                      conf.teams.forEach((t: any, i: number) => {
                        responseText += `| ${i + 1} | ${t.name} | ${t.wins} | ${t.losses} | ${t.pct} | ${t.gb} | ${t.streak || '-'} |\n`;
                      });
                      responseText += '\n';
                    });
                  }
                  // Handle NBA games
                  else if (result.result.events && result.result.events.length > 0) {
                    responseText += 'Here are the games:\n\n';
                    result.result.events.slice(0, 5).forEach((game: any) => {
                      const teams = game.competitions?.[0]?.competitors?.map((c: any) => c.team.displayName).join(' vs ') || 'Unknown matchup';
                      const status = game.status?.type?.shortDetail || game.status?.type?.description || 'Scheduled';
                      responseText += `${teams} - ${status}\n`;
                    });
                  }
                  // Handle weather results (wttr.in shape)
                  else if (result.result.temperature && result.result.condition) {
                    responseText += `🌤️ **Weather for ${result.result.location || 'your location'}**\n\n`;
                    responseText += `Temperature: ${result.result.temperature.celsius || ''}`;
                    if (result.result.temperature.feelsLike) responseText += ` (feels like ${result.result.temperature.feelsLike})`;
                    responseText += '\n';
                    responseText += `Condition: ${result.result.condition}\n`;
                    if (result.result.wind) responseText += `Wind: ${result.result.wind.speed || ''} ${result.result.wind.direction || ''}\n`;
                    if (result.result.humidity) responseText += `Humidity: ${result.result.humidity}\n`;
                    if (result.result.uvIndex) responseText += `UV Index: ${result.result.uvIndex}\n`;
                    if (result.result.precipitation) responseText += `Precipitation: ${result.result.precipitation}\n`;
                    if (result.result.visibility) responseText += `Visibility: ${result.result.visibility}\n`;
                  }
                  // Handle web search results — route through LLM for synthesis
                  else if (result.result.topResultContent || (result.result.results && Array.isArray(result.result.results))) {
                    const sr = result.result;
                    const contextParts: string[] = [];
                    if (sr.aiAnswer) contextParts.push(`AI Summary: ${sr.aiAnswer}`);
                    if (sr.topResultContent?.content || sr.topResultContent?.contentText) {
                      const raw = (sr.topResultContent.content || sr.topResultContent.contentText || '').replace(/\s+/g, ' ').trim();
                      const cleaned = raw.split(/\n/).filter((l: string) => !/(\[&>|]:h-|]:w-|]:mb-|]:rounded|]:overflow|]:max-h-)/.test(l)).join(' ').trim();
                      contextParts.push(takeSentences(cleaned, 1200, 8));
                      if (sr.topResultContent.url) contextParts.push(`Source: ${sr.topResultContent.url}`);
                    }
                    if (Array.isArray(sr.results) && sr.results.length > 0) {
                      const snippets = sr.results.slice(0, 5).map((r: any, i: number) =>
                        `${i + 1}. ${r.title || ''}: ${r.snippet || ''}${r.url ? ` (${r.url})` : ''}`
                      ).join('\n');
                      contextParts.push(`Search results:\n${snippets}`);
                    }
                    const searchContext = contextParts.filter(Boolean).join('\n\n');
                    if (searchContext) {
                      const augMsg = `[SEARCH RESULTS]\n${searchContext}\n[/SEARCH RESULTS]\n\nUsing only the search results above, answer this question concisely and directly — do not list snippets, give a real answer: ${enhancedMessage}`;
                      addToHistory(convId, 'user', enhancedMessage);
                      let synthResponse = '';
                      const synthHandler = await streamFromLLM(
                        augMsg, undefined, convId,
                        (chunk) => {
                          if (!activeStreams.has(streamId)) return;
                          synthResponse += chunk;
                          try { event.sender.send('sadie:stream-chunk', { chunk, streamId }); } catch (e) {}
                        },
                        () => {}, () => {},
                        () => {
                          if (synthResponse.trim()) addToHistory(convId, 'assistant', synthResponse);
                          try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
                          activeStreams.delete(streamId);
                        },
                        (err) => {
                          try { event.sender.send('sadie:stream-error', { error: true, message: 'Search synthesis error', details: err?.message || err, streamId }); } catch (e) {}
                          activeStreams.delete(streamId);
                        },
                        requestConfirmation,
                        (perms: string[], reason: string) => permissionRequester.request(event.sender, streamId, perms, reason)
                      );
                      activeStreams.set(streamId, { destroy: synthHandler.cancel });
                      return;
                    }
                  }
                  // Handle parsed document results (from parse_document_from_path)
                  else if (result.result.preview || result.result.word_count) {
                    responseText += `📄 **${result.result.filename || 'Document'}**`;
                    if (result.result.page_count) responseText += ` (${result.result.page_count} pages, ${result.result.word_count} words)`;
                    else if (result.result.word_count) responseText += ` (${result.result.word_count} words)`;
                    responseText += '\n\n';
                    const content = result.result.content || result.result.preview || '';
                    responseText += content + '\n';
                  }
                  // Handle list_directory results
                  else if (result.result.entries && Array.isArray(result.result.entries)) {
                    responseText += `📂 Contents of ${result.result.path}:\n\n`;
                    for (const entry of result.result.entries.slice(0, 30)) {
                      const icon = entry.type === 'directory' ? '📁' : '📄';
                      const size = entry.size != null ? ` (${(entry.size / 1024).toFixed(1)} KB)` : '';
                      responseText += `${icon} ${entry.name}${size}\n`;
                    }
                    if (result.result.entries.length > 30) {
                      responseText += `... and ${result.result.entries.length - 30} more items\n`;
                    }
                  }
                  // Handle plain content/summary
                  else if (result.result.content) {
                    responseText += result.result.content + '\n';
                  } else if (result.result.summary) {
                    responseText += result.result.summary + '\n';
                  }
                  // Handle write_file / file operation results (success + path)
                  else if (result.result.success && result.result.path) {
                    // Already shown via the compound summary, skip duplicating
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
                  try { pushRouter(`LLM emitted chunk streamId=${streamId} len=${String(chunk).length}`); } catch (e) {}
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
                      messages: uncensoredModeEnabled
                        ? [ { role: 'user', content: reqAny.message } ]
                        : [ { role: 'system', content: SADIE_SYSTEM_PROMPT }, { role: 'user', content: reqAny.message } ],
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
              // Patch: prepend conversation system prompt if provided by renderer
              let systemPrompt = SADIE_SYSTEM_PROMPT;
              if (reqAny.conversationPrompt && typeof reqAny.conversationPrompt === 'string') {
                systemPrompt = reqAny.conversationPrompt;
              }
              const fallbackBody = {
                model: uncensoredModeEnabled ? OLLAMA_UNCENSORED_MODEL : OLLAMA_CHAT_MODEL,
                messages: uncensoredModeEnabled
                  ? [ { role: 'user', content: reqAny.message } ]
                  : [ { role: 'system', content: systemPrompt }, { role: 'user', content: reqAny.message } ],
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
              try { event.sender.send('sadie:stream-error', { error: true, message: 'Streaming initialization error', details: err?.message || err, streamId, diagnostic: { url: streamUrl, errorText: err?.message || String(err) } }); } catch (e) {}
              try { logTelemetryEvent('stream_failure', { streamId, reason: 'stream_init_failed', error: err?.message || String(err), url: streamUrl }); } catch (e) {}
              try { pushRouter(`direct stream fallback failed for streamId=${streamId} error=${fallbackErr?.message || fallbackErr}`); } catch (e) {}
              activeStreams.delete(streamId);
            }
          }
        }
        } // end SMART ROUTING bare block
      } catch (error: any) {
        // n8n failed - either fall back to direct Ollama (if explicitly enabled),
        // or return an error to the renderer. Do NOT fall back to Ollama silently
        // because this can mask upstream failures during tests.
            // Fallback: fetch a non-streaming response from Ollama and return final text
            try {
              const fallbackBody = {
                model: uncensoredModeEnabled ? OLLAMA_UNCENSORED_MODEL : OLLAMA_CHAT_MODEL,
                messages: uncensoredModeEnabled
                  ? [ { role: 'user', content: reqAny.message } ]
                  : [ { role: 'system', content: SADIE_SYSTEM_PROMPT }, { role: 'user', content: reqAny.message } ],
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
