import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useConfirmDestructive } from '../ConfirmDestructive';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import FileTree from './FileTree';
import CodeEditor, { type CodeEditorSession } from './CodeEditor';
import type { WorkspaceEntry } from '../../../shared/types';
import type { WorkspaceLanguageEdit } from '../../../shared/workspace-language-types';
import { stageWorkspaceDraftEdits } from './workspace-draft-edits';

const TerminalPanel = lazy(() => import('../TerminalPanel'));
// Lazy: the browser panel is off by default, and its first render triggers an
// attach in main — no reason to pay for either until it is actually opened.
const BrowserPanel = lazy(() => import('./BrowserPanel'));
const ChangesPanel = lazy(() => import('./ChangesPanel'));
const WorkspaceAssistantPanel = lazy(() => import('./WorkspaceAssistantPanel'));
const SourceControlPanel = lazy(() => import('./SourceControlPanel'));
const SearchPanel = lazy(() => import('./SearchPanel'));
const ProblemsPanel = lazy(() => import('./ProblemsPanel'));
const WorkspaceNavigator = lazy(() => import('./WorkspaceNavigator'));
const DebuggerPanel = lazy(() => import('./DebuggerPanel'));
const WorkspaceTestsPanel = lazy(() => import('./WorkspaceTestsPanel'));

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
  version?: string;
  eol?: 'lf' | 'crlf';
  bom?: boolean;
  disk?: { content: string; version: string; eol: 'lf' | 'crlf'; bom: boolean };
  missing?: boolean;
}

type SideView = 'explorer' | 'search' | 'problems' | 'changes' | 'scm' | 'debug' | 'tests' | null;

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
const parentPath = (p: string) => p.replace(/[\\/][^\\/]+$/, '');
const joinPath = (folder: string, name: string) => `${folder.replace(/[\\/]$/, '')}/${name}`;
const pathKey = (p: string) => /^[a-z]:/i.test(p) ? p.replace(/\\/g, '/').toLowerCase() : p;
const underPath = (file: string, folder: string) => pathKey(file) === pathKey(folder) || pathKey(file).startsWith(`${pathKey(folder).replace(/\/$/, '')}/`);

