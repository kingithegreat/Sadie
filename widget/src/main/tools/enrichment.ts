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
  /** Output format preference (e.g. 'table') */
  format?: string;
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
  const { maxWebResults = 3, fetchContent = true, context, format } = options;
  
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
  
  // Build search query for enrichment — always include today's date to avoid stale results
  const todayStr = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const searchQuery = options.customQuery ||
    (query ? `NBA ${query} box score highlights ${todayStr}` :
     teamNames.length > 0 ? `NBA ${teamNames.slice(0, 2).join(' ')} game recap highlights ${todayStr}` :
     `NBA games today scores highlights ${todayStr}`);

  // Skip web enrichment if every game is still pre-game — "highlights" for unplayed
  // games are nonsense and just drag in unrelated promo copy.
  const preGame = events.length > 0 && events.every((e: any) => e.status?.type?.state === 'pre');

  // Fetch web context
  let webContext: EnrichedResult['webContext'];
  try {
    if (!preGame) {
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
    }
  } catch (e) {
    console.error('[Enrichment] Web search failed:', e);
  }
  
  // Check if all games are still scheduled (no results yet)
  const allScheduled = events.length > 0 && events.every((e: any) => e.status?.type?.state === 'pre');

  // Build comprehensive summary
  const dateLabel = events[0]?.date
    ? new Date(events[0].date).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' })
    : '';

  let summary: string;

  if (format === 'table') {
    // Markdown table format
    summary = allScheduled
      ? `🏀 **NBA Tonight${dateLabel ? ` — ${dateLabel}` : ''} (ET)**\n_No games have finished yet — here's tonight's schedule:_\n\n`
      : `🏀 **NBA Games${dateLabel ? ` — ${dateLabel}` : ''}**\n\n`;

    if (events.length > 0) {
      summary += `| Away | Home | Score | Time / Status | Venue |\n`;
      summary += `|------|------|-------|---------------|-------|\n`;
      for (const ev of events.slice(0, 15)) {
        const comp = ev.competitions?.[0];
        const competitors = comp?.competitors || [];
        if (competitors.length < 2) continue;
        const sorted = [...competitors].sort((a: any, b: any) =>
          (a.homeAway === 'home' ? 1 : -1) - (b.homeAway === 'home' ? 1 : -1)
        );
        const away = sorted[0];
        const home = sorted[1];
        const awayName = away?.team?.displayName || 'Away';
        const homeName = home?.team?.displayName || 'Home';
        const awayRec = away?.records?.[0]?.summary || '';
        const homeRec = home?.records?.[0]?.summary || '';
        const isScheduled = ev.status?.type?.state === 'pre';
        const isFinal = ev.status?.type?.state === 'post';
        const isLive = ev.status?.type?.state === 'in';
        const awayScore = away?.score ?? '—';
        const homeScore = home?.score ?? '—';
        const score = isScheduled ? '—' : `${awayScore}–${homeScore}`;
        const statusShort = ev.status?.type?.shortDetail || ev.status?.type?.description || 'Scheduled';
        const gameTime = ev.date
          ? new Date(ev.date).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
          : '';
        const timeStr = isScheduled ? gameTime : `${statusShort}${isLive ? ' 🔴' : ''}${isFinal ? ' ✅' : ''}`;
        const venue = comp?.venue?.fullName || '—';
        const awayDisplay = awayRec ? `${awayName} (${awayRec})` : awayName;
        const homeDisplay = homeRec ? `${homeName} (${homeRec})` : homeName;
        summary += `| ${awayDisplay} | ${homeDisplay} | ${score} | ${timeStr} | ${venue} |\n`;
      }
    } else {
      summary += 'No games found for this query.\n';
    }
  } else {
    // Default emoji/text format
    summary = allScheduled
      ? `🏀 **NBA Tonight${dateLabel ? ` — ${dateLabel}` : ''} (ET)**\n_No games have finished yet — here's tonight's schedule:_\n\n`
      : `🏀 **NBA Games**\n\n`;
    
    if (formattedGames.length > 0) {
      summary += formattedGames.join('\n\n');
    } else {
      summary += 'No games found for this query.\n';
    }
  }

  // Helpful note when user asked about lineups but all games are scheduled
  // (ESPN only exposes starting lineups ~30 min before tipoff)
  const asksForLineups = /\b(line.?up|starting\s*5|starting\s*five|starters)\b/i.test(query);
  if (asksForLineups && allScheduled) {
    summary += `\n\n_ℹ️ Starting lineups are usually announced ~30 minutes before tipoff and aren't available yet. Try again closer to game time, or ask for team rosters instead._`;
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
    
    // Format nicely — records inline with team name, one fact per line
    const awayDisplay = awayRecord ? `**${awayTeam}** (${awayRecord})` : `**${awayTeam}**`;
    const homeDisplay = homeRecord ? `**${homeTeam}** (${homeRecord})` : `**${homeTeam}**`;
    formatted = `${awayDisplay} @ ${homeDisplay}${scoreStr}`;
    formatted += `\n📍 ${isScheduled ? gameTimeStr : statusShort}`;
    if (isFinal) formatted += ' ✅';
    if (isInProgress) formatted += ' 🔴 Live';
    
    // Add leaders if available
    const leaders = comp?.leaders || [];
    if (leaders.length > 0) {
      const pointsLeader = leaders.find((l: any) => l.name === 'points');
      if (pointsLeader?.leaders?.[0]) {
        const leader = pointsLeader.leaders[0];
        formatted += `\n🏆 ${leader.athlete?.displayName || 'Leader'}: ${leader.displayValue}`;
      }
    }

    // Add venue
    if (comp?.venue?.fullName) {
      formatted += `\n🏟️ ${comp.venue.fullName}`;
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
  /Image\s*\d+:/i,   // scraped image alt-text references
  /Prime Video|Paramount\+|Peacock|fuboTV/i,  // streaming service badges
  /NBA\s*2K|2K2[0-9]|HYPE IS HERE|FULL GAME HIGHLIGHTS/i,  // video game / YouTube video titles
  /\bWATCH\s+(NOW|LIVE|HERE)\b/i,
];

function extractHighlights(content: string): string | null {
  if (!content) return null;

  // Clean the content
  let text = content
    .replace(/<[^>]+>/g, ' ')
    // Strip inline image URL fragments (ESPN embeds img=/i/teamlogos/... in text)
    .replace(/img=[^\s)]+/gi, '')
    .replace(/\.png[?&][^\s)]+/gi, '')
    // Strip "Image N: ..." alt-text leaking from scraped pages
    .replace(/Image\s*\d+:\s*[^\n•]*?(Logo|Icon|Photo|Banner|Thumbnail)[^\n•]*/gi, '')
    .replace(/Image\s*\d+:[^\n•]{0,80}/gi, '')
    .replace(/\)[A-Z]{2,3}\s+\d{1,2}-\d{1,2}/g, (m) => m.replace(/^\)/, ''))  // fix ")NY 51-28" → "NY 51-28"
    .replace(/\s+/g, ' ')
    .trim();
  
  // Split and filter sentences
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 25);
  
  // Reject video-title-style lines (many pipe separators or heavy ALL-CAPS ratio)
  const looksLikeVideoTitle = (s: string): boolean => {
    if ((s.match(/\|/g) || []).length >= 2) return true;
    const letters = s.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 20) {
      const upper = letters.replace(/[^A-Z]/g, '').length;
      if (upper / letters.length > 0.6) return true;
    }
    return false;
  };

  // Prefer basketball-relevant sentences
  const relevant = sentences.filter(s => {
    if (HIGHLIGHT_BLOCKLIST.some(re => re.test(s))) return false;
    if (looksLikeVideoTitle(s)) return false;
    return /\b(score[ds]?|points?|win|won|defeat|beat|lead|quarter|half|final|basket|rebound|assist|three|dunk)\b/i.test(s);
  }).slice(0, 4);

  if (relevant.length > 0) {
    return relevant.map(s => `• ${s}`).join('\n');
  }

  // Fallback: any clean non-boilerplate sentences
  const clean = sentences.filter(s =>
    !HIGHLIGHT_BLOCKLIST.some(re => re.test(s)) && !looksLikeVideoTitle(s)
  ).slice(0, 3);
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
