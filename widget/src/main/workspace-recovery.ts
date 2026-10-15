import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { atomicWorkspaceWrite, checkedWorkspacePath } from './workspace-files';

/** Drafts belong to Electron userData, never the repository or another profile. */
export class WorkspaceRecoveryStore {
  constructor(private readonly directory: string) {}

  private file(root: string): string {
    const valid = checkedWorkspacePath(root);
    const key = createHash('sha256').update(process.platform === 'win32' ? valid.toLowerCase() : valid).digest('hex');
    return path.join(this.directory, 'workspace-recovery', `${key}.json`);
  }

  load(root: string): unknown {
    const file = this.file(root);
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > 12 * 1024 * 1024) throw new Error('The saved draft is too large to restore.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  save(root: string, state: unknown): void {
    const value = state as { files?: unknown[]; activePath?: unknown };
    if (!value || !Array.isArray(value.files) || value.files.length > 30) throw new Error('At most 30 tabs can be kept for recovery.');
    for (const item of value.files) {
      const f = item as Record<string, unknown>;
      if (!f || typeof f.path !== 'string' || typeof f.content !== 'string' || typeof f.original !== 'string') throw new Error('Invalid draft.');
      checkedWorkspacePath(f.path, root);
      if (Buffer.byteLength(f.content) > 2 * 1024 * 1024 || Buffer.byteLength(f.original) > 2 * 1024 * 1024) throw new Error('A draft exceeds the 2 MB editor limit.');
    }
    const bytes = Buffer.from(JSON.stringify({ ...value, schema: 1, savedAt: Date.now() }), 'utf8');
    if (bytes.length > 12 * 1024 * 1024) throw new Error('Draft recovery storage is limited to 12 MB per project.');
    const file = this.file(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicWorkspaceWrite(file, bytes);
  }

  recent(root?: string): string[] {
    const file = path.join(this.directory, 'workspace-recent.json');
    let roots: string[] = [];
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(saved)) roots = saved.filter((r): r is string => typeof r === 'string').slice(0, 10);
    }
    if (root) {
      const valid = checkedWorkspacePath(root);
      roots = [valid, ...roots.filter(r => r !== valid)].slice(0, 10);
      fs.mkdirSync(this.directory, { recursive: true });
      atomicWorkspaceWrite(file, Buffer.from(JSON.stringify(roots), 'utf8'));
    }
    return roots.filter(r => { try { return fs.statSync(checkedWorkspacePath(r)).isDirectory(); } catch { return false; } });
  }
}
