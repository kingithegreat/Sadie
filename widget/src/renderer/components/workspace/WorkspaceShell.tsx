import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useConfirmDestructive } from '../ConfirmDestructive';
import { createPortal } from 'react-dom';
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

export default function WorkspaceShell({
  open,
  onClose,
  navContext,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Context handed over when the assistant sent the user here with
   * navigate_to_mode. Only `path` means anything: a directory becomes the
   * Explorer root, a file opens in its parent folder. Honoured only while no
   * root is chosen yet, on the AutomationCenter principle — arriving a second
   * time cannot yank the tree away from what the user is already looking at.
   */
  navContext?: Record<string, unknown> | null;
}) {
  const [confirmDialog, confirm] = useConfirmDestructive();
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

  // Bootstrap root once. A whole-effect guard (`if (root) return`) silently
  // drops every later handoff that carries a different starting point — the
  // dead end the handoff exists to remove. Apply the no-clobber guard PER FIELD
  // the way AutomationCenter does (`setFormName(prev => prev || name)`):
  // re-root only when no root is chosen yet, but always honour the file part
  // of the handoff so the targeted file lands in a tab.
  useEffect(() => {
    if (!open || root) return;
    let cancelled = false;
    (async () => {
      // A handoff can carry a starting point — "help me with this repo" should
      // land in the workspace pointed at that repo, not at the default root.
      // A directory becomes the root; a file opens in its parent folder. If
      // neither works (unknown path, sandboxed out), fall through to the
      // configured root rather than leaving the Explorer empty.
      const ctxPath =
        typeof navContext?.path === 'string' ? navContext.path.trim() : '';
      if (ctxPath) {
        const asDir = await api?.workspaceList?.(ctxPath);
        if (cancelled) return;
        if (asDir?.success) {
          setRoot(asDir.path || ctxPath);
          return;
        }
        const parent = ctxPath.replace(/[\\/][^\\/]*$/, '');
        if (parent) {
          const asParent = await api?.workspaceList?.(parent);
          if (cancelled) return;
          if (asParent?.success) {
            setRoot(asParent.path || parent);
            void openFile(ctxPath);
            return;
          }
        }
      }
      const res = await api?.workspaceRoot?.();
      if (!cancelled && res?.path) setRoot(res.path);
    })();
    return () => { cancelled = true; };
  }, [open, root, navContext, api, openFile]);

  // Apply each new navContext handoff, even after root is set. Per-field
  // guards: never replace the user's current root (it would yank the tree
  // away mid-task), but always try to open the targeted file in whichever
  // root is active. openFile itself is a no-op if the file is already open
  // (it just focuses the existing tab), so this is safe to re-run.
  const ctxPath =
    typeof navContext?.path === 'string' ? navContext.path.trim() : '';
  useEffect(() => {
    if (!open || !ctxPath) return;
    let cancelled = false;
    (async () => {
      // If the handoff's path is a directory we could live under, adopt it
      // (per-field guard — `prev => prev || ctxPath` keeps an existing root).
      const asDir = await api?.workspaceList?.(ctxPath);
      if (cancelled) return;
      if (asDir?.success) {
        setRoot(prev => prev || (asDir.path || ctxPath));
        return;
      }
      // File path: open it. The bootstrap effect already roots to the parent
      // if no root is set; if a root is already set we just focus the file.
      void openFile(ctxPath);
    })();
    return () => { cancelled = true; };
  }, [open, ctxPath, api, openFile]);


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

  // Portalled to document.body. As a direct child of .app-container this was
  // matched by the blanket rule in chatgpt-theme.css:
  //
  //   .app-container > *:not(.app-header):not(.widget-titlebar)... {
  //     position: relative; z-index: 1; }
  //
  // which is (0,10,0) and beats this overlay's own `position: fixed`. The panel
  // was therefore laid out as a page row instead of covering the window. That
  // rule is a blocklist — it excludes the handful of overlays someone
  // remembered to name, and silently captures every one they did not.
  return createPortal((
    <div className="workspace-shell" role="region" aria-label="Workspace">
      {confirmDialog}
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
              {/* The ● beside the name already says "unsaved", and Escape
                  already refuses to leave the workspace while dirty — but this
                  ✕ closed the tab regardless, discarding edits to a real file
                  on one click. Only asks when there is something to lose. */}
              <button
                type="button"
                className="ws-tab-close"
                aria-label={`Close ${f.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (f.content !== f.original) {
                    confirm({
                      title: `Close “${f.name}” without saving?`,
                      body: (
                        <p>
                          You have changes to this file that have not been saved.
                          <strong> They will be lost.</strong> Cancel, then press
                          Ctrl+S if you want to keep them.
                        </p>
                      ),
                      confirmLabel: 'Close without saving',
                      onConfirm: () => closeTab(f.path),
                    });
                    return;
                  }
                  closeTab(f.path);
                }}
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
        {/* The visible way home. The activity-bar icon at the far bottom-left
            was the only pointer exit and nobody found it — the shell covers
            the mode tabs, so "no way to nav home from code" was a fair read.
            A labelled button in the status bar is where VS Code users look for
            state, and it reads as an action, not chrome. Escape still works. */}
        <button type="button" className="ws-status-home" onClick={onClose}>
          <Icon name="dashboard" size={13} />
          Home
        </button>
        <span className="ws-status-item">{active ? active.path : root}</span>
        <span className="ws-status-spacer" />
        {assistantActivity && <span className="ws-status-item ws-status-assistant">{assistantActivity}</span>}
        {status && <span className="ws-status-item ws-status-msg">{status}</span>}
        {active && <span className="ws-status-item">{active.language}</span>}
        {dirty && <span className="ws-status-item ws-status-dirty">Unsaved</span>}
      </footer>
    </div>
  ), document.body);
}
