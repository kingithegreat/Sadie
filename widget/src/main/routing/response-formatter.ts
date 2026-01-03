/**
 * Response Formatter Module
 * =========================
 * Handles formatting of tool results into human-readable responses.
 * Extracted from message-router.ts as part of modularization effort.
 * 
 * Key responsibilities:
 * - NBA game result formatting (direct, no LLM hallucination)
 * - Weather result formatting
 * - Tool result summarization
 * - Error message formatting
 */

// =====================
// NBA Result Formatter
// =====================

/**
 * Format NBA game results directly without passing through LLM.
 * This prevents hallucination of scores and game details.
 * 
 * @param result - The raw result from nba_query tool
 * @returns Formatted markdown string for display
 */
export function formatNbaResultDirectly(result: any): string {
  if (!result?.events || result.events.length === 0) {
    return `No NBA games found for "${result.query || 'your search'}". Try a different team name or check back later for upcoming games.`;
  }

  const lines: string[] = [];
  lines.push(`**NBA Games for ${result.query || 'your search'}:**\n`);

  for (const event of result.events) {
    // ESPN structure: event.competitions[0].competitors[] with home/away designation
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];
    
    // Find home and away teams
    const homeComp = competitors.find((c: any) => c.homeAway === 'home') || competitors[0];
    const awayComp = competitors.find((c: any) => c.homeAway === 'away') || competitors[1];
    
    const homeTeam = homeComp?.team?.displayName || homeComp?.team?.shortDisplayName || homeComp?.team?.name || event.homeTeam || 'Home Team';
    const awayTeam = awayComp?.team?.displayName || awayComp?.team?.shortDisplayName || awayComp?.team?.name || event.awayTeam || 'Away Team';
    const homeScore = homeComp?.score ?? event.homeScore ?? '—';
    const awayScore = awayComp?.score ?? event.awayScore ?? '—';
    
    // Get status
    const statusObj = competition?.status || event.status;
    const status = String(statusObj?.type?.name || statusObj?.type?.description || statusObj || 'Scheduled');
    
    // Get date
    const dateStr = event.date || competition?.date;
    const date = dateStr ? new Date(dateStr).toLocaleDateString('en-US', { 
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }) : 'TBD';

    if (status === 'STATUS_FINAL' || status.toLowerCase().includes('final')) {
      lines.push(`🏀 **${awayTeam}** ${awayScore} @ **${homeTeam}** ${homeScore} — *Final*`);
    } else if (status === 'STATUS_IN_PROGRESS' || status.toLowerCase().includes('progress')) {
      lines.push(`🏀 **${awayTeam}** ${awayScore} @ **${homeTeam}** ${homeScore} — *Live*`);
    } else {
      lines.push(`🏀 **${awayTeam}** @ **${homeTeam}** — ${date}`);
    }
  }

  return lines.join('\n');
}

// =====================
// Weather Result Formatter
// =====================

/**
 * Format weather results directly for display.
 * 
 * @param result - The raw result from get_weather tool
 * @returns Formatted markdown string for display
 */
export function formatWeatherResultDirectly(result: any): string {
  if (!result || result.error) {
    return `Unable to get weather information: ${result?.error || 'Unknown error'}`;
  }

  const location = result.location || result.city || 'Unknown location';
  const temp = result.temperature ?? result.temp;
  const conditions = result.conditions || result.description || result.weather || 'Unknown';
  const humidity = result.humidity;
  const wind = result.wind || result.wind_speed;

  const lines: string[] = [];
  lines.push(`**Weather for ${location}:**\n`);
  
  if (temp !== undefined) {
    lines.push(`🌡️ Temperature: ${temp}°F`);
  }
  lines.push(`☁️ Conditions: ${conditions}`);
  if (humidity !== undefined) {
    lines.push(`💧 Humidity: ${humidity}%`);
  }
  if (wind !== undefined) {
    lines.push(`💨 Wind: ${wind}`);
  }

  return lines.join('\n');
}

// =====================
// Tool Result Summarizer
// =====================

/**
 * Summarize tool results into a human-readable assistant message.
 * Keep this deterministic and brief for UI presentation.
 * 
 * @param results - Array of tool execution results
 * @returns Human-readable summary string
 */
