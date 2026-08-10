/**
 * ChangesPanel — review what HomeBot changed in your files.
 *
 * The point of the whole feature: the app writes to your files, and until now
 * there was no way to see what it did. A list of touched files with a real
 * line diff is the difference between "an assistant edited my code" being
 * reassuring and being alarming.
 *
 * Read-only by design. This is a reviewer, not an editor — no revert button,
 * because a half-built undo over files git already tracks would be worse than
 * none. The Explorer is right there for editing.
 */

import { useCallback, useEffect, useState } from 'react';

interface ChangeRow {
  id: string;
  path: string;
  tool: string;
  at: number;
  created: boolean;
}

interface DiffLine {
  type: 'equal' | 'add' | 'remove';
  before: number | null;
  after: number | null;
  text: string;
}

interface Hunk {
  beforeStart: number;
  afterStart: number;
  lines: DiffLine[];
}

interface DiffResult {
  path?: string;
  tool?: string;
  created?: boolean;
  stats?: { added: number; removed: number; approximate: boolean };
  hunks?: Hunk[];
  error?: string;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function ChangesPanel({ onOpenFile }: { onOpenFile?: (path: string) => void }) {
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = (window as any).electron;

  const refresh = useCallback(async () => {
    try {
      const res = await api?.changesList?.();
      if (res?.success) { setRows(res.changes || []); setError(null); }
      else setError(res?.error || 'Could not read the change log.');
    } catch (e: any) {
      setError(e?.message || 'Could not read the change log.');
    }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll while the panel is open: changes arrive from tool calls, not from
  // anything this component does, so there is no event to hang off yet.
  useEffect(() => {
    const t = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const select = useCallback(async (id: string) => {
    setSelected(id);
    setDiff(null);
    try {
      const res = await api?.changesDiff?.(id);
      setDiff(res?.success ? res : { error: res?.error || 'Could not build the diff.' });
    } catch (e: any) {
      setDiff({ error: e?.message || 'Could not build the diff.' });
    }
  }, [api]);

  return (
    <div className="changes-panel">
      <div className="changes-list" role="list" aria-label="Changed files">
        {error && <p className="changes-error">{error}</p>}

        {!error && rows.length === 0 && (
          <p className="changes-empty">
            Nothing changed yet. Files HomeBot writes or edits appear here so you can
            check them.
          </p>
        )}

        {rows.map(r => (
          <button
            key={r.id}
            role="listitem"
            className={`changes-item${selected === r.id ? ' active' : ''}`}
            onClick={() => void select(r.id)}
            title={r.path}
          >
            <span className="changes-item-name">{baseName(r.path)}</span>
            <span className={`changes-badge ${r.created ? 'created' : 'edited'}`}>
              {r.created ? 'new' : r.tool === 'edit_file' ? 'edit' : 'write'}
            </span>
            <span className="changes-item-time">{clockTime(r.at)}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="changes-diff" aria-label="Diff">
          {diff?.error && <p className="changes-error">{diff.error}</p>}

          {diff?.stats && (
            <div className="changes-diff-head">
              <span className="changes-diff-path" title={diff.path}>{diff.path && baseName(diff.path)}</span>
              <span className="changes-stat add">+{diff.stats.added}</span>
              <span className="changes-stat remove">−{diff.stats.removed}</span>
              {onOpenFile && diff.path && (
                <button className="changes-open" onClick={() => onOpenFile(diff.path!)}>Open</button>
              )}
            </div>
          )}

          {/* Say so when the diff was coarsened, rather than showing an
              approximation as if it were exact. */}
          {diff?.stats?.approximate && (
            <p className="changes-note">
              This rewrite was too large to compare line by line, so the whole
              block is shown as replaced.
            </p>
          )}

          {diff?.hunks?.length === 0 && (
            <p className="changes-empty">No line changes — the content is identical.</p>
          )}

          {diff?.hunks?.map((h, i) => (
            <div className="changes-hunk" key={`${h.beforeStart}-${h.afterStart}-${i}`}>
              <div className="changes-hunk-head">@@ line {h.afterStart} @@</div>
              {h.lines.map((l, j) => (
                <div className={`changes-line ${l.type}`} key={j}>
                  <span className="changes-gutter">{l.before ?? ''}</span>
                  <span className="changes-gutter">{l.after ?? ''}</span>
                  <span className="changes-sign">{l.type === 'add' ? '+' : l.type === 'remove' ? '−' : ' '}</span>
                  <span className="changes-text">{l.text || ' '}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
