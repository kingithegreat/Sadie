/**
 * Tool Result Enrichment
 * 
 * Automatically enriches tool results with web search data for more detailed responses.
 * Uses a hybrid approach: structured API data + web context = comprehensive results.
 */

import { webSearchHandler } from './web';
import { ToolContext } from './types';

export interface EnrichmentOptions {
  /** Maximum additional web results to fetch */
  maxWebResults?: number;
  /** Whether to fetch full content from top result */
  fetchContent?: boolean;
  /** Custom search query override */
  customQuery?: string;
  /** Context for tool execution */
  context?: ToolContext;
}

export interface EnrichedResult {
  /** Original structured data from API */
  structured: any;
  /** Web search results for additional context */
  webContext?: {
    query: string;
    results: Array<{ title: string; url: string; snippet: string }>;
    topContent?: string;
  };
  /** Combined formatted summary */
  summary: string;
}

/**
 * Enrich NBA game data with web search for box scores, highlights, analysis
 */
export async function enrichNbaGames(
  events: any[],
  query: string = '',
  options: EnrichmentOptions = {}
): Promise<EnrichedResult> {
  const { maxWebResults = 3, fetchContent = true, context } = options;
  
  // Format structured data nicely
  const formattedGames: string[] = [];
  const teamNames: string[] = [];
  
  for (const event of events.slice(0, 10)) {
    const gameInfo = formatNbaGame(event);
    if (gameInfo) {
      formattedGames.push(gameInfo.formatted);
      teamNames.push(...gameInfo.teams);
    }
  }
  
  // Build search query for enrichment
  const searchQuery = options.customQuery || 
    (query ? `NBA ${query} box score highlights ${new Date().toLocaleDateString()}` :
     teamNames.length > 0 ? `NBA ${teamNames.slice(0, 2).join(' ')} game recap highlights` :
     `NBA games today scores highlights`);
  
  // Fetch web context
  let webContext: EnrichedResult['webContext'];
  try {
    const searchResult = await webSearchHandler({
      query: searchQuery,
      maxResults: maxWebResults,
      fetchTopResult: fetchContent
    }, context || {} as any);
    
    if (searchResult.success && searchResult.result) {
      const sr = searchResult.result;
      webContext = {
        query: searchQuery,
        results: (sr.results || []).slice(0, maxWebResults).map((r: any) => ({
          title: r.title || '',
          url: r.url || '',
          snippet: r.snippet || r.description || ''
        })),
        topContent: sr.topResultContent?.content || sr.topResultContent?.contentText
      };
    }
  } catch (e) {
    console.error('[Enrichment] Web search failed:', e);
  }
  
  // Build comprehensive summary
  let summary = `🏀 **NBA Games**\n\n`;
  
  if (formattedGames.length > 0) {
    summary += formattedGames.join('\n\n');
  } else {
    summary += 'No games found for this query.\n';
  }
  
  // Add web context highlights
  if (webContext?.topContent) {
    const highlights = extractHighlights(webContext.topContent);
    if (highlights) {
      summary += `\n\n---\n📰 **Latest Updates**\n${highlights}`;
    }
  } else if (webContext?.results && webContext.results.length > 0) {
    summary += `\n\n---\n📰 **Related Coverage**\n`;
    for (const r of webContext.results.slice(0, 3)) {
      summary += `• ${r.title}\n  ${r.snippet.slice(0, 150)}...\n`;
    }
  }
  
  return {
    structured: events,
    webContext,
    summary
  };
}

/**
 * Enrich weather data with additional forecast details
 */
