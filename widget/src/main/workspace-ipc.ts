/**
 * workspace-ipc.ts — filesystem surface for the Explorer and code editor.
 *
 * Distinct from tools/filesystem.ts, which is the LLM-facing tool set (permission
 * -gated, one call per action). This is the human-facing surface: directory
 * listings for a tree, file reads for an editor tab, and saves.
 *
 * The sandbox is SHARED, not reimplemented — `validatePath` comes from
 * tools/filesystem.ts, so the Explorer can never reach anywhere the tools
 * cannot. Everything degrades to { success: false } rather than throwing
 * across the IPC boundary.
 */

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validatePath } from './tools/filesystem';
import { runCodeSearch } from './tools/codebase';
import { gitWorkspaceBranches, gitWorkspaceCheckout, gitWorkspaceCommit, gitWorkspaceStage, gitWorkspaceStatus, gitWorkspaceUnstage } from './workspace-git';
import { applyProposal, listProposals, rejectProposal } from './workspace-proposals';

export const WORKSPACE_CHANNELS = {
  ROOT: 'homebot:workspace:root',
  LIST: 'homebot:workspace:list',
  READ: 'homebot:workspace:read',
  SAVE: 'homebot:workspace:save',
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

export interface WorkspaceReadResult {
  success: boolean;
  path?: string;
  content?: string;
  language?: string;
  truncated?: boolean;
  error?: string;
}

export interface WorkspaceSaveResult {
  success: boolean;
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
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.kt': 'kotlin', '.cs': 'csharp',
    '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp',
    '.php': 'php', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
    '.ps1': 'powershell', '.psm1': 'powershell',
    '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'ini', '.ini': 'ini',
    '.sql': 'sql', '.dockerfile': 'dockerfile', '.env': 'ini',
  };
  if (map[ext]) return map[ext];
  const base = path.basename(filePath).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  if (base.startsWith('.env')) return 'ini';
  return 'plaintext';
}

/** Heuristic binary check — a NUL byte in the first 8 KB. */
function looksBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, 8192);
  for (let i = 0; i < end; i++) if (buf[i] === 0) return true;
  return false;
}

