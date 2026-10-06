import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { performWorkspaceGitAction, gitWorkspaceConfirmation } from '../workspace-git-actions';
let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const action = (action: Parameters<typeof performWorkspaceGitAction>[0]['action'], extra = {}) => performWorkspaceGitAction({ folder: root, action, ...extra });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.homedir(), 'hb-git-actions-'));
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'HomeBot Test'); git('config', 'user.email', 'test@example.invalid'); git('config', 'commit.gpgsign', 'false'); git('config', 'core.autocrlf', 'false');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
test('ordinary diff and selected hunk stage update only the index and reject stale patches', async () => {
  const original = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'app.txt'), original); git('add', '.'); git('commit', '-qm', 'initial');
  const changed = original.replace('line 1\n', 'first changed\n').replace('line 24\n', 'last changed\n'); fs.writeFileSync(path.join(root, 'app.txt'), changed);
  const diff = await action('diff', { file: 'app.txt' }); expect(diff.success).toBe(true); expect(diff.hunks?.length).toBe(2);
  expect((await action('stage-hunk', { file: 'app.txt', hunk: 1, expectedDiff: diff.diff })).success).toBe(true);
  const staged = git('show', ':app.txt'); expect(staged).toBe(original.replace('line 24\n', 'last changed\n')); expect(fs.readFileSync(path.join(root, 'app.txt'), 'utf8')).toBe(changed);
  expect((await action('stage-hunk', { file: 'app.txt', hunk: 0, expectedDiff: diff.diff })).error).toMatch(/diff changed/);
});
test('untracked files with spaces produce a valid staged new-file hunk', async () => {
  fs.writeFileSync(path.join(root, 'new file.txt'), 'one\ntwo\n');
  const diff = await action('diff', { file: 'new file.txt' }); expect(diff.hunks?.length).toBe(1);
  const staged = await action('stage-hunk', { file: 'new file.txt', hunk: 0, expectedDiff: diff.diff }); expect(staged).toEqual({ success: true });
  expect(git('show', ':new file.txt')).toBe('one\ntwo\n');
});
test('history, blame, branch creation, stash and stash restore reach real Git', async () => {
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n'); git('add', '.'); git('commit', '-qm', 'first commit');
  expect((await action('history')).history?.[0].subject).toBe('first commit'); expect((await action('blame', { file: 'a.txt' })).text).toContain('base');
  expect((await action('create-branch', { branch: 'feature/editor' })).success).toBe(true); expect(git('branch', '--show-current').trim()).toBe('feature/editor');
  fs.writeFileSync(path.join(root, 'a.txt'), 'draft\n'); expect((await action('stash')).success).toBe(true); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('base\n');
  expect((await action('stash-pop')).success).toBe(true); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('draft\n');
});
test('conflict comparison returns all real stages and guarded resolution preserves a newer edit', async () => {
  fs.writeFileSync(path.join(root, 'clash.txt'), 'base\n'); git('add', '.'); git('commit', '-qm', 'base'); git('switch', '-c', 'other');
  fs.writeFileSync(path.join(root, 'clash.txt'), 'theirs\n'); git('commit', '-qam', 'theirs'); git('switch', 'main'); fs.writeFileSync(path.join(root, 'clash.txt'), 'ours\n'); git('commit', '-qam', 'ours');
  try { git('merge', 'other'); } catch { /* expected conflict */ }
  const compared = await action('conflict', { file: 'clash.txt' }); expect(compared.conflict).toEqual(expect.objectContaining({ base: 'base\n', ours: 'ours\n', theirs: 'theirs\n' }));
  fs.writeFileSync(path.join(root, 'clash.txt'), 'new user edit\n');
  expect((await action('resolve-conflict', { file: 'clash.txt', resolution: 'ours', expectedContent: compared.conflict?.current })).error).toMatch(/file changed/);
  expect(fs.readFileSync(path.join(root, 'clash.txt'), 'utf8')).toBe('new user edit\n');
  expect((await action('resolve-conflict', { file: 'clash.txt', resolution: 'manual', content: 'combined\n', expectedContent: 'new user edit\n' })).success).toBe(true);
  expect(fs.readFileSync(path.join(root, 'clash.txt'), 'utf8')).toBe('combined\n'); expect(git('ls-files', '--unmerged')).not.toBe('');
});
test('unsafe paths, invalid branch/clone inputs, and network mutation consent remain explicit', async () => {
  expect((await action('diff', { file: '../secret.txt' })).success).toBe(false);
  expect((await action('create-branch', { branch: '--orphan' })).success).toBe(false);
  expect((await action('clone', { url: 'ext::sh evil', target: 'new' })).success).toBe(false);
  expect(gitWorkspaceConfirmation({ folder: root, action: 'push' })).toMatch(/publishes/);
  expect(gitWorkspaceConfirmation({ folder: root, action: 'diff' })).toBeNull();
});
jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