export async function enrichWeather(
  weatherData: any,
  location: string,
  options: EnrichmentOptions = {}
): Promise<EnrichedResult> {
  const { maxWebResults = 2, fetchContent = true, context } = options;
  const isSurf = options.customQuery?.includes('surf') || false;
  
  // Format base weather data
  let summary = isSurf ? 
    `🏄 **Surf & Marine Conditions — ${location}**\n\n` :
    `🌤️ **Weather for ${location}**\n\n`;
  
  if (weatherData?.text) {
    summary += weatherData.text + '\n';
  } else if (weatherData?.current_condition) {
    const cond = weatherData.current_condition[0];
    summary += `**Current:** ${cond.temp_F}°F (${cond.temp_C}°C), ${cond.weatherDesc?.[0]?.value || 'Unknown'}\n`;
    summary += `**Wind:** ${cond.windspeedMiles} mph ${cond.winddir16Point}\n`;
    summary += `**Humidity:** ${cond.humidity}%\n`;
    if (cond.uvIndex) summary += `**UV Index:** ${cond.uvIndex}\n`;
  } else if (typeof weatherData === 'string') {
    summary += weatherData + '\n';
  }
  
  // Search for extended forecast / surf conditions
  const searchQuery = isSurf ?
    `${location} surf report wave height swell conditions today` :
    `${location} weather forecast detailed hourly`;
  
  let webContext: EnrichedResult['webContext'];
  try {
    const searchResult = await webSearchHandler({
      query: searchQuery,
      maxResults: maxWebResults,
      fetchTopResult: fetchContent
    }, context || {} as any);
    
    if (searchResult.success && searchResult.result) {
      const sr = searchResult.result;
      webContext = {
        query: searchQuery,
        results: (sr.results || []).slice(0, maxWebResults).map((r: any) => ({
          title: r.title || '',
          url: r.url || '',
          snippet: r.snippet || r.description || ''
        })),
        topContent: sr.topResultContent?.content || sr.topResultContent?.contentText
      };
    }
  } catch (e) {
    console.error('[Enrichment] Weather web search failed:', e);
  }
  
  // Add detailed forecast from web
  if (webContext?.topContent) {
    const details = extractWeatherDetails(webContext.topContent, isSurf);
    if (details) {
      summary += `\n---\n📊 **Detailed Forecast**\n${details}`;
    }
  }
  
  return {
    structured: weatherData,
    webContext,
    summary
  };
}

/**
 * Generic enrichment for any query - uses web search as primary source
 */
export async function enrichGenericQuery(
  topic: string,
  existingData: any = null,
  options: EnrichmentOptions = {}
): Promise<EnrichedResult> {
  const { maxWebResults = 5, fetchContent = true, context } = options;
  
  // Fetch comprehensive web data
  let webContext: EnrichedResult['webContext'];
  try {
    const searchResult = await webSearchHandler({
      query: topic,
      maxResults: maxWebResults,
      fetchTopResult: fetchContent
    }, context || {} as any);
    
    if (searchResult.success && searchResult.result) {
      const sr = searchResult.result;
      webContext = {
        query: topic,
        results: (sr.results || []).slice(0, maxWebResults).map((r: any) => ({
          title: r.title || '',
          url: r.url || '',
          snippet: r.snippet || r.description || ''
        })),
        topContent: sr.topResultContent?.content || sr.topResultContent?.contentText
      };
    }
  } catch (e) {
    console.error('[Enrichment] Generic web search failed:', e);
  }
  
  // Build summary
  let summary = `📄 **${topic}**\n\n`;
  
  if (webContext?.topContent) {
    // Clean and format the content
    const cleaned = cleanWebContent(webContext.topContent);
    summary += cleaned.slice(0, 3000);
    if (cleaned.length > 3000) summary += '...\n\n[Content truncated]';
  } else if (webContext?.results && webContext.results.length > 0) {
    summary += '**Search Results:**\n\n';
    for (const r of webContext.results) {
      summary += `### ${r.title}\n`;
      summary += `${r.snippet}\n`;
      summary += `🔗 ${r.url}\n\n`;
    }
  } else {
    summary += 'No results found.\n';
  }
  
  return {
    structured: existingData,
    webContext,
    summary
  };
}

// ============= HELPER FUNCTIONS =============

interface FormattedGame {
  formatted: string;
  teams: string[];
}

