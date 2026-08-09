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

export const WORKSPACE_CHANNELS = {
  ROOT: 'homebot:workspace:root',
  LIST: 'homebot:workspace:list',
  READ: 'homebot:workspace:read',
  SAVE: 'homebot:workspace:save',
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
    },
  );
}
