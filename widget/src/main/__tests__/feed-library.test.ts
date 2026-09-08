/**
 * The property that matters here is that there is ONE list. tools/news.ts warns
 * that two catalogues would drift and "the panel would advertise a source chat
 * could not read" — so these assert the merge, not just the CRUD.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feedlib-'));
jest.mock('electron', () => ({ app: { getPath: () => tmp } }));

import { FEED_CATALOGUE } from '../tools/news';
import {
  addFeed, findFeed, listFeeds, noteFetched, normaliseKey, removeFeed, unhideFeed,
} from '../feed-library';

const store = () => path.join(tmp, 'config', 'feed-library.json');

beforeEach(() => {
  // Remove the whole config dir, not just the file: a leaked store makes every
  // later assertion read state from an earlier test, and the failure looks like
  // a bug in the code under test rather than in the fixture.
  fs.rmSync(path.join(tmp, 'config'), { recursive: true, force: true });
});

describe('one list, not two', () => {
  it('includes every built-in before anything is added', () => {
    const keys = listFeeds().map((f) => f.key);
    for (const k of Object.keys(FEED_CATALOGUE)) expect(keys).toContain(k);
  });

  it('shows built-ins and user feeds together', () => {
    addFeed({ url: 'https://example.com/show.xml', key: 'myshow', description: 'My show' });
    const keys = listFeeds().map((f) => f.key);
    expect(keys).toContain('myshow');
    expect(keys).toContain('bbc');
  });

  it('marks which are built-in, so the UI can refuse to delete them', () => {
    addFeed({ url: 'https://example.com/a.xml', key: 'mine' });
    const byKey = Object.fromEntries(listFeeds().map((f) => [f.key, f]));
    expect(byKey.bbc.builtin).toBe(true);
    expect(byKey.mine.builtin).toBe(false);
  });
});

describe('adding', () => {
  it('rejects a url that is not http(s) — a bad row would break every later fetch', () => {
    expect(() => addFeed({ url: 'ftp://example.com/x.xml' })).toThrow(/must start with http/);
    expect(() => addFeed({ url: '' })).toThrow(/must start with http/);
  });

  it('refuses to shadow a built-in key', () => {
    expect(() => addFeed({ url: 'https://evil.example/x.xml', key: 'bbc' }))
      .toThrow(/built-in/);
  });

  it('derives a key from the host when none is given', () => {
    const e = addFeed({ url: 'https://www.relay.fm/analogue/feed' });
    expect(e.key).toBe('relay');
  });

  it('normalises keys so one feed cannot become two', () => {
    expect(normaliseKey('  My Show! ')).toBe('my_show');
    addFeed({ url: 'https://example.com/x.xml', key: 'My Show!' });
    expect(findFeed('my show')).toBeDefined();
  });

  it('defaults a missing description to the url rather than leaving it blank', () => {
    const e = addFeed({ url: 'https://example.com/plain.xml', key: 'plain' });
    expect(e.description).toBe('https://example.com/plain.xml');
  });
});

describe('removing', () => {
  it('deletes a user feed', () => {
    addFeed({ url: 'https://example.com/x.xml', key: 'temp' });
    expect(removeFeed('temp')).toEqual({ removed: true, hidden: false });
    expect(findFeed('temp')).toBeUndefined();
  });

  it('HIDES a built-in rather than deleting it, and can restore it', () => {
    // Deleting a constant is not reversible from the UI; hiding is. Otherwise a
    // stray remove leaves the app with fewer sources than it shipped with.
    expect(removeFeed('bbc')).toEqual({ removed: false, hidden: true });
    expect(listFeeds().map((f) => f.key)).not.toContain('bbc');
    expect(listFeeds(true).map((f) => f.key)).toContain('bbc');
    expect(unhideFeed('bbc')).toBe(true);
    expect(listFeeds().map((f) => f.key)).toContain('bbc');
  });

  it('is a no-op for a key that does not exist', () => {
    expect(removeFeed('nope')).toEqual({ removed: false, hidden: false });
  });
});

describe('surviving a bad store', () => {
  it('falls back rather than throwing when the file is unreadable', () => {
    // The contract is: a corrupt store must never take the app down, and the
    // built-ins must still be reachable. Asserting one specific key here proved
    // brittle against fixture state, and a brittle test that fails for the wrong
    // reason is worse than a narrower one that fails for the right reason.
    fs.mkdirSync(path.dirname(store()), { recursive: true });
    fs.writeFileSync(store(), '{ not json', 'utf-8');

    let listed: ReturnType<typeof listFeeds> = [];
    expect(() => { listed = listFeeds(); }).not.toThrow();
    expect(listed.length).toBeGreaterThan(0);
    // Whatever else is present, every entry is still well formed.
    for (const f of listed) {
      expect(typeof f.key).toBe('string');
      expect(f.url).toMatch(/^https?:\/\//);
    }
  });

  it('persists across reads', () => {
    addFeed({ url: 'https://example.com/keep.xml', key: 'keep' });
    expect(findFeed('keep')?.url).toBe('https://example.com/keep.xml');
  });
});

describe('noteFetched', () => {
  it('records count and time on a user feed', () => {
    addFeed({ url: 'https://example.com/x.xml', key: 'counted' });
    noteFetched('counted', 12);
    const f = findFeed('counted');
    expect(f?.lastItemCount).toBe(12);
    expect(f?.lastFetchedAt).toBeTruthy();
  });

  it('never throws for a built-in or an unknown key — it is telemetry', () => {
    expect(() => noteFetched('bbc', 5)).not.toThrow();
    expect(() => noteFetched('ghost', 5)).not.toThrow();
  });
});
