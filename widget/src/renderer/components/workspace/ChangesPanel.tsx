/**
 * ChangesPanel — review what HomeBot changed in your files.
 *
 * The point of the whole feature: the app writes to your files, and until now
 * there was no way to see what it did. A list of touched files with a real
 * line diff is the difference between "an assistant edited my code" being
 * reassuring and being alarming.
 *
 * Two sections. PROPOSED (IDE-3) is the gate: an assistant edit inside the
 * Workspace folder is held before it is written, and each hunk is accepted or
 * rejected here — reject and the file stays byte-identical, accept and exactly
 * those lines are written. CHANGED is the receipt: what was already written,
 * so a write elsewhere is still reviewable after the fact.
 *
 * No revert button on the written half: a half-built undo over files git
 * already tracks would be worse than none. The Explorer is right there.
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

interface Proposal {
  id: string;
  path: string;
  tool: string;
  at: number;
  created: boolean;
  stats: { added: number; removed: number; approximate: boolean };
  hunks: Hunk[];
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
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, Set<number>>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const api = (window as any).electron;

  const refresh = useCallback(async () => {
    try {
      const res = await api?.changesList?.();
      if (res?.success) { setRows(res.changes || []); setError(null); }
      else setError(res?.error || 'Could not read the change log.');
      const waiting = await api?.workspaceProposals?.();
      if (waiting?.success) {
        const list: Proposal[] = waiting.proposals || [];
        setProposals(list);
        // Everything in a new proposal starts accepted: the reviewer is
        // deciding what to drop, not ticking twenty boxes to take the edit.
        setChosen(prev => {
          const next: Record<string, Set<number>> = {};
          for (const proposal of list) {
            next[proposal.id] = prev[proposal.id] ?? new Set(proposal.hunks.map((_, index) => index));
          }
          return next;
        });
        setOpenProposal(current => (current && list.some(p => p.id === current) ? current : list[0]?.id ?? null));
      }
    } catch (e: any) {
      setError(e?.message || 'Could not read the change log.');
    }
  }, [api]);

  const toggleHunk = useCallback((proposalId: string, index: number) => {
    setChosen(prev => {
      const picked = new Set(prev[proposalId] ?? []);
      if (picked.has(index)) picked.delete(index); else picked.add(index);
      return { ...prev, [proposalId]: picked };
    });
  }, []);

  const decide = useCallback(async (proposal: Proposal, accept: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const picked = [...(chosen[proposal.id] ?? new Set<number>())];
      const res = accept
        ? await api?.workspaceProposalAccept?.(proposal.id, picked)
        : await api?.workspaceProposalReject?.(proposal.id);
      if (res?.success) {
        setNote(accept
          ? `Applied ${res.applied} change(s) to ${baseName(proposal.path)}.`
          : `Discarded the proposed changes to ${baseName(proposal.path)}. The file is untouched.`);
        if (accept && onOpenFile) onOpenFile(proposal.path);
      } else {
        setNote(res?.error || 'That decision could not be applied.');
      }
    } catch (e: any) {
      setNote(e?.message || 'That decision could not be applied.');
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [api, chosen, onOpenFile, refresh]);

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
      {note && <p className="changes-note" role="status">{note}</p>}

      {proposals.length > 0 && (
        <div className="changes-proposals" aria-label="Proposed changes">
          <div className="changes-section-head">Waiting for you — nothing is written yet</div>
          {proposals.map(proposal => {
            const picked = chosen[proposal.id] ?? new Set<number>();
            const open = openProposal === proposal.id;
            return (
              <div className="changes-proposal" key={proposal.id}>
                <button
                  className={`changes-item${open ? ' active' : ''}`}
                  onClick={() => setOpenProposal(open ? null : proposal.id)}
                  aria-expanded={open}
                  title={proposal.path}
                >
                  <span className="changes-item-name">{baseName(proposal.path)}</span>
                  <span className={`changes-badge ${proposal.created ? 'created' : 'edited'}`}>
                    {proposal.created ? 'new file' : 'proposed'}
                  </span>
                  <span className="changes-stat add">+{proposal.stats.added}</span>
                  <span className="changes-stat remove">-{proposal.stats.removed}</span>
                </button>

                {open && (
                  <div className="changes-diff" aria-label={`Proposed changes to ${baseName(proposal.path)}`}>
                    {proposal.hunks.map((hunk, index) => (
                      <div className={`changes-hunk${picked.has(index) ? ' accepted' : ' rejected'}`} key={`${proposal.id}-${index}`}>
                        <div className="changes-hunk-head">
                          <span>@@ line {hunk.afterStart} @@</span>
                          <label className="changes-hunk-pick">
                            <input
                              type="checkbox"
                              checked={picked.has(index)}
                              aria-label={`Accept change at line ${hunk.afterStart} in ${baseName(proposal.path)}`}
                              onChange={() => toggleHunk(proposal.id, index)}
                            />
                            Accept
                          </label>
                        </div>
                        {hunk.lines.map((line, j) => (
                          <div className={`changes-line ${line.type}`} key={j}>
                            <span className="changes-gutter">{line.before ?? ''}</span>
                            <span className="changes-gutter">{line.after ?? ''}</span>
                            <span className="changes-sign">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
                            <span className="changes-text">{line.text || ' '}</span>
                          </div>
                        ))}
                      </div>
                    ))}

                    <div className="changes-decide">
                      <button
                        className="changes-accept"
                        disabled={busy || picked.size === 0}
                        onClick={() => void decide(proposal, true)}
                      >
                        {picked.size === proposal.hunks.length ? 'Apply all' : `Apply ${picked.size} of ${proposal.hunks.length}`}
                      </button>
                      <button className="changes-reject" disabled={busy} onClick={() => void decide(proposal, false)}>
                        Discard
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
