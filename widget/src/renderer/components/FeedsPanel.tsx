/**
 * Reading and searching RSS feeds.
 *
 * HomeBot could already read feeds — `fetchFeedXml`, `parsePodcastFeed` and a
 * catalogue of named sources in `tools/news.ts` — but the only ways in were the
 * model calling a tool and a "paste a podcast feed" box buried in Media Studio.
 * A person could not look through their feeds and find something.
 *
 * Searching happens against the list already in memory, so typing is instant and
 * costs no network. Fetching is the only thing that goes out.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { searchFeedItems, type FeedItem } from '../../shared/feed-search';

interface FeedSource {
  id: string;
  description: string;
}

interface FeedsPanelProps {
  /**
   * Context handed over when the assistant sent the user here — `query` to
   * search for, `sources` to read. Keys it does not understand are ignored.
   */
  navContext?: Record<string, unknown> | null;
}

export default function FeedsPanel({ navContext }: FeedsPanelProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [customUrl, setCustomUrl] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState<Array<{ source: string; reason: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (which?: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron?.fetchFeeds?.(which);
      if (!result?.success) {
        setError(result?.error || 'Could not read feeds.');
        setItems([]);
        setFailures([]);
        return;
      }
      setItems(result.items || []);
      // Surfaced rather than swallowed: a reading list quietly missing one of
      // five feeds looks like a slow news day.
      setFailures(result.failures || []);
    } catch {
      setError('Could not read feeds.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.electron?.listFeedSources?.()
      .then(r => setSources(r?.sources || []))
      .catch(() => { /* the catalogue is a convenience; a URL still works */ });
    load();
  }, [load]);

  // Arriving from chat with something already in mind — "show me the tech news"
  // should land on results, not an empty box the user has to retype into.
  useEffect(() => {
    if (!navContext) return;
    const q = typeof navContext.query === 'string' ? navContext.query.trim() : '';
    const s = Array.isArray(navContext.sources)
      ? (navContext.sources as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (q) setQuery(prev => prev || q);
    if (s.length > 0) {
      setSelected(s);
      load(s);
    }
  }, [navContext, load]);

  const results = useMemo(() => searchFeedItems(items, query), [items, query]);

  const toggleSource = (id: string) => {
    setSelected(prev => {
      const next = prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id];
      load(next.length > 0 ? next : undefined);
      return next;
    });
  };

  const addCustom = () => {
    const url = customUrl.trim();
    if (!url) return;
    const next = [...selected, url];
    setSelected(next);
    setCustomUrl('');
    load(next);
  };

  return (
    <div className="feeds-panel">
      <div className="feeds-header">
        <input
          type="search"
          className="setting-input feeds-search"
          data-testid="feed-search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search everything below…"
          aria-label="Search feed items"
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => load(selected.length > 0 ? selected : undefined)}
          disabled={loading}
        >
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      <div className="feeds-sources">
        {sources.map(s => (
          <button
            key={s.id}
            type="button"
            className={`feeds-source-chip${selected.includes(s.id) ? ' active' : ''}`}
            onClick={() => toggleSource(s.id)}
            title={s.description}
          >
            {s.id}
          </button>
        ))}
        <input
          type="text"
          className="setting-input feeds-custom-url"
          value={customUrl}
          onChange={e => setCustomUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addCustom(); }}
          placeholder="…or paste any feed address"
          aria-label="Add a feed by address"
        />
      </div>

      {error && <div className="feeds-error">{error}</div>}

      {failures.length > 0 && (
        <div className="feeds-failures">
          {failures.map(f => (
            <div key={f.source} className="feeds-failure">
              <strong>{f.source}</strong> could not be read — {f.reason}
            </div>
          ))}
        </div>
      )}

      <div className="feeds-results">
        {loading && items.length === 0 && <div className="feeds-empty">Reading your feeds…</div>}

        {!loading && results.length === 0 && items.length > 0 && (
          // Distinct from having no feeds at all: the search is what came up
          // empty, and saying so tells the user to change the words.
          <div className="feeds-empty">
            Nothing matches “{query}”. {items.length} item(s) loaded — try different words.
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="feeds-empty">No items yet. Pick a source above, or paste a feed address.</div>
        )}

        {results.map((item, i) => (
          <article className="feeds-item" key={`${item.link || item.title}-${i}`}>
            <div className="feeds-item-meta">
              <span className="feeds-item-source">{item.source}</span>
              {item.published && <span className="feeds-item-date">{item.published}</span>}
            </div>
            <h3 className="feeds-item-title">
              {item.link ? (
                <a
                  href={item.link}
                  onClick={e => {
                    // Opening in the app would replace the reading list with the
                    // article and lose the search. This is a link out.
                    e.preventDefault();
                    window.electron?.openExternalUrl?.(item.link);
                  }}
                >
                  {item.title}
                </a>
              ) : item.title}
            </h3>
            {item.summary && <p className="feeds-item-summary">{item.summary.slice(0, 320)}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}
