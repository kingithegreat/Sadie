/**
 * workspace-ipc.ts — filesystem surface for the Explorer and code editor.
 *
 * Distinct from tools/filesystem.ts, which is the LLM-facing tool set (permission
 * -gated, one call per action). This is the human-facing surface: directory
 * listings for a tree, file reads for an editor tab, and saves.
 *
 * Home access and native-approved project roots are validated in main.
 * These routes require the trusted main window/frame. Everything degrades
 * to { success: false } rather than throwing
 * across the IPC boundary.
 */

import { app, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { chooseTrustedWorkspaceFolder, validateTrustedWorkspaceRoot } from './workspace-trust';
import { atomicProjectWrite } from './workspace-atomic';
import { runCodeSearch } from './tools/codebase';
import { gitWorkspaceBranches, gitWorkspaceCheckout, gitWorkspaceCommit, gitWorkspaceStage, gitWorkspaceStatus, gitWorkspaceUnstage } from './workspace-git';
import { applyProposal, listProposals, rejectProposal } from './workspace-proposals';
import { checkedWorkspacePath, readWorkspaceSnapshot, saveWorkspaceSnapshot } from './workspace-files';
import { WorkspaceRecoveryStore } from './workspace-recovery';
import { getMainWindow } from './window-manager';
import type { WorkspaceReadResult, WorkspaceSaveResult } from '../shared/workspace-file-types';
export type { WorkspaceReadResult, WorkspaceSaveResult } from '../shared/workspace-file-types';

export const WORKSPACE_CHANNELS = {
  ROOT: 'homebot:workspace:root',
  LIST: 'homebot:workspace:list',
  READ: 'homebot:workspace:read',
  SAVE: 'homebot:workspace:save',
  FILE_ACTION: 'homebot:workspace:file-action',
  CHOOSE_PROJECT: 'homebot:workspace:choose-project',
  RECENT_PROJECTS: 'homebot:workspace:recent-projects',
  RECOVERY_LOAD: 'homebot:workspace:recovery-load',
  RECOVERY_SAVE: 'homebot:workspace:recovery-save',
  SEARCH: 'homebot:workspace:search',
  REPLACE: 'homebot:workspace:replace',
  GIT_STATUS: 'homebot:workspace:git-status',
  GIT_STAGE: 'homebot:workspace:git-stage',
  GIT_UNSTAGE: 'homebot:workspace:git-unstage',
  GIT_COMMIT: 'homebot:workspace:git-commit',
  GIT_BRANCHES: 'homebot:workspace:git-branches',
  GIT_CHECKOUT: 'homebot:workspace:git-checkout',
  PROPOSALS: 'homebot:workspace:proposals',
  PROPOSAL_ACCEPT: 'homebot:workspace:proposal-accept',
  PROPOSAL_REJECT: 'homebot:workspace:proposal-reject',
} as const;

/** Refuse to open anything an editor pane cannot usefully show. */
const MAX_EDITABLE_BYTES = 2 * 1024 * 1024; // 2 MB

/** Directories that make a tree unusable and are never interesting to browse. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', 'out', '.next', '.cache',
  '__pycache__', '.venv', 'venv', 'target', 'build',
]);

// WorkspaceEntry is defined once, in shared/types.ts — the renderer needs the
// same shape for its ElectronAPI typing, and two identical exported interfaces
// is how the duplicate-export guard reads "parallel build". Re-exported here so
// existing `import { WorkspaceEntry } from './workspace-ipc'` sites still work.
export type { WorkspaceEntry } from '../shared/types';
import type { WorkspaceEntry } from '../shared/types';

export interface WorkspaceListResult {
  success: boolean;
  path?: string;
  entries?: WorkspaceEntry[];
  error?: string;
}

/** One hit from a workspace content search. */
export interface WorkspaceSearchMatch {
  /** Path relative to the search root — what the list shows. */
  file: string;
  /** Absolute path — what a click needs to open the file. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** The matching line. */
  text: string;
}

export interface WorkspaceSearchResult {
  success: boolean;
  pattern?: string;
  directory?: string;
  match_count?: number;
  matches?: WorkspaceSearchMatch[];
  error?: string;
}

/** A single line-level replacement the preview showed and the user accepted. */
export interface WorkspaceReplaceEdit {
  /** 1-based line number. */
  line: number;
  /** The line's text as the search saw it. Asserted before writing. */
  oldText: string;
  /** The substitution to apply. */
  newText: string;
}

export interface WorkspaceReplaceResult {
  success: boolean;
  applied?: number;
  /** Lines that could not be changed, with a plain reason. */
  skipped?: Array<{ line: number; reason: string }>;
  error?: string;
}

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Map an extension to a highlight.js language id. */
export function languageForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.json': 'json', '.jsonc': 'json',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.svg': 'xml', '.vue': 'xml',
    '.md': 'markdown', '.markdown': 'markdown',
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.lua': 'lua', '.luau': 'luau',
    '.java': 'java', '.kt': 'kotlin', '.cs': 'csharp',
    '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp',
    '.php': 'php', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
    '.ps1': 'powershell', '.psm1': 'powershell',
    '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.ini': 'ini',
    '.sql': 'sql', '.dockerfile': 'dockerfile', '.env': 'ini',
  };
  if (map[ext]) return map[ext];
  const base = path.basename(filePath).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  if (base.startsWith('.env')) return 'ini';
  return 'plaintext';
}