function formatNbaGame(event: any): FormattedGame | null {
  if (!event) return null;
  
  const teams: string[] = [];
  let formatted = '';
  
  // Get competition data
  const comp = event.competitions?.[0];
  const competitors = comp?.competitors || [];
  
  if (competitors.length >= 2) {
    // Sort so home team is second
    const sorted = [...competitors].sort((a, b) => 
      (a.homeAway === 'home' ? 1 : -1) - (b.homeAway === 'home' ? 1 : -1)
    );
    
    const away = sorted[0];
    const home = sorted[1];
    
    const awayTeam = away.team?.displayName || away.team?.name || 'Away';
    const homeTeam = home.team?.displayName || home.team?.name || 'Home';
    const awayRecord = away.records?.[0]?.summary || '';
    const homeRecord = home.records?.[0]?.summary || '';
    
    teams.push(awayTeam, homeTeam);
    
    // Get game status
    const statusDesc = event.status?.type?.description || 'Scheduled';
    const statusShort = event.status?.type?.shortDetail || statusDesc;
    const isScheduled = event.status?.type?.state === 'pre' || statusDesc === 'Scheduled';
    const isInProgress = event.status?.type?.state === 'in';
    const isFinal = event.status?.type?.state === 'post';

    // Only show scores when the game is live or finished
    let scoreStr = '';
    if (!isScheduled) {
      const awayScore = away.score ?? '—';
      const homeScore = home.score ?? '—';
      scoreStr = ` **${awayScore}–${homeScore}**`;
    }

    // Game time in ET (ESPN dates are UTC)
    let gameTimeStr = '';
    if (event.date) {
      const d = new Date(event.date);
      gameTimeStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    }
    
    // Format nicely
    formatted = `**${awayTeam}** @ **${homeTeam}**${scoreStr}`;
    if (awayRecord || homeRecord) {
      formatted += `\n  ${awayTeam} (${awayRecord}) vs ${homeTeam} (${homeRecord})`;
    }
    formatted += `\n  📍 ${isScheduled ? `${gameTimeStr}` : statusShort}`;
    if (isFinal) formatted += ' ✅';
    if (isInProgress) formatted += ' 🔴 Live';
    
    // Add leaders if available
    const leaders = comp?.leaders || [];
    if (leaders.length > 0) {
      const pointsLeader = leaders.find((l: any) => l.name === 'points');
      if (pointsLeader?.leaders?.[0]) {
        const leader = pointsLeader.leaders[0];
        formatted += `\n  🏆 ${leader.athlete?.displayName || 'Leader'}: ${leader.displayValue}`;
      }
    }
    
    // Add venue
    if (comp?.venue?.fullName) {
      formatted += `\n  🏟️ ${comp.venue.fullName}`;
    }
  } else {
    // Fallback to basic formatting
    formatted = event.name || event.shortName || 'Unknown Game';
    if (event.status?.type?.description) {
      formatted += ` — ${event.status.type.description}`;
    }
  }
  
  return { formatted, teams };
}

// Known boilerplate patterns to reject
const HIGHLIGHT_BLOCKLIST = [
  /youtube|google llc|copyright|privacy policy|terms of service|how .* works|test new features/i,
  /press copyright|contact us|creators|advertise|developers/i,
  /about press|feature\s*&copy/i,
  /subscribe|newsletter|sign up|log in|create account/i,
  /cookie|gdpr|ccpa|consent/i,
];

function extractHighlights(content: string): string | null {
  if (!content) return null;
  
  // Clean the content
  let text = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Split and filter sentences
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 25);
  
  // Prefer basketball-relevant sentences
  const relevant = sentences.filter(s => {
    if (HIGHLIGHT_BLOCKLIST.some(re => re.test(s))) return false;
    return /\b(score[ds]?|points?|win|won|defeat|beat|lead|quarter|half|final|basket|rebound|assist|three|dunk)\b/i.test(s);
  }).slice(0, 4);
  
  if (relevant.length > 0) {
    return relevant.map(s => `• ${s}`).join('\n');
  }
  
  // Fallback: any clean non-boilerplate sentences
  const clean = sentences.filter(s => !HIGHLIGHT_BLOCKLIST.some(re => re.test(s))).slice(0, 3);
  return clean.length > 0 ? clean.map(s => `• ${s}`).join('\n') : null;
}

function extractWeatherDetails(content: string, isSurf: boolean): string | null {
  if (!content) return null;
  
  // Clean HTML
  let text = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (isSurf) {
    // Look for surf-specific info
    const surfPatterns = /\b(swell|wave|height|period|direction|wind|tide|conditions?)\b[^.]*\./gi;
    const matches = text.match(surfPatterns) || [];
    if (matches.length > 0) {
      return matches.slice(0, 6).map(m => `• ${m.trim()}`).join('\n');
    }
  }
  
  // Look for weather-specific info
  const weatherPatterns = /\b(temperature|high|low|forecast|rain|snow|wind|humidity|expect)\b[^.]*\./gi;
  const matches = text.match(weatherPatterns) || [];
  if (matches.length > 0) {
    return matches.slice(0, 5).map(m => `• ${m.trim()}`).join('\n');
  }
  
  // Fallback
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
  return sentences.slice(0, 4).map(s => `• ${s.trim()}`).join('\n');
}

function cleanWebContent(content: string): string {
  return content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default {
  enrichNbaGames,
  enrichWeather,
  enrichGenericQuery
};
