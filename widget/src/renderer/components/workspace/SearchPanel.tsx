/**
 * SearchPanel — search across every file in the open workspace, with a replace
 * preview that shows exactly what each accepted match becomes before a single
 * byte is written.
 *
 * The ENGINE is the one `grep_code` uses: this panel goes through the
 * `homebot:workspace:search` IPC to `runCodeSearch`, so a person clicking
 * "Search" and an assistant calling `grep_code` cannot get two different
 * answers for the same query — same sandbox, same skip-list, same ripgrep-
 * with-Node-fallback. A second search implementation is exactly how this
 * codebase's defects arrive.
 *
 * Replace is line-exact. The preview is computed here so the user sees it, but
 * the write is guarded in the main process: each edit carries the line's text
 * as the search saw it, and any line that has moved on is skipped and reported
 * instead of clobbered. Ctrl+Shift+F opens this view from anywhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';

interface SearchMatch {
  file: string;
  path: string;
  line: number;
  text: string;
}

interface SearchPanelProps {
  /** Absolute root the search walks. */
  root: string;
  /** Open a file in the editor, landing on this line. */
  onOpenFile: (path: string, line?: number) => void;
  /** Notified when a replace finishes, so the shell can show a status. */
  onReplaced?: (summary: string) => void;
  /**
   * Bumped by the shell when Ctrl+Shift+F is pressed, so this panel focuses its
   * query box — including the case where the hotkey is what opened it.
   */
  focusToken?: number;
}

interface ReplaceReport {
  text: string;
  tone: 'ok' | 'warn';
}

/**
 * The replacement for one matched line. Computed here for the PREVIEW and again
 * nowhere else — the main process only asserts the line is unchanged and writes
 * whatever the preview showed, so what a person sees is what gets written.
 */
function applyReplacement(line: string, query: string, replacement: string, isRegex: boolean, caseSensitive: boolean): string {
  if (isRegex) {
    try {
      // Global so every occurrence on the line is replaced, matching what the
      // search highlighted.
      const re = new RegExp(query, (caseSensitive ? '' : 'i') + 'g');
      return line.replace(re, replacement);
    } catch {
      // An invalid regex falls back to literal — the search itself already did.
      return line.split(query).join(replacement);
    }
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return line;
  if (caseSensitive) return line.split(query).join(replacement);
  // Case-insensitive literal, preserving the matched text's own casing span:
  // split/join on a lowercased copy keeps the original letters in the output.
  const lower = line.toLowerCase();
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const hit = lower.indexOf(needle, i);
    if (hit === -1) { out.push(line.slice(i)); break; }
    out.push(line.slice(i, hit));
    out.push(replacement);
    i = hit + needle.length;
  }
  return out.join('');
}

/** Matched ranges within a line, for highlighting. Empty = nothing to paint. */
function matchRanges(line: string, query: string, isRegex: boolean, caseSensitive: boolean): Array<[number, number]> {
  if (!query) return [];
  const ranges: Array<[number, number]> = [];
  if (isRegex) {
    try {
      const re = new RegExp(query, (caseSensitive ? '' : 'i') + 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (m.index === m.index + m[0].length) { re.lastIndex++; continue; }
        ranges.push([m.index, m.index + m[0].length]);
      }
    } catch { /* invalid regex — fall through to literal */ }
  }
  if (ranges.length) return ranges;
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];
  const hay = caseSensitive ? line : line.toLowerCase();
  let i = 0;
  while (i <= hay.length) {
    const hit = hay.indexOf(needle, i);
    if (hit === -1) break;
    ranges.push([hit, hit + needle.length]);
    i = hit + needle.length;
  }
  return ranges;
}

function highlight(line: string, ranges: Array<[number, number]>, keyPrefix: string) {
  if (!ranges.length) return <>{line}</>;
  const out: JSX.Element[] = [];
  let cursor = 0;
  ranges.forEach(([s, e], i) => {
    if (s > cursor) out.push(<span key={`${keyPrefix}-t${i}`}>{line.slice(cursor, s)}</span>);
    out.push(<mark className="ws-search-mark" key={`${keyPrefix}-m${i}`}>{line.slice(s, e)}</mark>);
    cursor = e;
  });
  if (cursor < line.length) out.push(<span key={`${keyPrefix}-end`}>{line.slice(cursor)}</span>);
  return <>{out}</>;
}

