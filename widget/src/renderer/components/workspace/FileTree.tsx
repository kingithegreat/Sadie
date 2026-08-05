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

function TreeNode({ entry, depth, root, activePath, onOpenFile }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<WorkspaceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (!entry.isDirectory) { onOpenFile(entry.path); return; }

    const next = !expanded;
    setExpanded(next);
    if (!next || children) return;

    setLoading(true);
    setError(null);
    try {
      const res = await (window as any).electron?.workspaceList?.(entry.path);
      if (res?.success) setChildren(res.entries || []);
      else setError(res?.error || 'Could not read this folder.');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [entry, expanded, children, onOpenFile]);

  const isActive = !entry.isDirectory && activePath === entry.path;

  return (
    <>
      <div
        className={`tree-row${isActive ? ' active' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={toggle}
        role="treeitem"
        aria-expanded={entry.isDirectory ? expanded : undefined}
        aria-selected={isActive}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void toggle(); } }}
        title={entry.path}
      >
        <FileIconFor entry={entry} expanded={expanded} />
        <span className="tree-label">{entry.name}</span>
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
        />
      ))}
    </>
  );
}

export default function FileTree({ root, activePath, onOpenFile }: FileTreeProps) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await (window as any).electron?.workspaceList?.(root);
        if (cancelled) return;
        if (res?.success) { setEntries(res.entries || []); setError(null); }
        else setError(res?.error || 'Could not read this folder.');
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [root]);

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
        />
      ))}
    </div>
  );
}