function reconcile(file: OpenFile, result: any): OpenFile {
  if (!result?.success) return result?.error?.match(/ENOENT|no longer exists/i) ? { ...file, missing: true } : file;
  if (result.version === file.version && file.version) return file.disk || file.missing ? { ...file, disk: undefined, missing: false } : file;
  if ((result.content ?? '') === file.original) return { ...file, version: result.version, eol: result.eol ?? file.eol, bom: result.bom ?? file.bom, disk: undefined, missing: false };
  if (file.content !== file.original) return { ...file, disk: { content: result.content ?? '', version: result.version, eol: result.eol ?? 'lf', bom: !!result.bom }, missing: false };
  return { ...file, content: result.content ?? '', original: result.content ?? '', version: result.version,
    eol: result.eol, bom: result.bom, disk: undefined, missing: false, editorSession: { current: null } };
}

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
   * Explorer root, a file opens in its project. A file outside the current
   * project goes through the same draft-preserving switch as the project picker.
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
  const [showHidden, setShowHidden] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [recentRoots, setRecentRoots] = useState<string[]>([]);
  const [recoveryReady, setRecoveryReady] = useState('');
  const [fileDialog, setFileDialog] = useState<{ action: string; path: string; value: string; error?: string; busy?: boolean } | null>(null);
  const [comparePath, setComparePath] = useState<string | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const savingPaths = useRef(new Set<string>());
  const [navigation, setNavigation] = useState<'files' | 'commands' | 'symbols' | null>(null);
  const [selection, setSelection] = useState<{ path: string; text: string; from?: number; to?: number } | null>(null);
  const [terminalOutput, setTerminalOutput] = useState('');
  const [splitPath, setSplitPath] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [panelHeight, setPanelHeight] = useState(260);
  const [splitRatio, setSplitRatio] = useState(50);
  const splitSessions = useRef<Record<string, CodeEditorSession>>({});
  const rootRef = useRef(root);
  rootRef.current = root;

  const api = (window as any).electron;
  const active = files.find(f => f.path === activePath) || null;
  const dirty = active ? active.content !== active.original : false;
  const back = onBack ?? onClose;
  // The navContext object each handoff arrived in, once applied. The shell now
  // outlives leaving the view, so re-opening it must not re-apply the same
  // handoff and pull focus off the tab the user was actually working in.
  const appliedHandoffRef = useRef<Record<string, unknown> | null>(null);
  const navContextRef = useRef(navContext);
  navContextRef.current = navContext;

  const openFile = useCallback(async (path: string, line?: number) => {
    const project = rootRef.current;
    try {
    // Existing tabs reconcile disk, preserving dirty drafts and flagging conflicts.
    const existing = files.find(f => pathKey(f.path) === pathKey(path));
    if (existing) {
      const result = await api?.workspaceRead?.(path);
      if (rootRef.current !== project) return;
      setFiles(prev => prev.map(f => f.path === existing.path ? reconcile(f, result) : f));
      setActivePath(existing.path);
      // A search result landing on an already-open tab still needs its jump.
      if (line) setReveal({ path: existing.path, line });
      return;
    }
    const res = await api?.workspaceRead?.(path);
    if (rootRef.current !== project) return;
    if (!res?.success) { setStatus(res?.error || 'Could not open that file.'); return; }
    const targetPath = res.path || path;
    if (!underPath(targetPath, project)) { setStatus('Open this file’s project first so its drafts can be recovered.'); return; }
    setFiles(prev => prev.some(f => pathKey(f.path) === pathKey(targetPath)) ? prev : [...prev, {
      path: targetPath,
      name: baseName(targetPath),
      content: res.content ?? '',
      original: res.content ?? '',
      language: res.language || 'plaintext',
      editorSession: { current: null },
      version: res.version, eol: res.eol, bom: res.bom,
    }]);
    setActivePath(targetPath);
    if (line) setReveal({ path: targetPath, line });
    setStatus(null);
    } catch { if (rootRef.current === project) setStatus('Could not open that file. Try again.'); }
  }, [files, api]);

  const syncFiles = useCallback(async () => {
    const snapshot = filesRef.current;
    const results = await Promise.all(snapshot.map(async f => ({ path: f.path, result: await Promise.resolve(api?.workspaceRead?.(f.path)).catch(() => ({ success: false, error: 'Could not refresh this file. Your draft is preserved.' })) })));
    setFiles(prev => prev.map(f => {
      const result = results.find(r => r.path === f.path);
      return result ? reconcile(f, result.result) : f;
    }));
  }, [api]);

  // Poll while visible plus on focus: all disk writers (AI, Git, tools, editors)
  // go through the same reconciliation, rather than only refreshing one panel.
  useEffect(() => {
    if (!open || !root) return;
    const refresh = () => { void syncFiles(); setRefreshToken(t => t + 1); };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [open, root, syncFiles]);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    setRecoveryReady('');
    void (async () => {
      const result = await api?.workspaceRecoveryLoad?.(root);
      if (cancelled) return;
      const saved = result?.state;
      if (saved?.schema === 1 && Array.isArray(saved.files)) {
        const restored: OpenFile[] = saved.files.filter((f: any) => typeof f.path === 'string' && underPath(f.path, root) && typeof f.content === 'string' && typeof f.original === 'string')
          .map((f: any) => ({ ...f, name: baseName(f.path), language: f.language || 'plaintext', editorSession: { current: null } }));
        const snapshots = await Promise.all(restored.map(f => api?.workspaceRead?.(f.path)));
        if (cancelled) return;
        setFiles(prev => [...prev, ...restored.filter(f => !prev.some(p => p.path === f.path)).map((f) => reconcile(f, snapshots[restored.indexOf(f)]))]);
        setActivePath(prev => prev || (restored.some(f => f.path === saved.activePath) ? saved.activePath : restored[0]?.path) || null);
        if (restored.some(f => f.content !== f.original)) setStatus('Recovered unsaved drafts.');
      } else if (result?.error) setStatus(`Draft recovery: ${result.error}`);
      setRecoveryReady(root);
      const recent = await api?.workspaceRecentProjects?.(root);
      if (!cancelled && recent?.success) setRecentRoots(recent.paths || []);
    })();
    return () => { cancelled = true; };
  }, [root, api]);

  const recoveryState = useCallback(() => ({ files: filesRef.current.filter(f => underPath(f.path, root)).map(({ editorSession: _session, disk: _disk, ...f }) => f), activePath }), [root, activePath]);
  useEffect(() => {
    if (!root || recoveryReady !== root || !api?.workspaceRecoverySave) return;
    const persist = () => { void api.workspaceRecoverySave(root, recoveryState()).then((r: any) => { if (r?.error) setStatus(`Draft recovery: ${r.error}`); }); };
    const timer = window.setTimeout(persist, 250);
    window.addEventListener('blur', persist);
    return () => { window.clearTimeout(timer); window.removeEventListener('blur', persist); };
  }, [files, activePath, root, recoveryReady, api, recoveryState]);

  const changeProject = useCallback(async (next: string, onChanged?: () => void, authority?: () => boolean) => {
    if (next === root) return;
    const current = () => rootRef.current === root && (!authority || authority());
    const change = async () => {
      if (!current()) return;
      const drafts = filesRef.current;
      if (api?.workspaceRecoverySave && root) {
        const result = await api.workspaceRecoverySave(root, recoveryState());
        if (!current()) return;
        if (!result?.success) { setStatus(result?.error || 'Could not preserve drafts.'); return; }
      }
      const checked = await api?.workspaceList?.(next);
      if (!current()) return;
      if (!checked?.success) { setStatus(checked?.error || 'Could not open that project.'); return; }
      if (filesRef.current !== drafts) { setStatus('The tabs changed while preserving drafts. Try switching projects again.'); return; }
      onChanged?.();
      setFiles([]); setActivePath(null); setRoot(checked.path || next); setStatus(null);
      setSplitPath(null); setSelection(null); setTerminalOutput('');
    };
    if (filesRef.current.some(f => f.content !== f.original)) confirm({ title: 'Switch projects and keep drafts?', body: <p>Your unsaved tabs will be stored for this project and restored when you return.</p>, confirmLabel: 'Keep drafts and switch', onConfirm: () => { void change(); } });
    else await change();
  }, [root, api, recoveryState, confirm]);

  const chooseProject = useCallback(async () => {
    const result = await api?.workspaceChooseProject?.();
    if (result?.success) await changeProject(result.path);
    else if (result?.error) setStatus(result.error);
  }, [api, changeProject]);

  // Bootstrap the initial root. Later file handoffs are handled separately
  // after recovery, using the normal project switch when their parent is outside.
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
            return;
          }
        }
      }
      const res = await api?.workspaceRoot?.();
      if (!cancelled && res?.path) setRoot(res.path);
    })();
    return () => { cancelled = true; };
  }, [open, root, navContext, api]);

  // Apply file handoffs only under their recovery root. Outside-project files
  // first join the ordinary draft-preserving switch, then recovery and opening.
  const ctxPath =
    typeof navContext?.path === 'string' ? navContext.path.trim() : '';
  useEffect(() => {
    // Bootstrap must commit its root before openFile captures that root. Join
    // draft recovery too, so a clean read cannot win over a saved dirty tab.
    if (!open || !ctxPath || !root || recoveryReady !== root) return;
    if (navContext && appliedHandoffRef.current === navContext) return;
    let cancelled = false;
    (async () => {
      // If the handoff's path is a directory we could live under, adopt it
      // (per-field guard — `prev => prev || ctxPath` keeps an existing root).
      const asDir = await api?.workspaceList?.(ctxPath);
      if (cancelled || rootRef.current !== root || navContextRef.current !== navContext) return;
      if (asDir?.success) {
        appliedHandoffRef.current = navContext ?? null;
        setRoot(prev => prev || (asDir.path || ctxPath));
        return;
      }
      if (!underPath(ctxPath, root)) {
        const parent = parentPath(ctxPath);
        const checked = parent && await api?.workspaceList?.(parent);
        if (cancelled || rootRef.current !== root || navContextRef.current !== navContext) return;
        if (!checked?.success) { appliedHandoffRef.current = navContext ?? null; setStatus(checked?.error || 'Could not open the handoff project.'); return; }
        const next = checked.path || parent;
        if (!underPath(next, root)) {
          appliedHandoffRef.current = navContext ?? null;
          await changeProject(next, () => { appliedHandoffRef.current = null; }, () => navContextRef.current === navContext);
          return;
        }
      }
      appliedHandoffRef.current = navContext ?? null;
      void openFile(ctxPath);
    })();
    return () => { cancelled = true; };
  }, [open, root, recoveryReady, ctxPath, navContext, api, openFile, changeProject]);


  const closeTab = useCallback((path: string) => {
    setFiles(prev => {
      const next = prev.filter(f => f.path !== path);
      setActivePath(cur => (cur === path ? (next[next.length - 1]?.path ?? null) : cur));
      return next;
    });
    setSplitPath(current => current === path ? null : current);
    delete splitSessions.current[path];
  }, []);

  const saveFile = useCallback(async (file: OpenFile, contentOverride?: string, expectedVersion?: string) => {
    const content = contentOverride ?? file.content;
    if (contentOverride !== undefined) setFiles(prev => prev.map(f => f.path === file.path ? { ...f, content } : f));
    if (savingPaths.current.has(file.path)) { setStatus('Save is still in progress. Your newer edits remain unsaved.'); return; }
    savingPaths.current.add(file.path);
    try {
    const res = await api?.workspaceSave?.(file.path, content, { expectedVersion: expectedVersion ?? file.version, eol: file.eol, bom: file.bom });
    if (res?.success) {
      // The write contains this snapshot. Edits made while its reply is pending
      // still need saving; marking the latest text clean would silently lose them.
      setFiles(prev => prev.map(f => (f.path === file.path ? { ...f, original: content, version: res.version, eol: res.eol ?? f.eol, bom: res.bom ?? f.bom, disk: undefined, missing: false } : f)));
      setStatus(`Saved ${file.name}`);
      window.setTimeout(() => setStatus(s => (s === `Saved ${file.name}` ? null : s)), 2000);
    } else {
      if (res?.conflict) setFiles(prev => prev.map(f => f.path === file.path ? { ...f, disk: res.disk, missing: !res.disk } : f));
      setStatus(res?.error || 'Save failed.');
    }
    } catch (e: any) { setStatus(e?.message || 'Save failed. Your draft is preserved.'); }
    finally { savingPaths.current.delete(file.path); }
  }, [api]);
  const save = useCallback(async (contentOverride?: string, expectedVersion?: string) => {
    const focusedPath = (document.activeElement?.closest('[data-workspace-editor]') as HTMLElement | null)?.dataset.workspaceEditor;
    const target = filesRef.current.find(f => f.path === focusedPath) || active;
    if (target) await saveFile(target, contentOverride, expectedVersion);
  }, [active, saveFile]);

  const applyLanguageEdits = useCallback(async (edits: WorkspaceLanguageEdit[]): Promise<boolean> => {
    try {
      const loaded: OpenFile[] = [];
      for (const edit of edits) {
        if (!underPath(edit.path, root)) throw new Error('Refactor edits must stay inside this project.');
        if (filesRef.current.some(f => pathKey(f.path) === pathKey(edit.path)) || loaded.some(f => pathKey(f.path) === pathKey(edit.path))) continue;
        const read = await api?.workspaceRead?.(edit.path);
        if (!read?.success) throw new Error(read?.error || 'Could not load a refactor target.');
        loaded.push({ path: edit.path, name: baseName(edit.path), content: read.content ?? '', original: read.content ?? '', language: read.language || 'plaintext', version: read.version, eol: read.eol, bom: read.bom, editorSession: { current: null } });
      }
      if (rootRef.current !== root) throw new Error('The project changed. No drafts were modified.');
      stageWorkspaceDraftEdits([...filesRef.current, ...loaded], edits);
      setFiles(prev => {
        try { return stageWorkspaceDraftEdits([...prev, ...loaded.filter(f => !prev.some(p => pathKey(p.path) === pathKey(f.path)))], edits); }
        catch (error: any) { setStatus(error?.message || 'Refactor targets changed.'); return prev; }
      });
      setStatus('Refactor staged in unsaved tabs. Review and save each file.');
      return true;
    } catch (error: any) { setStatus(error?.message || 'Refactor could not be applied.'); return false; }
  }, [root, api]);

  const runFileAction = useCallback(async (action: string, entry?: WorkspaceEntry) => {
    const target = entry?.path || activePath || root;
    if (action === 'copy-path') { try { await navigator.clipboard.writeText(target); setStatus('Path copied.'); } catch { setStatus('Could not copy the path.'); } return; }
    if (action === 'delete') {
      if (filesRef.current.some(f => underPath(f.path, target) && f.content !== f.original)) { setStatus('Save or close the unsaved tabs before deleting this file or folder.'); return; }
      confirm({ title: `Move “${baseName(target)}” to the recycle bin?`, body: <p>You can restore it from the operating system’s recycle bin. Open clean tabs inside it will close.</p>, confirmLabel: 'Move to recycle bin', onConfirm: () => {
        void api?.workspaceFileAction?.({ root, action, path: target }).then((res: any) => {
          if (!res?.success) { setStatus(res?.error || 'Could not remove this file.'); return; }
          setFiles(prev => prev.filter(f => !underPath(f.path, target))); setActivePath(prev => prev && underPath(prev, target) ? null : prev); setRefreshToken(t => t + 1);
        });
      } }); return;
    }
    if (action === 'reveal') { const res = await api?.workspaceFileAction?.({ root, action, path: target }); if (!res?.success) setStatus(res?.error || 'Could not show that file.'); return; }
    const folder = entry?.isDirectory ? target : action === 'create-file' || action === 'create-folder' ? root : parentPath(target);
    setFileDialog({ action, path: action === 'create-file' || action === 'create-folder' ? folder : target, value: action === 'move' ? baseName(target) : '' });
  }, [root, activePath, api, confirm]);

  const submitFileDialog = async () => {
    if (!fileDialog || fileDialog.busy || !fileDialog.value.trim()) return;
    const current = fileDialog;
    const name = current.value.trim();
    const destination = /^[a-z]:[\\/]|^[\\/]/i.test(name) ? name : joinPath(current.action === 'move' || current.action === 'save-as' ? parentPath(current.path) : current.path, name);
    setFileDialog({ ...current, busy: true, error: undefined });
    try {
      const action = current.action === 'save-as' ? 'create-file' : current.action;
      const result = await api?.workspaceFileAction?.({ root, action, path: action === 'move' ? current.path : destination,
        destination: action === 'move' ? destination : undefined, content: current.action === 'save-as' ? (active?.bom ? '\uFEFF' : '') + (active?.eol === 'crlf' ? (active?.content ?? '').replace(/\n/g, '\r\n') : active?.content ?? '') : '' });
      if (!result?.success) { setFileDialog({ ...current, error: result?.error || 'Could not change that file.' }); return; }
      if (action === 'move') {
        const moved = result.path || destination;
        setFiles(prev => prev.map(f => underPath(f.path, current.path) ? { ...f, path: `${moved}${f.path.slice(current.path.length)}`, name: baseName(`${moved}${f.path.slice(current.path.length)}`) } : f));
        setActivePath(prev => prev && underPath(prev, current.path) ? `${moved}${prev.slice(current.path.length)}` : prev);
        setSplitPath(prev => prev && underPath(prev, current.path) ? `${moved}${prev.slice(current.path.length)}` : prev);
      } else if (action === 'create-file') await openFile(result.path || destination);
      setRefreshToken(t => t + 1); setFileDialog(null);
    } catch (e: any) { setFileDialog({ ...current, error: e?.message || 'Could not change that file.' }); }
  };

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
      if (!e.defaultPrevented && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); setNavigation(e.shiftKey ? 'commands' : 'files'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') { e.preventDefault(); setNavigation('symbols'); }
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
    if (!open) { confirm(null); setNavigation(null); setComparePath(null); setFileDialog(null); }
  }, [open, confirm]);

  const [navigationFocus, setNavigationFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !navigationFocus || navigation || !activePath || pathKey(activePath) !== pathKey(navigationFocus)) return;
    const frame = window.requestAnimationFrame(() => {
      const host = [...document.querySelectorAll<HTMLElement>('[data-workspace-editor]')].find(node => pathKey(node.dataset.workspaceEditor || '') === pathKey(activePath));
      host?.querySelector<HTMLElement>('.cm-content')?.focus();
      setNavigationFocus(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationFocus, navigation, activePath, open]);

  if (!open) return null;

  const commands = [
    { id: 'open-project', label: 'Open project folder', run: chooseProject },
    { id: 'new-file', label: 'Create new file', run: () => runFileAction('create-file', { path: root, name: baseName(root), isDirectory: true, size: 0 }) },
    { id: 'new-folder', label: 'Create new folder', run: () => runFileAction('create-folder', { path: root, name: baseName(root), isDirectory: true, size: 0 }) },
    { id: 'save', label: 'Save active file', run: () => save() },
    { id: 'search', label: 'Search across project files', run: () => { setSideView('search'); setSearchFocusToken(t => t + 1); } },
    { id: 'terminal', label: 'Toggle terminal', run: () => setTerminalOpen(t => !t) },
    { id: 'assistant', label: 'Toggle coding assistant', run: () => setAssistantOpen(t => !t) },
    { id: 'changes', label: 'Review assistant changes', run: () => setSideView('changes') },
    { id: 'source-control', label: 'Show source control', run: () => setSideView('scm') },
    { id: 'problems', label: 'Run tasks and view problems', run: () => setSideView('problems') },
    { id: 'debug', label: 'Debug a JavaScript program', run: () => setSideView('debug') },
    { id: 'tests', label: 'Discover and run project tests', run: () => setSideView('tests') },
    { id: 'hidden', label: 'Toggle hidden project files', run: () => setShowHidden(t => !t) },
    { id: 'refresh', label: 'Refresh project and reconcile open files', run: async () => { await syncFiles(); setRefreshToken(t => t + 1); } },
  ];
  const renderEditor = (file: OpenFile, secondary = false) => <div data-workspace-editor={file.path} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
    <CodeEditor key={file.path} session={secondary ? (splitSessions.current[file.path] ||= { current: null }) : file.editorSession}
      root={root} filePath={file.path} buffers={files.map(f => ({ path: f.path, content: f.content }))}
      onNavigate={openFile} onApplyEdits={applyLanguageEdits} onSelection={setSelection}
      value={file.content} language={file.language} onSave={content => { void saveFile(file, content); }}
      focusLine={!secondary && reveal?.path === file.path ? reveal.line : undefined}
      onFocusLineConsumed={() => setReveal(current => current === reveal ? null : current)}
      onChange={content => setFiles(prev => prev.map(f => f.path === file.path ? { ...f, content } : f))} />
  </div>;


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
      {navigation && root && <Suspense fallback={<div role="status">Loading project navigation…</div>}><WorkspaceNavigator root={root} activePath={activePath ?? undefined} content={active?.content} buffers={files.map(f => ({ path: f.path, content: f.content }))} onOpen={async (path, line) => { await openFile(path, line); setNavigationFocus(path); }} commands={commands} mode={navigation} onClose={() => setNavigation(null)} /></Suspense>}
      {fileDialog && <div className="confirm-destructive-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1300 }}>
        <form className="confirm-destructive" role="dialog" aria-modal="true" aria-label="File action" onSubmit={e => { e.preventDefault(); void submitFileDialog(); }}>
          <h2>{fileDialog.action === 'move' ? 'Rename or move' : fileDialog.action === 'save-as' ? 'Save As' : fileDialog.action === 'create-folder' ? 'New folder' : 'New file'}</h2>
          <p>{fileDialog.action === 'move' ? 'Choose a new name or a full path inside this project.' : 'Choose a name or path inside this project. Existing files will be preserved.'}</p>
          <label>File or folder path<input autoFocus value={fileDialog.value} onChange={e => setFileDialog({ ...fileDialog, value: e.target.value, error: undefined })} onKeyDown={e => { if (e.key === 'Escape') setFileDialog(null); }} /></label>
          {fileDialog.error && <p role="alert">{fileDialog.error}</p>}
          <div className="confirm-destructive-actions"><button type="button" disabled={fileDialog.busy} onClick={() => setFileDialog(null)}>Cancel</button><button type="submit" disabled={fileDialog.busy || !fileDialog.value.trim()}>{fileDialog.busy ? 'Working…' : fileDialog.action === 'move' ? 'Move' : 'Create'}</button></div>
        </form>
      </div>}
      {comparePath && (() => { const file = files.find(f => f.path === comparePath); return file?.disk ? <div className="confirm-destructive-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1300 }}>
        <div className="confirm-destructive" role="dialog" aria-modal="true" aria-label="Compare disk and draft" style={{ width: 'min(1000px, 94vw)', maxWidth: '94vw' }}>
          <h2>Compare {file.name}</h2><p>Your draft is preserved. The disk version has not been overwritten.</p>
          <div style={{ display: 'flex', gap: 12 }}><label style={{ flex: 1 }}>Current disk<textarea readOnly aria-label="Current disk version" value={file.disk.content} style={{ width: '100%', height: '45vh', fontFamily: 'monospace' }} /></label><label style={{ flex: 1 }}>Your draft<textarea readOnly aria-label="Unsaved draft" value={file.content} style={{ width: '100%', height: '45vh', fontFamily: 'monospace' }} /></label></div>
          <button type="button" autoFocus onClick={() => setComparePath(null)}>Keep draft and close</button>
        </div>
      </div> : null; })()}
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
        <button type="button" className={`ws-activity-btn${sideView === 'debug' ? ' active' : ''}`} aria-label="Debugger" title="Debug JavaScript" aria-pressed={sideView === 'debug'} onClick={() => setSideView(v => v === 'debug' ? null : 'debug')}><Icon name="code" size={20} /></button>
        <button type="button" className={`ws-activity-btn${sideView === 'tests' ? ' active' : ''}`} aria-label="Project tests" title="Project tests" aria-pressed={sideView === 'tests'} onClick={() => setSideView(v => v === 'tests' ? null : 'tests')}><Icon name="tools" size={20} /></button>
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
        <aside className="ws-sidebar" aria-label="Source Control" style={{ width: sidebarWidth }}>
          <div className="ws-sidebar-title">Source Control</div>
          <div className="ws-sidebar-root" title={root}>{baseName(root) || root}</div>
          <div className="ws-sidebar-body">
            <Suspense fallback={<div className="tree-hint">Loading…</div>}>
              {root && <SourceControlPanel folder={root} onOpenFile={openFile} onFilesChanged={() => { void syncFiles(); setRefreshToken(t => t + 1); }} />}
            </Suspense>
          </div>
        </aside>
      )}
      {sideView === 'search' && (
        <aside className="ws-sidebar ws-sidebar-search" aria-label="Search" style={{ width: sidebarWidth }}>
          <div className="ws-sidebar-title">Search</div>
          <div className="ws-sidebar-root" title={root}>{baseName(root) || root}</div>
          <div className="ws-sidebar-body">
            <Suspense fallback={<div className="tree-hint">Loading…</div>}>
              {root && (
                <SearchPanel
                  root={root}
                  onOpenFile={openFile}
                  onReplaced={(summary) => { setStatus(summary); void syncFiles(); setRefreshToken(t => t + 1); }}
                  focusToken={searchFocusToken}
                />
              )}
            </Suspense>
          </div>
        </aside>
      )}
      {sideView === 'problems' && (
        <aside className="ws-sidebar ws-sidebar-problems" aria-label="Problems and tasks" style={{ width: sidebarWidth }}>
          <div className="ws-sidebar-title">Problems and tasks</div>
          <div className="ws-sidebar-root" title={root}>{baseName(root) || root}</div>
          <div className="ws-sidebar-body">
            <Suspense fallback={<div className="tree-hint">Loading…</div>}>
              {root && <ProblemsPanel root={root} onOpenFile={openFile} onStatus={setStatus} />}
            </Suspense>
          </div>
        </aside>
      )}
      {sideView === 'debug' && <aside className="ws-sidebar" aria-label="Debugger" style={{ width: sidebarWidth }}><div className="ws-sidebar-title">Debugger</div><div className="ws-sidebar-body"><Suspense fallback={<div className="tree-hint">Loading debugger…</div>}>{root && <DebuggerPanel root={root} activePath={activePath ?? undefined} onOpenFile={openFile} />}</Suspense></div></aside>}
      {sideView === 'tests' && <aside className="ws-sidebar" aria-label="Project tests" style={{ width: sidebarWidth }}><div className="ws-sidebar-title">Project tests</div><div className="ws-sidebar-body"><Suspense fallback={<div className="tree-hint">Loading tests…</div>}>{root && <WorkspaceTestsPanel root={root} onOpenFile={openFile} onDebugFile={async path => { await openFile(path); setSideView('debug'); }} />}</Suspense></div></aside>}
      {/* Sidebar */}
      {sideView === 'changes' && (
        <aside className="ws-sidebar" aria-label="Changes" style={{ width: sidebarWidth }}>
          <div className="ws-sidebar-title">Changes</div>
          <div className="ws-sidebar-root">What HomeBot edited this session</div>
          <div className="ws-sidebar-body">
            <Suspense fallback={<div className="tree-hint">Loading…</div>}>
              <ChangesPanel root={root} onOpenFile={openFile} />
            </Suspense>
          </div>
        </aside>
      )}
      {/* Sidebar */}
      {sideView === 'explorer' && (
        <aside className="ws-sidebar" aria-label="Explorer" style={{ width: sidebarWidth }}>
          <div className="ws-sidebar-title">Explorer</div>
          <div className="ws-sidebar-root" title={root}>{baseName(root) || root}</div>
          <div className="ws-sidebar-body">
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: 6 }}>
              <button onClick={() => { void runFileAction('create-file', { path: root, name: baseName(root), isDirectory: true, size: 0 }); }}>New file</button>
              <button onClick={() => { void runFileAction('create-folder', { path: root, name: baseName(root), isDirectory: true, size: 0 }); }}>New folder</button>
              <button onClick={() => { setRefreshToken(t => t + 1); void syncFiles(); }}>Refresh</button>
              <label><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />Hidden files</label>
            </div>
            {root && <FileTree root={root} activePath={activePath} onOpenFile={openFile} showHidden={showHidden} refreshToken={refreshToken} onAction={(action, entry) => { void runFileAction(action, entry); }} />}
          </div>
        </aside>
      )}

      {/* Editor area */}
      <main className="ws-main">
        {/* The way back to the main HomeBot interface, at the top where people
            look for it. The status-bar Home and the activity-bar chat icon sit
            along the bottom edge and were not found. Open tabs and unsaved
            edits survive the trip (see `open`). */}
        <div className="ws-header" style={{ flexWrap: 'wrap', padding: '5px 8px' }}>
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
          <button type="button" onClick={() => { void chooseProject(); }}>Open project</button>
          <select aria-label="Recent projects" value="" onChange={e => { if (e.target.value) void changeProject(e.target.value); }}>
            <option value="">Recent projects</option>{recentRoots.map(folder => <option key={folder} value={folder}>{folder}</option>)}
          </select>
          {active && <button type="button" onClick={() => setFileDialog({ action: 'save-as', path: active.path, value: '' })}>Save As</button>}
          <button type="button" onClick={() => setNavigation('files')} title="Quick Open (Ctrl+P)">Quick Open</button>
          <button type="button" onClick={() => setNavigation('commands')} title="Command palette (Ctrl+Shift+P)">Commands</button>
          <button type="button" disabled={!active} onClick={() => setSplitPath(current => current ? null : files.find(f => f.path !== activePath)?.path || activePath)}>{splitPath ? 'Close split' : 'Split editor'}</button>
          <details><summary>Layout</summary><div style={{ position: 'absolute', zIndex: 20, background: 'var(--ws-bg)', padding: 12, border: '1px solid var(--hairline)' }}>
            <label>Sidebar width<input type="range" aria-label="Sidebar width" min={160} max={600} value={sidebarWidth} onChange={e => setSidebarWidth(Number(e.target.value))} /></label>
            <label>Terminal height<input type="range" aria-label="Terminal height" min={90} max={500} value={panelHeight} onChange={e => setPanelHeight(Number(e.target.value))} /></label>
            <label>Split position<input type="range" aria-label="Split position" min={25} max={75} value={splitRatio} onChange={e => setSplitRatio(Number(e.target.value))} /></label>
          </div></details>
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

        <div className="ws-editor-area" style={{ flexDirection: 'column' }}>
          {active && (active.disk || active.missing) && <div role="alert" style={{ padding: 8, borderBottom: '1px solid var(--border-color)' }}>
            <span>{active.missing ? 'This file was removed on disk. Your draft is preserved.' : 'This file changed on disk. Your draft is preserved.'}</span>
            {active.disk && <>
              <button onClick={() => setComparePath(active.path)}>Compare</button>
              <button onClick={() => confirm({ title: `Reload “${active.name}” and discard your draft?`, body: <p>The current draft will be replaced by the disk version. Use Save As to keep a separate copy first.</p>, confirmLabel: 'Reload from disk', onConfirm: () => {
                void api?.workspaceRead?.(active.path).then((res: any) => { if (res?.success) setFiles(prev => prev.map(f => f.path === active.path ? reconcile({ ...f, content: f.original }, res) : f)); else setStatus(res?.error || 'Reload failed.'); });
              } })}>Reload disk</button>
              <button onClick={() => confirm({ title: `Replace disk with your draft for “${active.name}”?`, body: <p>The disk version shown by Compare will be replaced. If it changes again, Save will refuse and preserve both versions.</p>, confirmLabel: 'Replace reviewed disk version', onConfirm: () => { void save(undefined, active.disk?.version); } })}>Replace disk</button>
            </>}
            <button onClick={() => setFileDialog({ action: 'save-as', path: active.path, value: '' })}>Save draft as</button>
          </div>}
          {active ? (
            <>
              <nav aria-label="File breadcrumbs" style={{ padding: '4px 8px', opacity: 0.75, fontSize: 12 }}>{active.path.replace(/\\/g, '/').split('/').join(' › ')}</nav>
              <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
                <div style={{ display: 'flex', minHeight: 0, minWidth: 0, flex: splitPath ? `0 0 ${splitRatio}%` : '1' }}>{renderEditor(active)}</div>
                {splitPath && files.some(f => f.path === splitPath) && <section aria-label="Second editor" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, borderLeft: '2px solid var(--hairline)' }}>
                  <select aria-label="File in second editor" value={splitPath} onChange={e => setSplitPath(e.target.value)}>{files.map(f => <option key={f.path} value={f.path}>{f.name}</option>)}</select>
                  {renderEditor(files.find(f => f.path === splitPath)!, true)}
                </section>}
              </div>
            </>
          ) : (
            <div className="ws-empty">
              <Icon name="document" size={30} />
              <p>Pick a file in the Explorer to start editing.</p>
              <p className="ws-empty-sub">
                Ctrl+S saves · Ctrl+` toggles the terminal · Ctrl+Shift+F searches · Open project selects a folder
              </p>
            </div>
          )}
        </div>

        {terminalOpen && root && (
          <div className="ws-panel" aria-label="Panel" style={{ height: panelHeight }}>
            <Suspense fallback={<div className="tree-hint">Loading terminal…</div>}>
              <TerminalPanel key={root} open interactive onClose={() => setTerminalOpen(false)} projectPath={root} onSendToChat={text => { setTerminalOutput(text); setAssistantOpen(true); }} />
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
          <WorkspaceAssistantPanel root={root} files={files} activePath={activePath} selection={selection ?? undefined} terminalOutput={terminalOutput} onClose={() => setAssistantOpen(false)} />
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