export function summarizeToolResults(results: any[]): string {
  if (!results || results.length === 0) {
    return 'No results returned from tools.';
  }
  
  const parts: string[] = [];
  
  for (const r of results) {
    if (r === null || r === undefined) continue;
    
    if (r.success === false) {
      parts.push(`Tool failed: ${r.error || r.message || 'unknown error'}`);
      continue;
    }
    
    // Heuristic extraction for common result shapes
    if (r.result && typeof r.result === 'string') {
      parts.push(r.result);
    } else if (r.result && typeof r.result === 'object') {
      // Try to extract concise keys
      if (r.result.summary) parts.push(r.result.summary);
      else if (r.result.content) parts.push(r.result.content);
      else parts.push(JSON.stringify(r.result).slice(0, 400));
    } else if (r.output && typeof r.output === 'string') {
      parts.push(r.output);
    } else {
      parts.push(JSON.stringify(r).slice(0, 400));
    }
  }
  
  return parts.join('\n\n');
}

// =====================
// Error Formatters
// =====================

/**
 * Format network/connection errors for user display.
 * 
 * @param error - The error object
 * @returns User-friendly error message
 */
export function formatNetworkError(error: any): string {
  if (error.code === 'ECONNREFUSED') {
    return '⚠️ Cannot connect to the backend service. Please ensure n8n and Ollama are running.';
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return '⚠️ The request timed out. The backend may be overloaded or unavailable.';
  }
  if (error.code === 'ENOTFOUND') {
    return '⚠️ Could not resolve the backend address. Please check your network connection.';
  }
  return `⚠️ A network error occurred: ${error.message || 'Unknown error'}`;
}

/**
 * Format permission denial for user display.
 * 
 * @param permissions - Array of permission names that were denied
 * @returns User-friendly message explaining the denial
 */
export function formatPermissionDenied(permissions: string[]): string {
  if (permissions.length === 0) {
    return 'The requested action was not allowed.';
  }
  if (permissions.length === 1) {
    return `This action requires the "${permissions[0]}" permission, which was not granted.`;
  }
  return `This action requires the following permissions: ${permissions.join(', ')}. These were not granted.`;
}

// =====================
// Tool Aliases
// =====================

/**
 * Map of tool name aliases to their canonical names.
 * Used to normalize tool calls from different sources.
 */
export const TOOL_ALIASES: Record<string, string> = {
  nba_scores: 'nba_query',
  get_nba_scores: 'nba_query',
  nba_games: 'nba_query',
  weather: 'get_weather',
  time: 'get_current_time',
  clipboard: 'get_clipboard',
  search: 'web_search',
};

/**
 * Normalize a tool name using aliases.
 * 
 * @param name - The tool name (possibly an alias)
 * @returns The canonical tool name
 */
export function normalizeToolName(name: string): string {
  return TOOL_ALIASES[name] || name;
}

// =====================
// Direct Format Helpers
// =====================

/**
 * Check if a tool result should be formatted directly (bypass LLM).
 * 
 * @param toolName - The name of the tool
 * @returns True if results should be formatted directly
 */
export function shouldFormatDirectly(toolName: string): boolean {
  const directFormatTools = [
    'nba_query',
    'get_weather',
    'get_current_time',
    'calculate',
    'get_system_info',
  ];
  return directFormatTools.includes(normalizeToolName(toolName));
}

/**
 * Format a tool result directly based on tool name.
 * 
 * @param toolName - The name of the tool
 * @param result - The tool result
 * @returns Formatted string, or null if no direct formatter exists
 */
export function formatToolResultDirectly(toolName: string, result: any): string | null {
  const normalizedName = normalizeToolName(toolName);
  
  switch (normalizedName) {
    case 'nba_query':
      return formatNbaResultDirectly(result);
    case 'get_weather':
      return formatWeatherResultDirectly(result);
    case 'get_current_time':
      if (result?.time) return `🕐 The current time is **${result.time}**`;
      if (result?.formatted) return `🕐 ${result.formatted}`;
      if (typeof result === 'string') return `🕐 ${result}`;
      return null;
    case 'calculate':
      if (result?.result !== undefined) return `🧮 Result: **${result.result}**`;
      if (result?.answer !== undefined) return `🧮 Answer: **${result.answer}**`;
      return null;
    case 'get_system_info':
      if (result?.summary) return `💻 ${result.summary}`;
      return null;
    default:
      return null;
  }
}
