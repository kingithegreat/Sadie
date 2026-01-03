/**
 * Pre-Processor Module
 * 
 * Handles deterministic intent detection and tool forcing.
 * Routes certain message patterns directly to tools without LLM involvement.
 * 
 * Extracted from message-router.ts for better maintainability.
 */

import { ToolCall } from '../tools';

// ============================================
// Types
// ============================================

export type RoutingDecision =
  | { type: 'tools'; calls: ToolCall[] }
  | { type: 'llm' }
  | { type: 'error'; reason: string };

// ============================================
// Constants - Tool Patterns
// ============================================

// NBA Team names for sports queries
const NBA_TEAMS = [
  'warriors', 'lakers', 'celtics', 'bulls', 'heat', 'nets', 'knicks', 'bucks',
  'suns', 'mavericks', 'mavs', 'nuggets', 'clippers', 'rockets', 'spurs', 'grizzlies',
  'thunder', 'blazers', 'jazz', 'kings', 'pelicans', 'timberwolves', 'wolves',
  'hawks', 'hornets', 'cavaliers', 'cavs', 'pistons', 'pacers', 'magic', 'sixers',
  '76ers', 'raptors', 'wizards', 'golden state', 'los angeles', 'boston', 'chicago',
  'miami', 'brooklyn', 'new york', 'milwaukee', 'phoenix', 'dallas', 'denver',
  'houston', 'san antonio', 'memphis', 'oklahoma', 'portland', 'utah', 'sacramento',
  'new orleans', 'minnesota', 'atlanta', 'charlotte', 'cleveland', 'detroit',
  'indiana', 'orlando', 'philadelphia', 'toronto', 'washington'
];

// ============================================
// Intent Detection Functions
// ============================================

/**
 * Detect NBA/sports intent
 */
function detectNbaIntent(message: string): { calls: any[] } | null {
  const m = message.toLowerCase();
  
  const hasTeamMention = NBA_TEAMS.some(team => m.includes(team));
  const hasNbaKeyword = /\b(nba|basketball|game|games|score|scores|schedule|results?|last \d+ games?)\b/i.test(m);
  
  if (!hasTeamMention && !hasNbaKeyword) return null;
  
  // Extract team name
  let teamQuery = '';
  for (const team of NBA_TEAMS) {
    if (m.includes(team)) {
      teamQuery = team;
      break;
    }
  }
  
  // Extract number of games if mentioned
  const gamesMatch = m.match(/last\s*(\d+)\s*games?/i);
  const perPage = gamesMatch ? parseInt(gamesMatch[1], 10) : 5;
  
  // Check if explicitly asking for results/scores (past games) vs schedule (upcoming games)
  // Only add "results" to query when user explicitly uses result-related words
  const wantsResults = /\b(results?|scores?|final|won|lost|beat|defeated)\b/i.test(m);
  
  // Add context to query so NBA tool knows to look for completed games
  const queryWithContext = wantsResults 
    ? (teamQuery ? `${teamQuery} results` : 'results')
    : teamQuery;
  
  return { 
    calls: [{ name: 'nba_query', arguments: { type: 'games', date: '', perPage, query: queryWithContext } }] 
  };
}

/**
 * Detect weather intent
 */
function detectWeatherIntent(message: string): { calls: any[] } | null {
  const m = message.toLowerCase();
  
  if (!/\b(weather|temperature|forecast|rain|sunny|cloudy)\b/i.test(m)) return null;
  
  // Try multiple patterns to extract location
  // Pattern 1: "weather in/for/at [location] [optional time modifier]"
  let locMatch = m.match(/\b(?:weather|forecast|temperature)\s+(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]+?)(?:\s+(?:for|today|tomorrow|now|please|right now|this|next|the next).*)?$/i);
  
  // Pattern 2: "in/for/at [location] weather"
  if (!locMatch) {
    locMatch = m.match(/\b(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,]+?)\s+(?:weather|forecast)/i);
  }
  
  // Pattern 3: Just "weather [location]" without preposition
  if (!locMatch) {
    locMatch = m.match(/\bweather\s+([a-zA-Z][a-zA-Z\s,]+?)(?:\s+(?:for|today|tomorrow|now|please|right now|this|next|the next).*)?$/i);
  }
  
  const location = locMatch ? locMatch[1].trim() : '';
  
  if (location && location.length > 1) {
    return { calls: [{ name: 'get_weather', arguments: { location } }] };
  }
  
  return null;
}

/**
 * Detect time/date intent
 */
