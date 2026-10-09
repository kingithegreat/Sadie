import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useConfirmDestructive } from '../ConfirmDestructive';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import FileTree from './FileTree';
import CodeEditor, { type CodeEditorSession } from './CodeEditor';

const TerminalPanel = lazy(() => import('../TerminalPanel'));
// Lazy: the browser panel is off by default, and its first render triggers an
// attach in main — no reason to pay for either until it is actually opened.
const BrowserPanel = lazy(() => import('./BrowserPanel'));
const ChangesPanel = lazy(() => import('./ChangesPanel'));
const WorkspaceAssistantPanel = lazy(() => import('./WorkspaceAssistantPanel'));
const SourceControlPanel = lazy(() => import('./SourceControlPanel'));
const SearchPanel = lazy(() => import('./SearchPanel'));
const ProblemsPanel = lazy(() => import('./ProblemsPanel'));

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
  editorSession: CodeEditorSession;
}

type SideView = 'explorer' | 'search' | 'problems' | 'changes' | 'scm' | null;

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/**
 * Focus targets that own Escape themselves. CodeMirror's content is a
 * contenteditable DIV, not a textarea, so a tag check alone let Escape inside
 * the editor (closing autocomplete, collapsing a multi-cursor selection, the
 * find panel's buttons) leave the whole workspace.
 */
const ESCAPE_OWNING_FOCUS = 'input, textarea, select, [contenteditable="true"], .cm-editor';

/**
 * Overlays that can sit above the workspace and close on Escape. Most mark
 * themselves aria-modal; the tool-approval and shortcuts overlays do not, and
 * they listen on window after this shell does, so they are named here.
 */
const ESCAPE_OWNING_OVERLAY = '[aria-modal="true"], .confirmation-overlay, .shortcuts-overlay';

/**
 * Whether a keydown is the workspace's "go back" Escape rather than one meant
 * for the editor, a field, or a dialog on top. Exported for tests.
 */
export function isWorkspaceBackEscape(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  const target = e.target as Element | null;
  if (target && typeof target.closest === 'function' && target.closest(ESCAPE_OWNING_FOCUS)) return false;
  if (document.querySelector(ESCAPE_OWNING_OVERLAY)) return false;
  return true;
}