/** Folders first, then files, each alphabetical — the Explorer convention. */
function sortEntries(a: WorkspaceEntry, b: WorkspaceEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export function registerWorkspaceIpc(getProjectPath: () => string | undefined): void {
  for (const channel of Object.values(WORKSPACE_CHANNELS)) ipcMain.removeHandler(channel);

  // Source Control panel. Each returns { success, ... } and never throws across IPC.
  const gitCall = async <T extends object>(run: () => Promise<T | void>) => {
    try { return { success: true, ...((await run()) || {}) }; } catch (e) { return { success: false, error: fail(e) }; }
  };
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_STATUS, (_e, folder: unknown) => gitCall(() => gitWorkspaceStatus(String(folder || ''))));
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_STAGE, (_e, folder: unknown, files: unknown) => gitCall(() => gitWorkspaceStage(String(folder || ''), files)));
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_UNSTAGE, (_e, folder: unknown, files: unknown) => gitCall(() => gitWorkspaceUnstage(String(folder || ''), files)));
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_COMMIT, (_e, folder: unknown, message: unknown) => gitCall(() => gitWorkspaceCommit(String(folder || ''), message)));
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_BRANCHES, (_e, folder: unknown) => gitCall(() => gitWorkspaceBranches(String(folder || ''))));
  ipcMain.handle(WORKSPACE_CHANNELS.GIT_CHECKOUT, (_e, folder: unknown, branch: unknown) => gitCall(() => gitWorkspaceCheckout(String(folder || ''), branch)));

  // IDE-3: edits the assistant proposed to this folder, waiting for review.
  ipcMain.handle(WORKSPACE_CHANNELS.PROPOSALS, () => {
    try { return { success: true, proposals: listProposals() }; }
    catch (err: any) { return { success: false, error: err?.message || 'Could not read the proposed changes.' }; }
  });
  ipcMain.handle(WORKSPACE_CHANNELS.PROPOSAL_ACCEPT, (_e, id: unknown, hunkIndexes: unknown) =>
    applyProposal(String(id || ''), Array.isArray(hunkIndexes) ? hunkIndexes.map(Number) : []));
  ipcMain.handle(WORKSPACE_CHANNELS.PROPOSAL_REJECT, (_e, id: unknown) => rejectProposal(String(id || '')));

  ipcMain.handle(WORKSPACE_CHANNELS.ROOT, async (): Promise<{ success: boolean; path: string }> => {
    const configured = (getProjectPath() || '').trim();
    if (configured) {
      const v = validatePath(configured);
      if (v.valid && fs.existsSync(v.resolved)) return { success: true, path: v.resolved };
    }
    return { success: true, path: os.homedir() };
  });

  ipcMain.handle(WORKSPACE_CHANNELS.LIST, async (_e, dirPath?: unknown): Promise<WorkspaceListResult> => {
    try {
      if (typeof dirPath !== 'string' || !dirPath) return { success: false, error: 'No directory given.' };
      const v = validatePath(dirPath);
      if (!v.valid) return { success: false, error: v.error };

      const dirents = fs.readdirSync(v.resolved, { withFileTypes: true });
      const entries: WorkspaceEntry[] = [];
      for (const d of dirents) {
        if (d.name.startsWith('.') && d.name !== '.env') continue;
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

  ipcMain.handle(WORKSPACE_CHANNELS.READ, async (_e, filePath?: unknown): Promise<WorkspaceReadResult> => {
    try {
      if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'No file given.' };
      const v = validatePath(filePath);
      if (!v.valid) return { success: false, error: v.error };

      const stat = fs.statSync(v.resolved);
      if (stat.isDirectory()) return { success: false, error: 'That is a folder, not a file.' };
      if (stat.size > MAX_EDITABLE_BYTES) {
        return { success: false, error: `File is too large to open (${Math.round(stat.size / 1024 / 1024)} MB).` };
      }

      const buf = fs.readFileSync(v.resolved);
      if (looksBinary(buf)) return { success: false, error: 'Binary file — cannot open in the editor.' };

      return {
        success: true,
        path: v.resolved,
        content: buf.toString('utf8'),
        language: languageForPath(v.resolved),
      };
    } catch (e) {
      return { success: false, error: fail(e) };
    }
  });

  ipcMain.handle(
    WORKSPACE_CHANNELS.SAVE,
    async (_e, filePath?: unknown, content?: unknown): Promise<WorkspaceSaveResult> => {
      try {
        if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'No file given.' };
        if (typeof content !== 'string') return { success: false, error: 'No content to save.' };
        const v = validatePath(filePath);
        if (!v.valid) return { success: false, error: v.error };
        // Only overwrite files that already exist — the editor is not a
        // create-anywhere surface, and this keeps saves inside what the user opened.
      if (!fs.existsSync(v.resolved)) return { success: false, error: 'File no longer exists.' };
      fs.writeFileSync(v.resolved, content, 'utf8');
      return { success: true };
    } catch (e) {
      return { success: false, error: fail(e) };
    }
  });

  // Search across files. Human-facing, but the ENGINE is the same one
  // `grep_code` uses — a person and the assistant cannot get two different
  // answers for the same query, and the sandbox is not reimplemented here.
  ipcMain.handle(
    WORKSPACE_CHANNELS.SEARCH,
    async (_e, opts?: unknown): Promise<WorkspaceSearchResult> => {
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
        });
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
    async (_e, filePath?: unknown, edits?: unknown): Promise<WorkspaceReplaceResult> => {
      try {
        if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'No file given.' };
        if (!Array.isArray(edits) || edits.length === 0) return { success: false, error: 'Nothing to replace.' };

        const v = validatePath(filePath);
        if (!v.valid) return { success: false, error: v.error };
        if (!fs.existsSync(v.resolved)) return { success: false, error: 'File no longer exists.' };

        const buf = fs.readFileSync(v.resolved);
        if (looksBinary(buf)) return { success: false, error: 'Binary file — cannot edit.' };

        const content = buf.toString('utf8');
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

        fs.writeFileSync(v.resolved, lines.join(eol), 'utf8');
        return { success: true, applied, skipped };
      } catch (e) {
        return { success: false, error: fail(e) };
      }
    },
  );
}

