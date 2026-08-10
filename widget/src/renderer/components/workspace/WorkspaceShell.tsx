import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import Icon from '../Icon';
import FileTree from './FileTree';
import CodeEditor from './CodeEditor';

const TerminalPanel = lazy(() => import('../TerminalPanel'));
// Lazy: the browser panel is off by default, and its first render triggers an
// attach in main — no reason to pay for either until it is actually opened.
const BrowserPanel = lazy(() => import('./BrowserPanel'));
const ChangesPanel = lazy(() => import('./ChangesPanel'));

/**
 * VS Code–shaped workspace: activity bar → sidebar → tabbed editor → bottom
 * panel → status bar.
 *
 * The point of this layout is that the terminal stops being a modal. In the
 * old shell every secondary surface covered the app, so you could not watch a
 * build while doing anything else — which is most of what a terminal is for.
 * Here it docks, and the editor and Explorer sit beside it.
 */

interface OpenFile {
  path: string;
  name: string;
  content: string;
  original: string;
  language: string;
}

type SideView = 'explorer' | 'changes' | null;

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

export default function WorkspaceShell({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [root, setRoot] = useState('');
  const [sideView, setSideView] = useState<SideView>('explorer');
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [assistantActivity, setAssistantActivity] = useState<string | null>(null);

  const api = (window as any).electron;
  const active = files.find(f => f.path === activePath) || null;
  const dirty = active ? active.content !== active.original : false;

  useEffect(() => {
    if (!open || root) return;
    let cancelled = false;
    (async () => {
      const res = await api?.workspaceRoot?.();
      if (!cancelled && res?.path) setRoot(res.path);
    })();
    return () => { cancelled = true; };
  }, [open, root, api]);

  const openFile = useCallback(async (path: string) => {
    // Already open? Just focus its tab — never reload over unsaved edits.
    if (files.some(f => f.path === path)) { setActivePath(path); return; }
    const res = await api?.workspaceRead?.(path);
    if (!res?.success) { setStatus(res?.error || 'Could not open that file.'); return; }
    setFiles(prev => [...prev, {
      path,
      name: baseName(path),
      content: res.content ?? '',
      original: res.content ?? '',
      language: res.language || 'plaintext',
    }]);
    setActivePath(path);
    setStatus(null);
  }, [files, api]);

  const closeTab = useCallback((path: string) => {
    setFiles(prev => {
      const next = prev.filter(f => f.path !== path);
      setActivePath(cur => (cur === path ? (next[next.length - 1]?.path ?? null) : cur));
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    if (!active) return;
    const res = await api?.workspaceSave?.(active.path, active.content);
    if (res?.success) {
      setFiles(prev => prev.map(f => (f.path === active.path ? { ...f, original: f.content } : f)));
      setStatus(`Saved ${active.name}`);
      window.setTimeout(() => setStatus(s => (s === `Saved ${active.name}` ? null : s)), 2000);
    } else {
      setStatus(res?.error || 'Save failed.');
    }
  }, [active, api]);

  // Surface what the assistant does with HomeBot's tools. Dangerous calls
  // already raise the confirmation modal; this makes the harmless ones visible
  // too, so tool use is never silent.
  useEffect(() => {
    if (!open) return;
    const off = api?.onAssistantToolActivity?.((info: { tool: string; allowed: boolean; error?: string }) => {
      setAssistantActivity(
        info.allowed ? `assistant: ${info.tool}` : `assistant: ${info.tool} blocked${info.error ? ` — ${info.error}` : ''}`,
      );
      window.setTimeout(() => setAssistantActivity(null), 4000);
    });
    return () => off?.();
  }, [open, api]);

  // Ctrl+S works from anywhere in the workspace, not just inside the textarea.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); setTerminalOpen(t => !t); }
      // Escape leaves the workspace. "Back to chat" sits at the bottom of the
      // activity bar, so it is the first thing to disappear if the layout ever
      // overflows again — and the workspace covers the mode tabs, which were
      // the only other way out. A keyboard path cannot be clipped off-screen.
      // Ignored while editing so it can't discard a half-typed line.
      if (e.key === 'Escape' && !dirty) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); onClose(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, save, dirty, onClose]);

  if (!open) return null;

  return (
    <div className="workspace-shell" role="region" aria-label="Workspace">
      {/* Activity bar */}
      <nav className="ws-activity" aria-label="Activity bar">
        <button
          type="button"
          className={`ws-activity-btn${sideView === 'explorer' ? ' active' : ''}`}
          title="Explorer"
          aria-label="Explorer"
          aria-pressed={sideView === 'explorer'}
          onClick={() => setSideView(v => (v === 'explorer' ? null : 'explorer'))}
        ><Icon name="document" size={20} /></button>
        <button
          type="button"
          className={`ws-activity-btn${terminalOpen ? ' active' : ''}`}
          title="Terminal (Ctrl+`)"
          aria-label="Toggle terminal"
          aria-pressed={terminalOpen}
          onClick={() => setTerminalOpen(t => !t)}
        ><Icon name="terminal" size={20} /></button>
        <button
          type="button"
          className={`ws-activity-btn${sideView === 'changes' ? ' active' : ''}`}
          title="Changes — what HomeBot edited"
          aria-label="Changes"
          aria-pressed={sideView === 'changes'}
          onClick={() => setSideView(v => (v === 'changes' ? null : 'changes'))}
        ><Icon name="diff" size={20} /></button>
        <button
          type="button"
          className={`ws-activity-btn${browserOpen ? ' active' : ''}`}
          title="Browser"
          aria-label="Toggle browser panel"
          aria-pressed={browserOpen}
          onClick={() => setBrowserOpen(b => !b)}
        ><Icon name="globe" size={20} /></button>
        <div className="ws-activity-spacer" />
        <button
          type="button"
          className="ws-activity-btn"
          title="Back to chat"
          aria-label="Back to chat"
          onClick={onClose}
        ><Icon name="chat" size={20} /></button>
      </nav>

      {/* Sidebar */}
      {sideView === 'changes' && (
        <aside className="ws-sidebar" aria-label="Changes">
          <div className="ws-sidebar-title">Changes</div>
          <div className="ws-sidebar-root">What HomeBot edited this session</div>
          <div className="ws-sidebar-body">
            <Suspense fallback={<div className="tree-hint">Loading…</div>}>
              <ChangesPanel onOpenFile={openFile} />
            </Suspense>
          </div>
        </aside>
      )}
      {/* Sidebar */}
      {sideView === 'explorer' && (
        <aside className="ws-sidebar" aria-label="Explorer">
          <div className="ws-sidebar-title">Explorer</div>
          <div className="ws-sidebar-root" title={root}>{baseName(root) || root}</div>
          <div className="ws-sidebar-body">
            {root && <FileTree root={root} activePath={activePath} onOpenFile={openFile} />}
          </div>
        </aside>
      )}

      {/* Editor area */}
      <main className="ws-main">
        <div className="ws-tabs" role="tablist" aria-label="Open files">
          {files.length === 0 && <div className="ws-tabs-empty">No file open</div>}
          {files.map(f => (
            <div
              key={f.path}
              role="tab"
              aria-selected={f.path === activePath}
              className={`ws-tab${f.path === activePath ? ' active' : ''}`}
              onClick={() => setActivePath(f.path)}
              title={f.path}
            >
              <span className="ws-tab-name">{f.name}</span>
              {f.content !== f.original && <span className="ws-tab-dirty" aria-label="Unsaved changes">●</span>}
              <button
                type="button"
                className="ws-tab-close"
                aria-label={`Close ${f.name}`}
                onClick={(e) => { e.stopPropagation(); closeTab(f.path); }}
              >✕</button>
            </div>
          ))}
        </div>

        <div className="ws-editor-area">
          {active ? (
            <CodeEditor
              value={active.content}
              language={active.language}
              onSave={save}
              onChange={(next) =>
                setFiles(prev => prev.map(f => (f.path === active.path ? { ...f, content: next } : f)))
              }
            />
          ) : (
            <div className="ws-empty">
              <Icon name="document" size={30} />
              <p>Pick a file in the Explorer to start editing.</p>
              <p className="ws-empty-sub">
                Ctrl+S saves · Ctrl+` toggles the terminal · edits stay inside your home folder
              </p>
            </div>
          )}
        </div>

        {terminalOpen && (
          <div className="ws-panel" aria-label="Panel">
            <Suspense fallback={<div className="tree-hint">Loading terminal…</div>}>
              <TerminalPanel open onClose={() => setTerminalOpen(false)} projectPath={root} />
            </Suspense>
          </div>
        )}
      </main>

      {/* Browser docked to the right, as a sibling of the editor rather than
          inside it — the page is painted over its own rectangle by the main
          process, so it must own an area nothing else draws into. */}
      {browserOpen && (
        <Suspense fallback={<div className="tree-hint">Loading browser…</div>}>
          <BrowserPanel onClose={() => setBrowserOpen(false)} />
        </Suspense>
      )}

      {/* Status bar */}
      <footer className="ws-status" aria-label="Status bar">
        <span className="ws-status-item">{active ? active.path : root}</span>
        <span className="ws-status-spacer" />
        {assistantActivity && <span className="ws-status-item ws-status-assistant">{assistantActivity}</span>}
        {status && <span className="ws-status-item ws-status-msg">{status}</span>}
        {active && <span className="ws-status-item">{active.language}</span>}
        {dirty && <span className="ws-status-item ws-status-dirty">Unsaved</span>}
      </footer>
    </div>
  );
}