function detectTimeIntent(message: string): { calls: any[] } | null {
  const m = message.toLowerCase();
  
  if (/\b(what time|current time|time is it|what\'?s the time|date today|current date|today\'?s date)\b/i.test(m)) {
    return { calls: [{ name: 'get_current_time', arguments: {} }] };
  }
  
  return null;
}

/**
 * Detect calculator intent
 */
function detectCalculatorIntent(message: string): { calls: any[] } | null {
  const m = message.toLowerCase();
  
  const calcMatch = m.match(/^(?:calculate|compute|what\'?s|whats)\s+(.+?)(?:\s*\?)?$/i);
  if (calcMatch) {
    const expression = calcMatch[1].trim();
    // Check if it looks like a math expression
    if (/[\d+\-*\/().\s%]+/.test(expression)) {
      return { calls: [{ name: 'calculate', arguments: { expression } }] };
    }
  }
  
  return null;
}

/**
 * Detect system info intent
 */
function detectSystemInfoIntent(message: string): { calls: any[] } | null {
  const m = message.toLowerCase();
  
  if (/\b(system info|os version|my (os|operating system)|what os|computer info)\b/i.test(m)) {
    return { calls: [{ name: 'get_system_info', arguments: {} }] };
  }
  
  return null;
}

/**
 * Detect file read intent
 */
function detectFileReadIntent(message: string): { calls: any[] } | null {
  const m = message.toLowerCase();
  
  if (/\b(read|show|display|cat|get)\s+(?:the\s+)?(?:file|contents of)\s+(.+)/i.test(m)) {
    const fileMatch = m.match(/\b(read|show|display|cat|get)\s+(?:the\s+)?(?:file|contents of)\s+(.+)/i);
    if (fileMatch) {
      const filePath = fileMatch[2].trim();
      return { calls: [{ name: 'read_file', arguments: { path: filePath } }] };
    }
  }
  
  return null;
}

/**
 * Detect list directory intent
 */
function detectListDirIntent(message: string): { calls: any[] } | null {
  const m = message.toLowerCase();
  
  if (/\b(list|show|ls|dir)\s+(?:files in|directory|folder)\s+(.+)/i.test(m)) {
    const dirMatch = m.match(/\b(list|show|ls|dir)\s+(?:files in|directory|folder)\s+(.+)/i);
    if (dirMatch) {
      const dirPath = dirMatch[2].trim();
      return { calls: [{ name: 'list_directory', arguments: { path: dirPath } }] };
    }
  }
  
  return null;
}

/**
 * Detect clipboard intent
 */
function detectClipboardIntent(message: string): { calls: any[] } | null {
  const m = message.toLowerCase();
  
  if (/\b(get|show|what\'?s (?:in|on) (?:my\s+)?clipboard)\b/i.test(m)) {
    return { calls: [{ name: 'get_clipboard', arguments: {} }] };
  }
  
  return null;
}

/**
 * Detect web search intent (fallback for general queries)
 */
function detectWebSearchIntent(message: string, originalMessage: string): { calls: any[] } | null {
  const m = message.toLowerCase();
  
  if (/\b(search for|find|who is|what is|look up|tell me about)\b/i.test(m)) {
    const q = originalMessage.trim();
    return { calls: [{ name: 'web_search', arguments: { query: q, maxResults: 5, fetchTopResult: true } }] };
  }
  
  return null;
}

// ============================================
// Main Exports
// ============================================

/**
 * Pre-process a user message to detect deterministic tool intents.
 * Returns tool calls if a pattern matches, null otherwise.
 * 
 * This allows certain queries to bypass the LLM entirely for faster responses.
 */
export async function preProcessIntent(userMessage: string): Promise<{ calls: any[] } | null> {
  if (!userMessage || typeof userMessage !== 'string') return null;
  
  const m = userMessage.toLowerCase();
  
  // Check each intent detector in priority order
  // NBA/Sports (highest priority - most specific)
  const nbaResult = detectNbaIntent(userMessage);
  if (nbaResult) return nbaResult;
  
  // Weather
  const weatherResult = detectWeatherIntent(userMessage);
  if (weatherResult) return weatherResult;
  
  // Time/Date
  const timeResult = detectTimeIntent(userMessage);
  if (timeResult) return timeResult;
  
  // Calculator
  const calcResult = detectCalculatorIntent(userMessage);
  if (calcResult) return calcResult;
  
  // System Info
  const sysResult = detectSystemInfoIntent(userMessage);
  if (sysResult) return sysResult;
  
  // File Read
  const fileResult = detectFileReadIntent(userMessage);
  if (fileResult) return fileResult;
  
  // List Directory
  const dirResult = detectListDirIntent(userMessage);
  if (dirResult) return dirResult;
  
  // Clipboard
  const clipResult = detectClipboardIntent(userMessage);
  if (clipResult) return clipResult;
  
  // Web Search (lower priority - more general)
  const searchResult = detectWebSearchIntent(m, userMessage);
  if (searchResult) return searchResult;
  
  return null;
}

/**
 * Centralized routing decision analyzer.
 * This is the single canonical place that decides whether a message
 * should invoke tools or be handled by the LLM.
 */
export async function analyzeAndRouteMessage(message: string): Promise<RoutingDecision> {
  if (!message || typeof message !== 'string') {
    return { type: 'error', reason: 'invalid_message' };
  }
  
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

/**
 * Check if a message looks like it needs tool processing
 * (Used for quick checks without full analysis)
 */
export function mightNeedTools(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  
  // Quick heuristics for tool-likely messages
  return (
    NBA_TEAMS.some(team => m.includes(team)) ||
    /\b(weather|time|date|calculate|search|file|clipboard|system)\b/i.test(m)
  );
}
