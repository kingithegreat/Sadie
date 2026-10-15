/** IDE filename search never delegates request authority to an external process. */
import * as fs from 'fs';
import * as path from 'path';
import { currentWorkspace, workspaceToolError } from './workspace-context';
import { checkedTrustedWorkspacePath } from './workspace-trust';
import type { ToolResult } from './tools/types';

import { getIdeCaps } from './ide-caps';

const MAX_DIRECTORIES = 256;

export async function findWorkspaceFiles(args: Record<string, any>): Promise<ToolResult> {
  try {
    const authority = currentWorkspace();
    if (!authority) throw new Error('An active IDE project is required.');
    const check = () => { const denied = workspaceToolError('find_files'); if (denied) throw new Error(denied); };
    check();
    const query = String(args.query ?? '').replace(/[\x00-\x1f]/g, '').slice(0, 200);
    if (!query.trim()) throw new Error('find_files: query is required');
    const root = checkedTrustedWorkspacePath(authority.root, args.path === undefined ? authority.root : args.path);
    const type = args.type ?? 'any';
    if (!['any', 'file', 'folder'].includes(type)) throw new Error('Choose file, folder, or any.');
    const limit = Math.min(Math.max(1, Number(args.limit) || 30), 100);
    const wildcard = /[*?]/.test(query) ? query : `*${query}*`;
    const matcher = new RegExp(`^${wildcard.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
    const caps = getIdeCaps(), MAX_ENTRIES = caps.maxFiles, MAX_DEPTH = Math.min(caps.maxDepth, 20), MAX_TIME_MS = caps.findTimeoutMs;
    const skipped = new Set<string>();
    const queue = [{ directory: root, depth: 0 }], seen = new Set<string>();
    const results: { name: string; path: string; type: 'file' | 'folder' }[] = [];
    const started = Date.now(); let scanned = 0, directories = 0, skippedLinks = 0, truncated = false;
    outer: while (queue.length) {
      check();
      if (directories >= MAX_DIRECTORIES) { truncated = true; skipped.add(`stopped after ${MAX_DIRECTORIES} folders`); break; }
      if (Date.now() - started >= MAX_TIME_MS) { truncated = true; skipped.add(`stopped at the ${MAX_TIME_MS} ms time limit`); break; }
      const item = queue.shift()!, canonical = checkedTrustedWorkspacePath(authority.root, item.directory);
      if (seen.has(canonical)) continue;
      seen.add(canonical); directories++;
      // Opening a directory yields names, not contents. Revalidate after this
      // await as well, so a redirected parent does not become a traversal root.
      const directory = await fs.promises.opendir(canonical);
      try {
        check(); checkedTrustedWorkspacePath(authority.root, canonical);
        for await (const entry of directory) {
          check();
          if (scanned >= MAX_ENTRIES) { truncated = true; skipped.add(`stopped after scanning ${MAX_ENTRIES.toLocaleString('en-US')} entries`); break outer; }
          if (Date.now() - started >= MAX_TIME_MS) { truncated = true; skipped.add(`stopped at the ${MAX_TIME_MS} ms time limit`); break outer; }
          scanned++;
          // Symlink/junction entries never grant traversal or leak their target.
          if (entry.isSymbolicLink()) { skippedLinks++; continue; }
          const target = checkedTrustedWorkspacePath(authority.root, path.join(canonical, entry.name));
          const entryType = entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : undefined;
          if (!entryType) continue;
          if ((type === 'any' || type === entryType) && matcher.test(entry.name)) {
            results.push({ name: entry.name, path: target, type: entryType });
            if (results.length >= limit) { truncated = true; skipped.add(`showing the first ${limit} matches`); break outer; }
          }
          if (entry.isDirectory()) {
            if (item.depth < MAX_DEPTH && queue.length < MAX_DIRECTORIES) queue.push({ directory: target, depth: item.depth + 1 });
            else { truncated = true; skipped.add(item.depth >= MAX_DEPTH ? `folders deeper than ${MAX_DEPTH} levels were skipped` : 'some folders were skipped (folder budget)'); }
          }
        }
      } finally { await directory.close().catch(error => { if (error?.code !== 'ERR_DIR_CLOSED') throw error; }); }
    }
    check();
    return { success: true, result: { query, root, count: results.length, results, engine: 'workspace', scanned, skippedLinks, truncated,
      ...(truncated ? { warning: `Search reached a budget: ${[...skipped].join('; ')}. Refine the directory or query for more results.` } : {}) } };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Project filename search failed.' }; }
}
