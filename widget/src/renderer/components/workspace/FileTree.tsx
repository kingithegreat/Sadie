import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/types';
import Icon from '../Icon';

/**
 * Explorer tree.
 *
 * Folders load lazily — one directory listing per expand, never a recursive
 * walk. A recursive scan of a home directory is the classic way to hang an
 * Electron renderer, and the main-process listing already skips node_modules,
 * .git and friends.
 */

interface FileTreeProps {
  root: string;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  showHidden?: boolean;
  refreshToken?: number;
  onAction?: (action: string, entry: WorkspaceEntry) => void;
}

interface NodeProps extends FileTreeProps {
  entry: WorkspaceEntry;
  depth: number;
}

function FileIconFor({ entry, expanded }: { entry: WorkspaceEntry; expanded: boolean }) {
  if (entry.isDirectory) {
    return <span className={`tree-chevron${expanded ? ' open' : ''}`}><Icon name="chevronDown" size={13} /></span>;
  }
  return <span className="tree-file-dot" aria-hidden="true" />;
}

function TreeNode({ entry, depth, root, activePath, onOpenFile, showHidden, refreshToken, onAction }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<WorkspaceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (!entry.isDirectory) { onOpenFile(entry.path); return; }

    const next = !expanded;
    setExpanded(next);
  }, [entry, expanded, onOpenFile]);
  useEffect(() => {
    if (!expanded || !entry.isDirectory) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await (window as any).electron?.workspaceList?.(entry.path, { showHidden: !!showHidden });
        if (cancelled) return;
        if (res?.success) setChildren(res.entries || []);
        else setError(res?.error || 'Could not read this folder.');
      } catch (e: any) { if (!cancelled) setError(String(e?.message || e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [expanded, entry.path, entry.isDirectory, showHidden, refreshToken]);

  const isActive = !entry.isDirectory && activePath === entry.path;

  return (
    <>
      <div
        className={`tree-row${isActive ? ' active' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={toggle}
        role="treeitem"
        aria-label={entry.name}
        aria-level={depth + 1}
        aria-expanded={entry.isDirectory ? expanded : undefined}
        aria-selected={isActive}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void toggle(); }
          if (e.key === 'ArrowRight' && entry.isDirectory) { e.preventDefault(); setExpanded(true); }
          if (e.key === 'ArrowLeft' && entry.isDirectory) { e.preventDefault(); setExpanded(false); }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const rows = Array.from(e.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('[role="treeitem"]') || []);
            const index = rows.indexOf(e.currentTarget);
            rows[index + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
          }
        }}
        title={entry.path}
      >
        <FileIconFor entry={entry} expanded={expanded} />
        <span className="tree-label">{entry.name}</span>
        {onAction && <select aria-label={`Actions for ${entry.name}`} value="" style={{ width: 24, marginLeft: 'auto' }}
          onClick={e => e.stopPropagation()} onChange={e => { const action = e.target.value; if (action) onAction(action, entry); }}>
          <option value="">⋯</option>
          {entry.isDirectory && <option value="create-file">New file</option>}
          {entry.isDirectory && <option value="create-folder">New folder</option>}
          <option value="move">Rename or move</option><option value="copy-path">Copy path</option>
          <option value="reveal">Show in Explorer</option><option value="delete">Move to recycle bin</option>
        </select>}
      </div>

      {expanded && loading && (
        <div className="tree-hint" style={{ paddingLeft: 18 + depth * 12 }}>Loading…</div>
      )}
      {expanded && error && (
        <div className="tree-hint tree-error" style={{ paddingLeft: 18 + depth * 12 }}>{error}</div>
      )}
      {expanded && children?.length === 0 && (
        <div className="tree-hint" style={{ paddingLeft: 18 + depth * 12 }}>Empty</div>
      )}
      {expanded && children?.map(child => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          root={root}
          activePath={activePath}
          onOpenFile={onOpenFile}
          showHidden={showHidden} refreshToken={refreshToken} onAction={onAction}
        />
      ))}
    </>
  );
}

export default function FileTree({ root, activePath, onOpenFile, showHidden, refreshToken, onAction }: FileTreeProps) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await (window as any).electron?.workspaceList?.(root, { showHidden: !!showHidden });
        if (cancelled) return;
        if (res?.success) { setEntries(res.entries || []); setError(null); }
        else setError(res?.error || 'Could not read this folder.');
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [root, showHidden, refreshToken]);

  if (error) return <div className="tree-hint tree-error">{error}</div>;
  if (!entries) return <div className="tree-hint">Loading…</div>;
  if (entries.length === 0) return <div className="tree-hint">This folder is empty.</div>;

  return (
    <div className="file-tree" role="tree" aria-label="Explorer">
      {entries.map(entry => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          root={root}
          activePath={activePath}
          onOpenFile={onOpenFile}
          showHidden={showHidden} refreshToken={refreshToken} onAction={onAction}
        />
      ))}
    </div>
  );
}