export default function WorkspaceShell({
  open,
  onClose,
  onHome,
  onBack,
  navContext,
}: {
  /**
   * Visibility, not lifetime. While `open` is false the shell renders nothing
   * but keeps its state, so a parent that keeps it mounted (App does) gets the
   * same tabs and unsaved edits back when the user returns.
   */
  open: boolean;
  onClose: () => void;
  onHome?: () => void;
  /**
   * The header Back button and Escape: return to wherever the user came from
   * in the main HomeBot interface. Falls back to onClose.
   */
  onBack?: () => void;
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
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [assistantActivity, setAssistantActivity] = useState<string | null>(null);
  // A search result's target: open the file and land on the line. Cleared once
  // consumed, so the editor never re-jumps on a later re-render.
  const [reveal, setReveal] = useState<{ path: string; line: number } | null>(null);
  // Ctrl+Shift+F bumps this; SearchPanel focuses its query box on the change.
  const [searchFocusToken, setSearchFocusToken] = useState(0);

  const api = (window as any).electron;
  const active = files.find(f => f.path === activePath) || null;
  const dirty = active ? active.content !== active.original : false;
  const back = onBack ?? onClose;
  // The navContext object each handoff arrived in, once applied. The shell now
  // outlives leaving the view, so re-opening it must not re-apply the same
  // handoff and pull focus off the tab the user was actually working in.
  const appliedHandoffRef = useRef<Record<string, unknown> | null>(null);

  const openFile = useCallback(async (path: string, line?: number) => {
    // Already open? Just focus its tab — never reload over unsaved edits.
    if (files.some(f => f.path === path)) {
      setActivePath(path);
      // A search result landing on an already-open tab still needs its jump.
      if (line) setReveal({ path, line });
      return;
    }
    const res = await api?.workspaceRead?.(path);
    if (!res?.success) { setStatus(res?.error || 'Could not open that file.'); return; }
    setFiles(prev => [...prev, {
      path,
      name: baseName(path),
      content: res.content ?? '',
      original: res.content ?? '',
      language: res.language || 'plaintext',
      editorSession: { current: null },
    }]);
    setActivePath(path);
    if (line) setReveal({ path, line });
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
    if (navContext && appliedHandoffRef.current === navContext) return;
    let cancelled = false;
    (async () => {
      // If the handoff's path is a directory we could live under, adopt it
      // (per-field guard — `prev => prev || ctxPath` keeps an existing root).
      const asDir = await api?.workspaceList?.(ctxPath);
      if (cancelled) return;
      appliedHandoffRef.current = navContext ?? null;
      if (asDir?.success) {
        setRoot(prev => prev || (asDir.path || ctxPath));
        return;
      }
      // File path: open it. The bootstrap effect already roots to the parent
      // if no root is set; if a root is already set we just focus the file.
      void openFile(ctxPath);
    })();
    return () => { cancelled = true; };
  }, [open, ctxPath, navContext, api, openFile]);


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
      // The write contains this snapshot. Edits made while its reply is pending
      // still need saving; marking the latest text clean would silently lose them.
      setFiles(prev => prev.map(f => (f.path === active.path ? { ...f, original: active.content } : f)));
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
      // Ctrl+Shift+F opens Search from anywhere and puts the cursor in the box.
      // Owned here rather than in the panel because the panel is unmounted when
      // the view is closed — the hotkey would do nothing exactly when it is most
      // useful.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSideView('search');
        setSearchFocusToken(t => t + 1);
      }
      // Escape is the header Back button's keyboard path: the workspace covers
      // the mode tabs, and a keyboard path cannot be clipped off-screen. It no
      // longer refuses while a file is dirty, because leaving keeps the shell's
      // state (see `open`) — nothing is discarded. It still never takes Escape
      // from the editor, a field or a dialog on top (isWorkspaceBackEscape).
      if (isWorkspaceBackEscape(e)) { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, save, back]);

  // A pending "close without saving?" prompt must not outlive the view: while
  // hidden it would still swallow the next Escape pressed anywhere in the app.
  useEffect(() => {
    if (!open) confirm(null);
  }, [open, confirm]);

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
          className={`ws-activity-btn${sideView === 'search' ? ' active' : ''}`}
          title="Search (Ctrl+Shift+F)"
          aria-label="Search across files"
          aria-pressed={sideView === 'search'}
          onClick={() => setSideView(v => (v === 'search' ? null : 'search'))}
        ><Icon name="search" size={20} /></button>
        <button
          type="button"
          className={`ws-activity-btn${sideView === 'problems' ? ' active' : ''}`}
          title="Problems and tasks"
          aria-label="Problems and tasks"
          aria-pressed={sideView === 'problems'}
          onClick={() => setSideView(v => (v === 'problems' ? null : 'problems'))}
        ><Icon name="tools" size={20} /></button>
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
          className={`ws-activity-btn${sideView === 'scm' ? ' active' : ''}`}
          title="Source Control"
          aria-label="Source Control"
          aria-pressed={sideView === 'scm'}
          onClick={() => setSideView(v => (v === 'scm' ? null : 'scm'))}
        ><Icon name="code" size={20} /></button>
        <button
          type="button"
          className={`ws-activity-btn${browserOpen ? ' active' : ''}`}
          title="Browser"
          aria-label="Toggle browser panel"
          aria-pressed={browserOpen}
          onClick={() => setBrowserOpen(b => !b)}
        ><Icon name="globe" size={20} /></button>
        <button
          type="button"
          className={`ws-activity-btn${assistantOpen ? ' active' : ''}`}
          title="Assistant — ask about your code"
          aria-label="Toggle assistant panel"
          aria-pressed={assistantOpen}
          onClick={() => setAssistantOpen(a => !a)}
        ><Icon name="sparkle" size={20} /></button>
        <div className="ws-activity-spacer" />
        <button
          type="button"
          className="ws-activity-btn"
          title="Back to chat"
          aria-label="Back to chat"
          onClick={onClose}
        ><Icon name="chat" size={20} /></button>
      </nav>

      {sideView === 'scm' && (
        <aside className="ws-sidebar" aria-label="Source Control">
          <div className="ws-sidebar-title">Source Control</div>
          <div className="ws-sidebar-root" title={root}>{baseName(root) || root}</div>
          <div className="ws-sidebar-body">
            <Suspense fallback={<div className="tree-hint">Loading…</div>}>
              {root && <SourceControlPanel folder={root} onOpenFile={openFile} />}
            </Suspense>
          </div>
        </aside>
      )}
      {sideView === 'search' && (
        <aside className="ws-sidebar ws-sidebar-search" aria-label="Search">
          <div className="ws-sidebar-title">Search</div>
          <div className="ws-sidebar-root" title={root}>{baseName(root) || root}</div>
          <div className="ws-sidebar-body">
            <Suspense fallback={<div className="tree-hint">Loading…</div>}>
              {root && (
                <SearchPanel
                  root={root}
                  onOpenFile={openFile}
                  onReplaced={(summary) => setStatus(summary)}
                  focusToken={searchFocusToken}
                />
              )}
            </Suspense>
          </div>
        </aside>
      )}
      {sideView === 'problems' && (
        <aside className="ws-sidebar ws-sidebar-problems" aria-label="Problems and tasks">
          <div className="ws-sidebar-title">Problems and tasks</div>
          <div className="ws-sidebar-root" title={root}>{baseName(root) || root}</div>
          <div className="ws-sidebar-body">
            <Suspense fallback={<div className="tree-hint">Loading…</div>}>
              {root && <ProblemsPanel root={root} onOpenFile={openFile} onStatus={setStatus} />}
            </Suspense>
          </div>
        </aside>
      )}
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
        {/* The way back to the main HomeBot interface, at the top where people
            look for it. The status-bar Home and the activity-bar chat icon sit
            along the bottom edge and were not found. Open tabs and unsaved
            edits survive the trip (see `open`). */}
        <div className="ws-header">
          <button
            type="button"
            className="ws-header-back"
            onClick={back}
            title="Back to HomeBot (Esc)"
            aria-label="Back to HomeBot"
          >
            <span aria-hidden="true">←</span>
            Back
          </button>
          <span className="ws-header-root" title={root}>{baseName(root) || root}</span>
        </div>
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
              {/* The ● beside the name already says "unsaved" — but this ✕
                  closed the tab regardless, discarding edits to a real file
                  on one click. Only asks when there is something to lose.
                  (Leaving the workspace keeps tabs, so it needs no prompt.) */}
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
              // The DOM view is keyed per file, while the tab owns its editor
              // state so Back and tab switches preserve only that file's undo.
              key={active.path}
              session={active.editorSession}
              value={active.content}
              language={active.language}
              onSave={save}
              focusLine={reveal && reveal.path === active.path ? reveal.line : undefined}
              onFocusLineConsumed={() => setReveal(current => current === reveal ? null : current)}
              onChange={(next) =>
                setFiles(prev => prev.map(f => (f.path === active.path ? { ...f, content: next } : f)))
              }
            />
          ) : (
            <div className="ws-empty">
              <Icon name="document" size={30} />
              <p>Pick a file in the Explorer to start editing.</p>
              <p className="ws-empty-sub">
                Ctrl+S saves · Ctrl+` toggles the terminal · Ctrl+Shift+F searches · edits stay inside your home folder
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

      {assistantOpen && (
        <Suspense fallback={<div className="tree-hint">Loading assistant…</div>}>
          <WorkspaceAssistantPanel root={root} files={files} activePath={activePath} onClose={() => setAssistantOpen(false)} />
        </Suspense>
      )}

      {/* Status bar */}
      <footer className="ws-status" aria-label="Status bar">
        {/* The visible way home. The activity-bar icon at the far bottom-left
            was the only pointer exit and nobody found it — the shell covers
            the mode tabs, so "no way to nav home from code" was a fair read.
            A labelled button in the status bar is where VS Code users look for
            state, and it reads as an action, not chrome. Escape still works. */}
        <button type="button" className="ws-status-home" onClick={onHome ?? onClose}>
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
