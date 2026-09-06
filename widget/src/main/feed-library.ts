/**
 * feed-library.ts — the saved feeds, merged with the built-in catalogue.
 *
 * WHY ONE LIST AND NOT TWO
 * ------------------------
 * `FEED_CATALOGUE` in tools/news.ts already carries a warning worth honouring:
 *
 *   "two catalogues would drift, and the panel would advertise a source chat
 *    could not read, or vice versa."
 *
 * So this does not introduce a second catalogue. It adds a *user* layer and
 * merges, and everything downstream — the `news` tool, `list_news_feeds`, the
 * Media Studio picker — reads the merged view through `listFeeds()`. A feed the
 * panel shows is a feed chat can fetch, by construction rather than by
 * discipline.
 *
 * WHY JSON ON DISK
 * ----------------
 * Same reasoning as the movie projects: inspectable when something goes wrong,
 * survives a crash, diffable, and needs no schema migration. It lives beside
 * user-settings.json under userData/config.
 *
 * WHAT A BUILT-IN IS
 * ------------------
 * Built-ins cannot be deleted, only hidden — otherwise a stray remove leaves the
 * app with fewer sources than it shipped with and no way back. Hiding is
 * reversible; deleting a constant is not.
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { FEED_CATALOGUE } from './tools/news';

export type FeedKind = 'news' | 'podcast';

export interface FeedEntry {
  /** Stable id. Built-ins keep their catalogue key so existing calls still work. */
  key: string;
  url: string;
  description: string;
  kind: FeedKind;
  /** True for FEED_CATALOGUE entries — hideable, never deletable. */
  builtin: boolean;
  addedAt?: string;
  lastFetchedAt?: string;
  /** Episode/item count from the last successful fetch. Purely informational. */
  lastItemCount?: number;
}

interface StoredLibrary {
  version: 1;
  /** Only user-added feeds live here. Built-ins come from the constant. */
  feeds: Record<string, Omit<FeedEntry, 'builtin'>>;
  /** Keys of built-ins the user has hidden. */
  hidden: string[];
}

const EMPTY: StoredLibrary = { version: 1, feeds: {}, hidden: [] };

function storePath(): string {
  return path.join(app.getPath('userData'), 'config', 'feed-library.json');
}

function read(): StoredLibrary {
  try {
    const raw = fs.readFileSync(storePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoredLibrary>;
    return {
      version: 1,
      feeds: parsed.feeds ?? {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    };
  } catch {
    // Missing, unreadable or corrupt all mean the same thing here: no user
    // feeds yet. The built-ins still work, so this must never throw.
    return { ...EMPTY };
  }
}

function write(lib: StoredLibrary): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(lib, null, 2), 'utf-8');
}

/** Normalise a key so "BBC News" and "bbc-news" cannot become two feeds. */
export function normaliseKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Every feed the app knows about: built-ins that are not hidden, plus the
 * user's own. This is the single source everything downstream reads.
 */
export function listFeeds(includeHidden = false): FeedEntry[] {
  const lib = read();
  const out: FeedEntry[] = [];

  for (const [key, val] of Object.entries(FEED_CATALOGUE)) {
    if (!includeHidden && lib.hidden.includes(key)) continue;
    out.push({ key, url: val.url, description: val.description, kind: 'news', builtin: true });
  }
  for (const [key, val] of Object.entries(lib.feeds)) {
    out.push({ ...val, key, builtin: false });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function findFeed(key: string): FeedEntry | undefined {
  const k = normaliseKey(key);
  return listFeeds(true).find((f) => f.key === k);
}

export interface AddFeedInput {
  key?: string;
  url: string;
  description?: string;
  kind?: FeedKind;
}

export function addFeed(input: AddFeedInput): FeedEntry {
  const url = input.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`feed url must start with http:// or https:// — got ${url || '(empty)'}`);
  }
  const key = normaliseKey(input.key || deriveKey(url));
  if (!key) throw new Error('could not derive a key from that url; pass one explicitly');

  const lib = read();
  if (FEED_CATALOGUE[key]) {
    throw new Error(`'${key}' is a built-in feed; pick another key`);
  }
  const entry: Omit<FeedEntry, 'builtin'> = {
    key,
    url,
    description: (input.description || '').trim() || url,
    kind: input.kind ?? 'podcast',
    addedAt: new Date().toISOString(),
  };
  lib.feeds[key] = entry;
  write(lib);
  return { ...entry, builtin: false };
}

/** Removes a user feed, or hides a built-in. Built-ins are never deleted. */
export function removeFeed(key: string): { removed: boolean; hidden: boolean } {
  const k = normaliseKey(key);
  const lib = read();
  if (lib.feeds[k]) {
    delete lib.feeds[k];
    write(lib);
    return { removed: true, hidden: false };
  }
  if (FEED_CATALOGUE[k]) {
    if (!lib.hidden.includes(k)) {
      lib.hidden.push(k);
      write(lib);
    }
    return { removed: false, hidden: true };
  }
  return { removed: false, hidden: false };
}

export function unhideFeed(key: string): boolean {
  const k = normaliseKey(key);
  const lib = read();
  const i = lib.hidden.indexOf(k);
  if (i === -1) return false;
  lib.hidden.splice(i, 1);
  write(lib);
  return true;
}

/** Records a successful fetch. Best-effort — never throws into a fetch path. */
export function noteFetched(key: string, itemCount: number): void {
  try {
    const k = normaliseKey(key);
    const lib = read();
    if (!lib.feeds[k]) return; // built-ins have no writable row
    lib.feeds[k].lastFetchedAt = new Date().toISOString();
    lib.feeds[k].lastItemCount = itemCount;
    write(lib);
  } catch {
    /* telemetry, not correctness */
  }
}

function deriveKey(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return normaliseKey(host.split('.')[0]);
  } catch {
    return '';
  }
}
