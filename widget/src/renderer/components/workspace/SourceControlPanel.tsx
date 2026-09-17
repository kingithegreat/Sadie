/**
 * SourceControlPanel — see what changed in the open folder's git repository,
 * stage it, commit it and switch branches, without leaving the Workspace.
 *
 * Everything runs through main/workspace-git.ts (git with an argument array,
 * home folder only). A commit is an explicit click with a message, so it needs
 * no second confirmation; nothing here pushes, resets or discards changes.
 */

import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceGitChange } from '../../../shared/types';

interface Props {
  /** The folder the Workspace has open; its repository is the one shown. */
  folder: string;
  onOpenFile: (absolutePath: string) => void;
}

const KIND_LETTER: Record<WorkspaceGitChange['kind'], string> = {
  modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', untracked: 'U', conflicted: '!', 'type-changed': 'T',
};

export default function SourceControlPanel({ folder, onOpenFile }: Props) {
  const api = (window as any).electron;
  const [status, setStatus] = useState<{ isRepo: boolean; root?: string; branch?: string; staged: WorkspaceGitChange[]; unstaged: WorkspaceGitChange[] } | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!folder) return;
    const res = await api?.workspaceGitStatus?.(folder);
    if (!res?.success) { setError(res?.error || 'Could not read the repository.'); return; }
    setError(null);
    setStatus({ isRepo: !!res.isRepo, root: res.root, branch: res.branch, staged: res.staged || [], unstaged: res.unstaged || [] });
    if (res.isRepo) {
      const b = await api?.workspaceGitBranches?.(folder);
      setBranches(b?.success ? b.branches || [] : []);
    }
  }, [api, folder]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (label: string, run: () => Promise<{ success: boolean; error?: string; hash?: string } | undefined>) => {
    setBusy(true); setNote(null);
    try {
      const res = await run();
      if (!res?.success) setError(res?.error || `${label} failed.`);
      else { setError(null); if (res.hash) setNote(`Committed ${res.hash}.`); }
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  if (!status) return <div className="tree-hint">{error || 'Reading the repository…'}</div>;
  if (!status.isRepo) return <div className="tree-hint">This folder is not in a git repository.</div>;

  const absolute = (rel: string) => `${status.root}/${rel}`;
  const row = (change: WorkspaceGitChange, stagedList: boolean) => (
    <li key={`${stagedList ? 's' : 'u'}:${change.path}`} className="scm-row">
      <button type="button" className="scm-file" title={change.from ? `${change.from} → ${change.path}` : change.path}
        onClick={() => change.kind !== 'deleted' && onOpenFile(absolute(change.path))}>
        <span className={`scm-kind scm-kind-${change.kind}`} aria-label={change.kind}>{KIND_LETTER[change.kind]}</span>
        <span className="scm-path">{change.path}</span>
      </button>
      <button type="button" className="scm-action" disabled={busy}
        aria-label={`${stagedList ? 'Unstage' : 'Stage'} ${change.path}`}
        onClick={() => act(stagedList ? 'Unstage' : 'Stage', () => stagedList
          ? api?.workspaceGitUnstage?.(folder, [change.path])
          : api?.workspaceGitStage?.(folder, [change.path]))}>
        {stagedList ? '−' : '+'}
      </button>
    </li>
  );

  const canCommit = !busy && status.staged.length > 0 && message.trim().length > 0;

  return (
    <div className="scm-panel" aria-label="Source control">
      <label className="scm-branch">Branch{' '}
        <select aria-label="Branch" value={status.branch} disabled={busy || branches.length === 0}
          onChange={e => act('Switch branch', () => api?.workspaceGitCheckout?.(folder, e.target.value))}>
          {!branches.includes(status.branch || '') && <option value={status.branch}>{status.branch}</option>}
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>

      <textarea className="scm-message" aria-label="Commit message" placeholder="Commit message" rows={3}
        value={message} onChange={e => setMessage(e.target.value)} disabled={busy} />
      <button type="button" className="scm-commit" disabled={!canCommit}
        onClick={() => act('Commit', async () => {
          const res = await api?.workspaceGitCommit?.(folder, message);
          if (res?.success) setMessage('');
          return res;
        })}>
        Commit {status.staged.length > 0 ? `${status.staged.length} staged` : ''}
      </button>
      {error && <div className="tree-hint tree-error" role="alert">{error}</div>}
      {note && <div className="tree-hint" role="status">{note}</div>}

      <div className="scm-section">
        <div className="scm-section-title">Staged ({status.staged.length})</div>
        <ul className="scm-list" aria-label="Staged changes">{status.staged.map(c => row(c, true))}</ul>
      </div>
      <div className="scm-section">
        <div className="scm-section-title">
          Changes ({status.unstaged.length})
          {status.unstaged.length > 0 && (
            <button type="button" className="scm-action" disabled={busy} aria-label="Stage all changes"
              onClick={() => act('Stage all', () => api?.workspaceGitStage?.(folder, status.unstaged.map(c => c.path)))}>+ all</button>
          )}
        </div>
        <ul className="scm-list" aria-label="Unstaged changes">{status.unstaged.map(c => row(c, false))}</ul>
      </div>
      <button type="button" className="scm-refresh" onClick={() => void refresh()} disabled={busy}>Refresh</button>
    </div>
  );
}