/** Folders first, then files, each alphabetical — the Explorer convention. */
function sortEntries(a: WorkspaceEntry, b: WorkspaceEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export function registerWorkspaceIpc(getProjectPath: () => string | undefined): void {
  for (const channel of Object.values(WORKSPACE_CHANNELS)) ipcMain.removeHandler(channel);
  const recovery = () => new WorkspaceRecoveryStore(app.getPath('userData'));
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    const window = getMainWindow();
    return !!window && !window.isDestroyed() && event.sender === window.webContents && !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
  };
  const denied = () => ({ success: false, error: 'Open the HomeBot workspace to use this action.' });
  ipcMain.handle(WORKSPACE_CHANNELS.CHOOSE_PROJECT, async (event) => {
    if (!trusted(event)) return denied();
    try {
      const chosen = await chooseTrustedWorkspaceFolder(event);
      if (chosen.cancelled || !chosen.root) return { success: false, cancelled: true };
      const folder = chosen.root;
      recovery().recent(folder);
      return { success: true, path: folder };
    } catch (e) { return { success: false, error: fail(e) }; }
  });
  ipcMain.handle(WORKSPACE_CHANNELS.RECENT_PROJECTS, (event, folder?: unknown) => {
    if (!trusted(event)) return denied();
    try { return { success: true, paths: recovery().recent(typeof folder === 'string' ? folder : undefined) }; }
    catch (e) { return { success: false, error: fail(e) }; }
  });
  ipcMain.handle(WORKSPACE_CHANNELS.RECOVERY_LOAD, (event, folder: string) => {
    if (!trusted(event)) return denied();
    try { return { success: true, state: recovery().load(folder) }; }
    catch (e) { return { success: false, error: fail(e) }; }
  });
  ipcMain.handle(WORKSPACE_CHANNELS.RECOVERY_SAVE, (event, folder: string, state: unknown) => {
    if (!trusted(event)) return denied();
    try { recovery().save(folder, state); return { success: true }; }
    catch (e) { return { success: false, error: fail(e) }; }
  });
  ipcMain.handle(WORKSPACE_CHANNELS.FILE_ACTION, async (event, input: unknown) => {
    if (!trusted(event)) return denied();
    try {
      const a = (input || {}) as Record<string, unknown>;
      if (typeof a.root !== 'string' || typeof a.path !== 'string') throw new Error('No project or file path given.');
      const root = validateTrustedWorkspaceRoot(a.root);
      const target = checkedWorkspacePath(a.path, root);
      if (path.relative(root, target) === '' || (fs.existsSync(target) && fs.realpathSync(root) === fs.realpathSync(target))) throw new Error('The project folder itself cannot be moved or deleted here.');
      if (a.action === 'create-file') {
        if (typeof a.content !== 'string') throw new Error('No content to create.');
        if (Buffer.byteLength(a.content) > MAX_EDITABLE_BYTES) throw new Error('File is too large (maximum 2 MB).');
        atomicProjectWrite(target, Buffer.from(a.content, 'utf8'), { expectedExists: false, validate: () => { checkedWorkspacePath(a.path as string, root); } });
      } else if (a.action === 'create-folder') {
        fs.mkdirSync(target);
      } else if (a.action === 'move') {
        if (typeof a.destination !== 'string') throw new Error('Choose a destination.');
        const destination = checkedWorkspacePath(a.destination, root);
        if (fs.existsSync(destination)) throw new Error('A file or folder already exists at that destination.');
        fs.renameSync(target, destination);
        return { success: true, path: destination };
      } else if (a.action === 'delete') {
        // OS recycle bin, never recursive permanent deletion from the renderer.
        await shell.trashItem(target);
      } else if (a.action === 'reveal') {
        shell.showItemInFolder(target);
      } else throw new Error('Unknown file action.');
      return { success: true, path: target };
    } catch (e) { return { success: false, error: fail(e) }; }
  });

  // Source Control panel. Each returns { success, ... } and never throws across IPC.
  const gitCall = async <T extends object>(run: () => Promise<T | void>) => {
    try { return { success: true, ...((await run()) || {}) }; } catch (e) { return { success: false, error: fail(e) }; }
  };
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_STATUS, (e, folder: unknown) => trusted(e) ? gitCall(() => gitWorkspaceStatus(String(folder || ''))) : denied());
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_STAGE, (e, folder: unknown, files: unknown) => trusted(e) ? gitCall(() => gitWorkspaceStage(String(folder || ''), files)) : denied());
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_UNSTAGE, (e, folder: unknown, files: unknown) => trusted(e) ? gitCall(() => gitWorkspaceUnstage(String(folder || ''), files)) : denied());
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_COMMIT, (e, folder: unknown, message: unknown) => trusted(e) ? gitCall(() => gitWorkspaceCommit(String(folder || ''), message)) : denied());
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_BRANCHES, (e, folder: unknown) => trusted(e) ? gitCall(() => gitWorkspaceBranches(String(folder || ''))) : denied());
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_CHECKOUT, (e, folder: unknown, branch: unknown) => trusted(e) ? gitCall(() => gitWorkspaceCheckout(String(folder || ''), branch)) : denied());

  // IDE-3: edits the assistant proposed to this folder, waiting for review.
  ipcMain.handle(WORKSPACE_CHANNELS.PROPOSALS, (event, root?: string) => {
    if (!trusted(event)) return denied();
    try { return { success: true, proposals: listProposals(root ? validateTrustedWorkspaceRoot(root) : undefined) }; }
    catch (err: any) { return { success: false, error: err?.message || 'Could not read the proposed changes.' }; }
  });
  ipcMain.handle(WORKSPACE_CHANNELS.PROPOSAL_ACCEPT, (e, id: unknown, hunkIndexes: unknown) => trusted(e) ?
    applyProposal(String(id || ''), Array.isArray(hunkIndexes) ? hunkIndexes.map(Number) : []) : denied());
  ipcMain.handle(WORKSPACE_CHANNELS.PROPOSAL_REJECT, (e, id: unknown) => trusted(e) ? rejectProposal(String(id || '')) : denied());

  ipcMain.handle(WORKSPACE_CHANNELS.ROOT, async (event) => {
    if (!trusted(event)) return denied();
    const configured = (getProjectPath() || '').trim();
    if (configured) {
      try { return { success: true, path: validateTrustedWorkspaceRoot(configured) }; } catch { /* Fall back to home when an old project is unavailable. */ }
    }
    // Use the same canonical trusted root as LIST/READ. macOS homes may be
    // /var aliases of /private/var; lexical roots cannot own canonical drafts.
    try { return { success: true, path: validateTrustedWorkspaceRoot(os.homedir()) }; }
    catch (e) { return { success: false, error: fail(e) }; }
  });

  ipcMain.handle(WORKSPACE_CHANNELS.LIST, async (event, dirPath?: unknown, options?: { showHidden?: boolean }): Promise<WorkspaceListResult> => {
    if (!trusted(event)) return denied();
    try {
      if (typeof dirPath !== 'string' || !dirPath) return { success: false, error: 'No directory given.' };
      const v = { resolved: checkedWorkspacePath(dirPath) };

      const dirents = fs.readdirSync(v.resolved, { withFileTypes: true });
      const entries: WorkspaceEntry[] = [];
      for (const d of dirents) {
        if (d.name.startsWith('.') && d.name !== '.env' && options?.showHidden !== true) continue;
        if (d.isDirectory() && IGNORED_DIRS.has(d.name)) continue;
        const full = path.join(v.resolved, d.name);
        let size = 0;
        // A broken symlink or a permission-denied entry must not kill the listing.
        try { if (d.isFile()) size = fs.statSync(full).size; } catch { /* skip size */ }
        entries.push({ name: d.name, path: full, isDirectory: d.isDirectory(), size });
      }
      return { success: true, path: v.resolved, entries: entries.sort(sortEntries) };
    } catch (e) {
      return { success: false, error: fail(e) };
    }
  });

  ipcMain.handle(WORKSPACE_CHANNELS.READ, async (event, filePath?: unknown): Promise<WorkspaceReadResult> => {
    if (!trusted(event)) return denied();
    try {
      if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'No file given.' };
      const v = { resolved: checkedWorkspacePath(filePath) };
      return {
        success: true,
        path: v.resolved,
        ...readWorkspaceSnapshot(v.resolved),
        language: languageForPath(v.resolved),
      };
    } catch (e) {
      return { success: false, error: fail(e) };
    }
  });

  ipcMain.handle(
    WORKSPACE_CHANNELS.SAVE,
    async (event, filePath?: unknown, content?: unknown, options?: { expectedVersion?: string; eol?: 'lf' | 'crlf'; bom?: boolean }): Promise<WorkspaceSaveResult> => {
      if (!trusted(event)) return denied();
      try {
        if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'No file given.' };
        if (typeof content !== 'string') return { success: false, error: 'No content to save.' };
        const v = { resolved: checkedWorkspacePath(filePath) };
        return saveWorkspaceSnapshot(v.resolved, content, options);
    } catch (e) {
      return { success: false, error: fail(e) };
    }
  });

  // Search across files. Human-facing, but the ENGINE is the same one
  // `grep_code` uses — a person and the assistant cannot get two different
  // answers for the same query, and the sandbox is not reimplemented here.
  ipcMain.handle(
    WORKSPACE_CHANNELS.SEARCH,
    async (event, opts?: unknown): Promise<WorkspaceSearchResult> => {
      if (!trusted(event)) return denied();
      try {
        const o = (opts || {}) as Record<string, unknown>;
        const pattern = String(o.pattern || '').trim();
        if (!pattern) return { success: false, error: 'Type something to search for.' };

        const res = await runCodeSearch({
          pattern,
          directory: String(o.directory || getProjectPath() || os.homedir()),
          caseSensitive: o.case_sensitive === true,
          filePattern: String(o.file_pattern || ''),
          // The panel shows one line per hit; context would double the payload
          // for something a click already reveals by opening the file.
          contextLines: 0,
          maxResults: 200,
        }, checkedWorkspacePath);
        if (!res.success || !res.matches) return { success: false, error: res.error };

        const directory = res.resolvedDirectory as string;
        return {
          success: true,
          pattern,
          directory,
          match_count: res.matches.length,
          matches: res.matches.map(m => ({
            file: path.relative(directory, m.file),
            path: m.file,
            line: m.line,
            text: m.text.slice(0, 500),
          })),
        };
      } catch (e) {
        return { success: false, error: fail(e) };
      }
    },
  );

  // Replace across files. Line-exact: every edit carries the text the search
  // saw on that line, and the write is refused for any line that no longer
  // matches — so a file edited since the search is reported, not clobbered.
  ipcMain.handle(
    WORKSPACE_CHANNELS.REPLACE,
    async (event, filePath?: unknown, edits?: unknown): Promise<WorkspaceReplaceResult> => {
      if (!trusted(event)) return denied();
      try {
        if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'No file given.' };
        if (!Array.isArray(edits) || edits.length === 0) return { success: false, error: 'Nothing to replace.' };

        const v = { resolved: checkedWorkspacePath(filePath) };
        if (!fs.existsSync(v.resolved)) return { success: false, error: 'File no longer exists.' };

        const snapshot = readWorkspaceSnapshot(v.resolved);
        const content = snapshot.content;
        // Keep the file's own line-ending style on the way back out.
        const eol = content.includes('\r\n') ? '\r\n' : '\n';
        const lines = content.split(/\r?\n/);

        const parsed = edits
          .map((e: unknown) => {
            const r = (e || {}) as Record<string, unknown>;
            return {
              line: Math.floor(Number(r.line) || 0),
              oldText: String(r.oldText ?? ''),
              newText: String(r.newText ?? ''),
            };
          })
          .filter(e => e.line >= 1)
          // Bottom-up: a replacement containing a newline changes the line
          // count, so indexes below an applied edit must not shift.
          .sort((a, b) => b.line - a.line);

        let applied = 0;
        const skipped: Array<{ line: number; reason: string }> = [];
        for (const e of parsed) {
          const idx = e.line - 1;
          if (idx >= lines.length) { skipped.push({ line: e.line, reason: 'line no longer exists' }); continue; }
          if (lines[idx] !== e.oldText) { skipped.push({ line: e.line, reason: 'line changed since the search' }); continue; }
          lines.splice(idx, 1, ...e.newText.split(/\r?\n/));
          applied++;
        }

        if (applied === 0) {
          return {
            success: false,
            applied: 0,
            skipped,
            error: skipped.length
              ? 'No lines were changed — every target line had moved on since the search.'
              : 'Nothing to replace.',
          };
        }

        const saved = saveWorkspaceSnapshot(v.resolved, lines.join(eol), { expectedVersion: snapshot.version });
        if (!saved.success) return { success: false, applied: 0, skipped, error: saved.error };
        return { success: true, applied, skipped };
      } catch (e) {
        return { success: false, error: fail(e) };
      }
    },
  );
}

