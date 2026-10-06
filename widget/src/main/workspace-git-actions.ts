import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { validateTrustedWorkspaceRoot, checkedTrustedWorkspacePath } from './workspace-trust';
import { workspaceRepositoryRoot, runWorkspaceGit, workspaceGitPaths } from './workspace-git';
import type { WorkspaceGitActionRequest, WorkspaceGitActionResult } from '../shared/workspace-git-action-types';
const exec = promisify(execFile);
const within = (root: string, file: string) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
function folderPath(input: string): string { return validateTrustedWorkspaceRoot(input); }
function filePath(root: string, input: string | undefined): string {
  const [file] = workspaceGitPaths(root, [input]);
  const absolute = path.resolve(root, file);
  if (fs.existsSync(absolute) && !within(root, fs.realpathSync(absolute))) throw new Error('That linked file is outside the repository.');
  return file;
}
/** Preserve the full diff header; individual hunks are applied to the index only. */
export function splitWorkspaceGitHunks(diff: string): Array<{ index: number; header: string; patch: string }> {
  if (/^GIT binary patch$|^Binary files /m.test(diff)) return [];
  const starts = [...diff.matchAll(/^@@ .+ @@.*$/gm)];
  if (!starts.length) return [];
  const header = diff.slice(0, starts[0].index);
  return starts.map((match, index) => ({ index, header: match[0], patch: header + diff.slice(match.index!, starts[index + 1]?.index ?? diff.length) }));
}
async function applyIndexPatch(root: string, patch: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['apply', '--cached', '--recount', '--whitespace=nowarn', '-'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let error = ''; const timeout = setTimeout(() => { child.kill(); reject(new Error('Staging the hunk timed out.')); }, 20_000);
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-4000); }); child.stdout.resume();
    child.on('error', cause => { clearTimeout(timeout); reject(cause); });
    child.on('close', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(error || 'Git could not stage that hunk.')); });
    child.stdin.end(patch);
  });
}
export function gitWorkspaceConfirmation(request: WorkspaceGitActionRequest): string | null {
  const messages: Partial<Record<WorkspaceGitActionRequest['action'], string>> = {
    clone: `Clone ${request.url || ''} into ${request.target || ''}? This contacts the repository server.`,
    fetch: 'Fetch updates from the configured remote? This contacts the repository server.',
    pull: 'Pull the configured remote with fast-forward only? Clean files may change; dirty drafts must be saved or kept separately.',
    push: 'Push this branch to its configured upstream? This publishes your committed changes.',
    'stash-pop': 'Restore the latest stash into this working tree? Git may report merge conflicts.',
    stash: 'Stash tracked working-tree changes? Save or keep your editor drafts separately first.',
    'resolve-conflict': `Replace the working copy of ${request.file || ''} with the reviewed ${request.resolution || ''} resolution?`,
  };
  return messages[request.action] ? `Project: ${request.folder}\n\n${messages[request.action]}` : null;
}
export async function performWorkspaceGitAction(request: WorkspaceGitActionRequest): Promise<WorkspaceGitActionResult> {
  try {
    if (!request || typeof request.folder !== 'string') throw new Error('Choose a valid project folder.');
    const directory = folderPath(request.folder);
    if (request.action === 'init') { await runWorkspaceGit(['init'], directory); return { success: true }; }
    if (request.action === 'clone') {
      if (typeof request.url !== 'string' || !/^(https:\/\/[^\s]+|git@[^\s:]+:[^\s]+)$/.test(request.url)) throw new Error('Enter an HTTPS or SSH repository address.');
      if (typeof request.target !== 'string' || !/^[\w .-]{1,100}$/.test(request.target) || ['.', '..'].includes(request.target)) throw new Error('Enter a new folder name for the clone.');
      const target = path.join(directory, request.target);
      if (fs.existsSync(target)) throw new Error('The clone destination already exists; choose a new folder.');
      await exec('git', ['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'clone', '--', request.url, target], { cwd: directory, windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
      return { success: true, text: target };
    }
    const root = await workspaceRepositoryRoot(directory); if (!root) throw new Error('This project is not in a Git repository.');
    const run = (args: string[]) => runWorkspaceGit(['--literal-pathspecs', ...args], root);
    switch (request.action) {
      case 'diff': case 'stage-hunk': {
        const file = filePath(root, request.file);
        let diff = await run(['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(request.staged ? ['--cached'] : []), '--', file]);
        if (!diff && !request.staged && fs.existsSync(path.join(root, file))) {
          const tracked = await run(['ls-files', '--error-unmatch', '--', file]).then(() => true, () => false);
          if (!tracked) {
            const text = fs.readFileSync(path.join(root, file), 'utf8');
            if (Buffer.byteLength(text) > 2 * 1024 * 1024 || text.includes('\0')) throw new Error('This file is too large or binary for the text diff.');
            const lines = text.split('\n'); if (lines[lines.length - 1] === '') lines.pop();
            diff = `diff --git ${JSON.stringify('a/' + file)} ${JSON.stringify('b/' + file)}\nnew file mode 100644\n--- /dev/null\n+++ ${JSON.stringify('b/' + file)}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}\n${text.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`;
          }
        }
        if (request.action === 'diff') return { success: true, diff, hunks: splitWorkspaceGitHunks(diff) };
        if (request.staged) throw new Error('Choose an unstaged hunk.');
        if (typeof request.expectedDiff !== 'string' || request.expectedDiff !== diff) throw new Error('The diff changed. Refresh it before staging a hunk.');
        const hunks = splitWorkspaceGitHunks(diff); const hunk = hunks.find(item => item.index === request.hunk);
        if (!hunk) throw new Error('Choose a valid text hunk.');
        await applyIndexPatch(root, hunk.patch); return { success: true };
      }
      case 'fetch': await run(['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'fetch', '--prune']); return { success: true };
      case 'pull': await run(['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'pull', '--ff-only']); return { success: true };
      case 'push': await run(['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'push']); return { success: true };
      case 'create-branch': {
        if (typeof request.branch !== 'string' || !request.branch.trim() || request.branch.length > 200) throw new Error('Enter a branch name.');
        await run(['check-ref-format', '--branch', request.branch]); await run(['switch', '-c', request.branch]); return { success: true };
      }
      case 'history': {
        const out = await run(['log', '-50', '--format=%h%x00%s%x00%an%x00%aI%x00']);
        const fields = out.split('\0'); const history = [];
        for (let index = 0; index + 3 < fields.length; index += 4) history.push({ hash: fields[index].trim(), subject: fields[index + 1], author: fields[index + 2], date: fields[index + 3] });
        return { success: true, history };
      }
      case 'blame': return { success: true, text: await run(['blame', '--date=short', '--', filePath(root, request.file)]) };
      case 'stash': await run(['stash', 'push', '-m', 'HomeBot IDE stash']); return { success: true };
      case 'stash-pop': await run(['stash', 'pop']); return { success: true };
      case 'conflict': case 'resolve-conflict': {
        const file = filePath(root, request.file); const displayed = path.join(root, file);
        if (fs.existsSync(displayed) && fs.lstatSync(displayed).isSymbolicLink()) throw new Error('Linked conflict files cannot be replaced here. Resolve the link explicitly with Git.');
        const absolute = checkedTrustedWorkspacePath(root, displayed);
        const stages = await run(['ls-files', '--unmerged', '-z', '--', file]);
        const blobs = new Map<number, string>();
        for (const stage of stages.split('\0')) { const match = stage.match(/^\d+ ([0-9a-f]+) ([123])\t/); if (match) blobs.set(Number(match[2]), match[1]); }
        if (!blobs.size) throw new Error('This file has no unresolved Git conflict.');
        const side = (number: number) => blobs.has(number) ? run(['show', blobs.get(number)!]) : Promise.resolve('');
        const [base, ours, theirs] = await Promise.all([side(1), side(2), side(3)]);
        const missingSides = (['base', 'ours', 'theirs'] as const).filter((_, index) => !blobs.has(index + 1));
        const currentExists = fs.existsSync(absolute);
        if (currentExists && (!fs.lstatSync(absolute).isFile() || fs.statSync(absolute).size > 2 * 1024 * 1024)) throw new Error('The conflict working copy must be a regular text file up to 2 MiB.');
        const current = currentExists ? fs.readFileSync(absolute, 'utf8') : '';
        if (request.action === 'conflict') return { success: true, conflict: { path: file, base, ours, theirs, current, currentExists, missingSides } };
        if (request.expectedContent !== current || (request.expectedExists ?? true) !== currentExists) throw new Error('The conflict file changed. Reload the merge comparison before resolving.');
        if ((request.resolution === 'ours' || request.resolution === 'theirs') && missingSides.includes(request.resolution)) throw new Error(`The ${request.resolution} side deleted this file. An empty file is not a deletion. To keep the deletion, delete the file in Explorer, then stage the deleted path in Source Control. To keep content, choose the existing side or a manual result.`);
        if (!currentExists) throw new Error('The working copy is deleted. Stage the deleted path in Source Control to keep deletion, or restore the file before using a content resolution.');
        const content = request.resolution === 'ours' ? ours : request.resolution === 'theirs' ? theirs : request.resolution === 'manual' && typeof request.content === 'string' ? request.content : undefined;
        if (content === undefined || Buffer.byteLength(content) > 2 * 1024 * 1024 || content.includes('\0')) throw new Error('Choose a text resolution up to 2 MiB.');
        // Guarded replacement only. Staging remains a separate visible action.
        const temporary = `${absolute}.homebot-merge-${createHash('sha256').update(current).digest('hex').slice(0, 10)}`;
        fs.writeFileSync(temporary, content, { flag: 'wx', mode: fs.statSync(absolute).mode });
        try { if (fs.readFileSync(absolute, 'utf8') !== current) throw new Error('The conflict file changed while resolving; no replacement was made.'); fs.renameSync(temporary, absolute); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        return { success: true };
      }
      default: throw new Error('Unknown Git action.');
    }
  } catch (error) { const cause = error as { stderr?: string; message?: string }; return { success: false, error: (cause.stderr || cause.message || String(error)).slice(0, 2000) }; }
}