export default function SearchPanel({ root, onOpenFile, onReplaced, focusToken }: SearchPanelProps) {
  const api = (window as any).electron;
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [includeGlob, setIncludeGlob] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [report, setReport] = useState<ReplaceReport | null>(null);
  const [ran, setRan] = useState(false);

  const queryInputRef = useRef<HTMLInputElement | null>(null);

  // Ctrl+Shift+F is owned by the shell (it has to open this view first); it
  // bumps focusToken, and that is what lands the cursor here.
  useEffect(() => {
    if (focusToken === undefined || focusToken === 0) return;
    queryInputRef.current?.focus();
    queryInputRef.current?.select();
  }, [focusToken]);

  const runSearch = useCallback(async () => {
    const pattern = query.trim();
    if (!pattern) { setError('Type something to search for.'); return; }
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await api?.workspaceSearch?.({
        pattern,
        directory: root,
        file_pattern: includeGlob.trim(),
        case_sensitive: caseSensitive,
      });
      if (!res?.success) { setError(res?.error || 'Search failed.'); setResults([]); setChecked(new Set()); }
      else {
        const matches: SearchMatch[] = Array.isArray(res.matches) ? res.matches : [];
        setResults(matches);
        // Everything is checked by default — "replace all" is the common case,
        // and unchecking is how you exclude a file.
        setChecked(new Set(matches.map((_, i) => i)));
      }
    } catch (e: any) {
      setError(e?.message || 'Search failed.');
      setResults([]);
      setChecked(new Set());
    } finally {
      setLoading(false);
      setRan(true);
    }
  }, [api, query, root, includeGlob, caseSensitive]);

  const grouped = useMemo(() => {
    const byFile = new Map<string, { file: string; path: string; rows: Array<{ index: number; match: SearchMatch }> }>();
    results.forEach((match, index) => {
      let entry = byFile.get(match.path);
      if (!entry) {
        entry = { file: match.file, path: match.path, rows: [] };
        byFile.set(match.path, entry);
      }
      entry.rows.push({ index, match });
    });
    return [...byFile.values()];
  }, [results]);

  const checkedCount = checked.size;

  const toggle = (index: number) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  const toggleFile = (rows: Array<{ index: number }>) => setChecked(prev => {
    const next = new Set(prev);
    const allOn = rows.every(r => next.has(r.index));
    rows.forEach(r => { if (allOn) next.delete(r.index); else next.add(r.index); });
    return next;
  });

  const applyReplace = useCallback(async () => {
    if (!replacement.length) { setReport({ text: 'Nothing to replace with — the replacement is empty.', tone: 'warn' }); return; }
    // Group accepted matches by file: one write per file, bottom-up inside it.
    const perFile = new Map<string, Array<{ line: number; oldText: string; newText: string }>>();
    results.forEach((m, index) => {
      if (!checked.has(index)) return;
      const newText = applyReplacement(m.text, query.trim(), replacement, isRegex, caseSensitive);
      if (newText === m.text) return;
      let arr = perFile.get(m.path);
      if (!arr) { arr = []; perFile.set(m.path, arr); }
      arr.push({ line: m.line, oldText: m.text, newText });
    });
    if (perFile.size === 0) { setReport({ text: 'No checked match would change.', tone: 'warn' }); return; }

    let applied = 0;
    const skipped: Array<{ line: number; reason: string }> = [];
    for (const [filePath, edits] of perFile) {
      const res = await api?.workspaceReplace?.(filePath, edits);
      if (res?.success) {
        applied += res.applied ?? 0;
        if (Array.isArray(res.skipped)) skipped.push(...res.skipped);
      } else {
        skipped.push({ line: 0, reason: res?.error || 'the file could not be written' });
      }
    }
    const parts = [`${applied} replacement${applied === 1 ? '' : 's'} written`];
    if (skipped.length) parts.push(`${skipped.length} skipped (${skipped[0].reason})`);
    const text = parts.join(' · ');
    onReplaced?.(text);
    // The list must describe the files as they now are, not as they were —
    // refreshed first because runSearch clears a stale report on the way in.
    await runSearch();
    setReport({ text, tone: skipped.length ? 'warn' : 'ok' });
  }, [api, checked, results, query, replacement, isRegex, caseSensitive, onReplaced, runSearch]);

  const showPreview = replaceMode && query.trim().length > 0;

  return (
    <div className="ws-search" aria-label="Search across files">
      <div className="ws-search-row">
        <input
          ref={queryInputRef}
          type="text"
          className="ws-search-input"
          placeholder="Search"
          value={query}
          aria-label="Search query"
          data-testid="ws-search-query"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
        />
        <button
          type="button"
          className={`ws-search-toggle${replaceMode ? ' active' : ''}`}
          title={replaceMode ? 'Hide replace' : 'Show replace'}
          aria-label={replaceMode ? 'Hide replace' : 'Show replace'}
          aria-pressed={replaceMode}
          data-testid="ws-search-replace-toggle"
          onClick={() => setReplaceMode(v => !v)}
        >
          <Icon name="pencil" size={15} />
        </button>
        <button
          type="button"
          className="ws-search-go"
          disabled={loading || !query.trim()}
          aria-label="Run search"
          data-testid="ws-search-run"
          onClick={() => void runSearch()}
        >
          {loading ? <Icon name="spinner" size={15} /> : <Icon name="search" size={15} />}
        </button>
      </div>

      {showPreview && (
        <div className="ws-search-row">
          <input
            type="text"
            className="ws-search-input"
            placeholder="Replace"
            value={replacement}
            aria-label="Replacement text"
            data-testid="ws-search-replacement"
            onChange={e => setReplacement(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void applyReplace(); } }}
          />
          <button
            type="button"
            className="ws-search-replace-all"
            disabled={loading || checkedCount === 0 || !replacement}
            aria-label="Replace all checked matches"
            data-testid="ws-search-replace-all"
            onClick={() => void applyReplace()}
          >
            Replace {checkedCount > 0 ? checkedCount : ''}
          </button>
        </div>
      )}

      <div className="ws-search-opts">
        <input
          type="text"
          className="ws-search-glob"
          placeholder="Include: *.ts"
          value={includeGlob}
          aria-label="Include file pattern"
          data-testid="ws-search-glob"
          onChange={e => setIncludeGlob(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
        />
        <button
          type="button"
          className={`ws-search-chip${caseSensitive ? ' active' : ''}`}
          aria-pressed={caseSensitive}
          title="Match case"
          onClick={() => setCaseSensitive(v => !v)}
        >Aa</button>
        <button
          type="button"
          className={`ws-search-chip${isRegex ? ' active' : ''}`}
          aria-pressed={isRegex}
          title="Use regular expressions"
          onClick={() => setIsRegex(v => !v)}
        >.*</button>
      </div>

      {error && <div className="ws-search-error" role="alert">{error}</div>}
      {report && !error && (
        <div
          className={report.tone === 'warn' ? 'ws-search-note' : 'ws-search-note ok'}
          role="status"
          data-testid="ws-search-report"
        >
          {report.text}
        </div>
      )}

      {grouped.length > 0 && (
        <div className="ws-search-count" role="status">
          {results.length} result{results.length === 1 ? '' : 's'} in {grouped.length} file{grouped.length === 1 ? '' : 's'}
        </div>
      )}

      <div className="ws-search-results" data-testid="ws-search-results">
        {grouped.map(group => {
          const fileRowsOn = group.rows.filter(r => checked.has(r.index)).length;
          return (
            <div className="ws-search-file" key={group.path}>
              <div className="ws-search-file-head">
                <label className="ws-search-check">
                  <input
                    type="checkbox"
                    checked={fileRowsOn === group.rows.length && group.rows.length > 0}
                    aria-label={`Select all matches in ${group.file}`}
                    data-testid={`ws-search-file-check-${group.file}`}
                    onChange={() => toggleFile(group.rows)}
                  />
                </label>
                <button
                  type="button"
                  className="ws-search-file-name"
                  title={group.path}
                  onClick={() => onOpenFile(group.path)}
                >
                  {group.file}
                </button>
                <span className="ws-search-file-count">{group.rows.length}</span>
              </div>
              {group.rows.map(({ index, match }) => {
                const ranges = matchRanges(match.text, query.trim(), isRegex, caseSensitive);
                const previewText = showPreview
                  ? applyReplacement(match.text, query.trim(), replacement, isRegex, caseSensitive)
                  : null;
                return (
                  <div className="ws-search-row-item" key={`${match.path}::${match.line}`}>
                    <label className="ws-search-check">
                      <input
                        type="checkbox"
                        checked={checked.has(index)}
                        aria-label={`Match on line ${match.line} of ${group.file}`}
                        onChange={() => toggle(index)}
                      />
                    </label>
                    <button
                      type="button"
                      className="ws-search-line"
                      data-testid={`ws-search-match-${group.file}-${match.line}`}
                      onClick={() => onOpenFile(match.path, match.line)}
                    >
                      <span className="ws-search-line-num">{match.line}</span>
                      <span className="ws-search-line-text">
                        {highlight(match.text, ranges, `o${index}`)}
                        {showPreview && previewText !== null && previewText !== match.text && (
                          <span className="ws-search-preview">
                            {'  →  '}
                            <span className="ws-search-preview-text">{previewText}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
        {ran && grouped.length === 0 && !error && !loading && (
          <div className="ws-search-empty">No matches.</div>
        )}
        {!ran && !error && (
          <div className="ws-search-empty">
            Search every file in {root.split(/[\\/]/).pop() || root}.
            <span className="ws-search-empty-sub">Enter runs the search · Ctrl+Shift+F focuses it from anywhere</span>
          </div>
        )}
      </div>
    </div>
  );
}
