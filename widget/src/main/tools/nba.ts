/**
 * SADIE NBA Tools (balldontlie API)
 * Free NBA data: games, teams, players, stats
 * Docs: https://www.balldontlie.io/#get-all-games
 */

import { ToolDefinition, ToolHandler, ToolResult } from './types';
import * as https from 'https';
import * as zlib from 'zlib';
import { URL } from 'url';

export const nbaQueryDef: ToolDefinition = {
  name: 'nba_query',
  description: 'Query NBA data (games, teams, players, news, rosters). Uses ESPN public API by default (no keys required) and falls back to balldontlie if configured.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Type of query: games, teams, players, teams_roster, news',
        enum: ['games', 'teams', 'players', 'stats', 'roster', 'news']
      },
      query: {
        type: 'string',
        description: 'Search term (team name, player name, date, etc.)'
      },
      date: {
        type: 'string',
        description: 'Date for games/stats (YYYY-MM-DD)',
        default: ''
      },
      perPage: {
        type: 'number',
        description: 'Results per page (default: 5)',
        default: 5
      }
    },
    required: ['type']
  }
};

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SADIE/1.0',
      'Accept': 'application/json,text/html;q=0.9,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      ...headers
    }};
    https.get(url, options as any, res => {
      const chunks: Buffer[] = [];
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();

      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        try {
          let buf = Buffer.concat(chunks);
          if (encoding.includes('br')) buf = zlib.brotliDecompressSync(buf);
          else if (encoding.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (encoding.includes('deflate')) buf = zlib.inflateSync(buf);
          const text = buf.toString('utf8');
          try {
            resolve(JSON.parse(text));
          } catch {
            // Not JSON; return raw text
            resolve(text);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ESPN helpers
async function fetchEspnJson(path: string, params: Record<string, string | number> = {}) {
  const base = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return await httpsGet(url.toString());
}

async function findTeamByQuery(query: string) {
  try {
    const teams = await fetchEspnJson('/teams');
    if (!teams || !teams.sports) return null;
    const allTeams = (teams.sports[0]?.leagues?.[0]?.teams || []).map((t: any) => t.team);
    const q = query.toLowerCase();
    const found = allTeams.find((t: any) => [t.displayName, t.name, t.abbreviation, t.slug].some((s: string) => s && s.toLowerCase().includes(q)));
    return found || null;
  } catch {
    return null;
  }
}

async function findPlayerByName(query: string, perPage = 20) {
  // Try to find player by scanning rosters for a matching displayName
  const teamsResp = await fetchEspnJson('/teams');
  const allTeams = (teamsResp.sports?.[0]?.leagues?.[0]?.teams || []).map((t: any) => t.team);
  const q = query.toLowerCase();
  const found: any[] = [];
  for (const t of allTeams) {
    try {
      const roster = await fetchEspnJson(`/teams/${t.id}/roster`, { limit: perPage });
      const players = roster?.athletes || roster?.roster || roster?.items || [];
      for (const p of players) {
        const name = (p.displayName || p.fullName || '').toLowerCase();
        if (name.includes(q)) {
          found.push({ player: p, team: t });
          if (found.length >= perPage) break;
        }
      }
      if (found.length >= perPage) break;
    } catch {}
  }
  return found;
}

export const nbaQueryHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const type = args.type;
    const query = args.query || '';
    const date = args.date || '';
    const perPage = Math.min(Math.max(1, args.perPage || 5), 25);
    // Use ESPN endpoints for news/games/teams/roster/players when possible
    if (type === 'news') {
      // General NBA news or filtered by query
      const params: any = { limit: perPage };
      const news = await fetchEspnJson('/news', params);
      let items = news?.articles || news?.items || [];
      if (query) {
        const q = query.toLowerCase();
        items = items.filter((it: any) => (it?.headline || it?.title || '').toLowerCase().includes(q) || (it?.summary || '').toLowerCase().includes(q));
      }
      return { success: true, result: { query, resultCount: items.length, articles: items.slice(0, perPage) } };
    }

    if (type === 'games') {
      // Use ESPN scoreboard; date format: YYYYMMDD (or YYYY-MM-DD)
      const d = (date || '').replace(/-/g, '');
      const params: any = {};
      if (d) params.dates = d;
      const board = await fetchEspnJson('/scoreboard', params);
      let events = board?.events || [];

      // If no events found for the requested date/range, fall back to a
      // rolling 7-day window to avoid week-boundary and timezone issues.
      // If events empty and either no date was given, or the date token is a
      // fuzzy phrase like 'this week' / 'last week', fall back to a rolling
      // 7-day window to be tolerant of week-boundaries and timezone shifts.
      if ((!events || events.length === 0) && (!d || /week|last/i.test(d))) {
        const seen = new Set<string>();
        const agg: any[] = [];
        const now = new Date();
        for (let i = 0; i < 7; i++) {
          const dt = new Date(now);
          dt.setDate(now.getDate() - i);
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, '0');
          const day = String(dt.getDate()).padStart(2, '0');
          const dateParam = `${y}${m}${day}`;
          try {
            const b = await fetchEspnJson('/scoreboard', { dates: dateParam });
            const ev = b?.events || [];
            for (const e of ev) {
              const id = e?.id || JSON.stringify(e);
              if (!seen.has(id)) { seen.add(id); agg.push(e); }
            }
          } catch (e) { /* ignore individual date fetch errors */ }
        }
        events = agg;
      }
      if (query) {
        const q = query.toLowerCase();
        events = events.filter((e: any) => (e.name || '').toLowerCase().includes(q) || (e.shortName || '').toLowerCase().includes(q) || (e.competitions || []).some((c: any) => (c.competitors || []).some((co: any) => (co.team?.displayName || '').toLowerCase().includes(q))));
      }
      return { success: true, result: { query, resultCount: events.length, events } };
    }

    if (type === 'teams') {
      const teams = await fetchEspnJson('/teams');
      const allTeams = (teams.sports?.[0]?.leagues?.[0]?.teams || []).map((t: any) => t.team);
      return { success: true, result: { query, resultCount: allTeams.length, teams: allTeams } };
    }

    if (type === 'roster') {
      // find team by query, then fetch roster
      if (!query) return { success: false, error: 'roster type requires query (team name, slug or abbreviation)' };
      const found = await findTeamByQuery(query);
      if (!found) return { success: false, error: `Team not found: ${query}` };
      const path = `/teams/${found.id}/roster`;
      const roster = await fetchEspnJson(path, { limit: perPage });
      const entries = roster?.athletes || roster?.roster || roster?.items || [];
      return { success: true, result: { team: found, roster: entries } };
    }

    if (type === 'players') {
      // Attempt to find player by name via ESPN team rosters
      const found = await findPlayerByName(query, perPage);
      if (found && found.length > 0) {
        return { success: true, result: { query, resultCount: found.length, players: found } };
      }

      // Fallback to balldontlie if API key provided
      const balKey = process.env.BALDONTLIE_API_KEY || process.env.BALDONTLIE_KEY;
      if (balKey) {
        const url = `https://api.balldontlie.io/v1/players?per_page=${perPage}&search=${encodeURIComponent(query)}`;
        const result = await httpsGet(url, { Authorization: `Bearer ${balKey}` });
        return { success: true, result };
      }

      return { success: true, result: { query, resultCount: 0, players: [] } };
    }

    // Stats not implemented in ESPN tool (could be added later)
    if (type === 'stats') {
      return { success: false, error: 'Stats queries not implemented. Use players/games/roster/news.' };
    }

    return { success: false, error: 'Invalid type. Use games, teams, players, roster, or news.' };
  } catch (err: any) {
    return { success: false, error: `NBA query failed: ${err.message}` };
  }
};
