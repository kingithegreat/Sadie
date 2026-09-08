/**
 * Does a feed the user adds actually REACH anything?
 *
 * feed-library.ts had fifteen passing tests and was imported by nothing. The
 * store worked perfectly and no production path could see it — the defect this
 * codebase produces most often, and one that a green test suite actively hides.
 *
 * So these tests deliberately do not test the library. They test the three
 * places that answer "what feeds are there", and they assert a feed added
 * through the library comes back out of each one:
 *
 *   1. list_news_feeds   — what chat is told it can read
 *   2. get_news          — what chat can actually fetch
 *   3. catalogueSources  — what the Feeds panel offers
 *   4. resolveSource     — what a saved reading list resolves against
 *
 * If any of these regress to reading FEED_CATALOGUE directly, "my feeds" and
 * "the feeds chat knows about" become two lists again, and the panel advertises
 * a source chat cannot read.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feedwire-'));
jest.mock('electron', () => ({ app: { getPath: () => tmp } }));

import { addFeed, removeFeed, FEED_CATALOGUE } from '../feed-library';
import { listNewsFeedsHandler, getNewsHandler } from '../tools/news';
import { catalogueSources, resolveSource } from '../feed-reader';

const MINE = { url: 'https://example.com/mine.xml', key: 'mine', description: 'My own feed' };

beforeEach(() => {
  fs.rmSync(path.join(tmp, 'config'), { recursive: true, force: true });
});

describe('a user feed reaches chat', () => {
  it('list_news_feeds offers it', async () => {
    addFeed(MINE);
    const res = await listNewsFeedsHandler({}, {} as never);
    const keys = (res.result as Array<{ key: string }>).map((f) => f.key);
    expect(keys).toContain('mine');
    expect(keys).toContain('bbc');          // and has not lost the built-ins
  });

  it('list_news_feeds marks which are built-in, so a UI can refuse to delete them', async () => {
    addFeed(MINE);
    const res = await listNewsFeedsHandler({}, {} as never);
    const byKey = Object.fromEntries(
      (res.result as Array<{ key: string; builtin: boolean }>).map((f) => [f.key, f])
    );
    expect(byKey.mine.builtin).toBe(false);
    expect(byKey.bbc.builtin).toBe(true);
  });

  it("get_news does not reject the user's own key as unknown", async () => {
    addFeed(MINE);
    // The fetch itself will fail — example.com serves no RSS and there is no
    // network here. What matters is WHICH failure: "unknown source" means the
    // key never resolved, which is the regression this file exists to catch.
    const res = await getNewsHandler({ source: 'mine' }, {} as never);
    expect(String(res.error ?? '')).not.toMatch(/Unknown source/i);
  });

  it('an unknown key is still rejected, and lists what IS available', async () => {
    addFeed(MINE);
    const res = await getNewsHandler({ source: 'not_a_feed_at_all' }, {} as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unknown source/i);
    expect(res.error).toContain('mine');    // the offer includes user feeds
  });
});

describe('a user feed reaches the Feeds panel', () => {
  it('catalogueSources offers it alongside the built-ins', () => {
    addFeed(MINE);
    const ids = catalogueSources().map((s) => s.id);
    expect(ids).toContain('mine');
    expect(ids).toContain('bbc');
  });

  it('resolveSource resolves it to its url', () => {
    addFeed(MINE);
    expect(resolveSource('mine')).toEqual({ name: 'mine', url: MINE.url });
  });

  it('resolveSource still takes a pasted url, and still refuses file://', () => {
    expect(resolveSource('https://example.org/x.xml')?.url).toBe('https://example.org/x.xml');
    // A file:// here would read local files through a box that looks like it
    // only takes web addresses.
    expect(resolveSource('file:///etc/passwd')).toBeNull();
  });
});

describe('hiding a built-in', () => {
  it('removes it from what the panel offers', () => {
    removeFeed('bbc');
    expect(catalogueSources().map((s) => s.id)).not.toContain('bbc');
  });

  it('does NOT break a saved reading list that already names it', () => {
    // Hiding is a display choice. If it also broke resolution, a list saved
    // last week would silently start returning fewer sources, which reads as a
    // quiet news day rather than as a setting the user changed.
    removeFeed('bbc');
    expect(resolveSource('bbc')).toEqual({
      name: 'bbc',
      url: FEED_CATALOGUE.bbc.url
    });
  });
});
