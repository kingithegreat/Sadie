import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  gitWorkspaceBranches, gitWorkspaceCheckout, gitWorkspaceCommit, gitWorkspaceStage, gitWorkspaceStatus,
  gitWorkspaceUnstage, parsePorcelainZ,
} from '../workspace-git';

jest.setTimeout(60_000);

// A real repository inside the home folder (the panel refuses anything outside it).
let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.homedir(), 'homebot-scm-test-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'HomeBot Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

test('porcelain -z parsing keeps renames, spaces and both index and worktree sides', () => {
  const out = 'R  new name.ts\0old name.ts\0MM both.ts\0?? fresh file.md\0UU clash.ts\0 D gone.ts\0';
  expect(parsePorcelainZ(out)).toEqual({
    staged: [{ path: 'new name.ts', from: 'old name.ts', kind: 'renamed' }, { path: 'both.ts', kind: 'modified' }],
    unstaged: [{ path: 'both.ts', kind: 'modified' }, { path: 'fresh file.md', kind: 'untracked' }, { path: 'clash.ts', kind: 'conflicted' }, { path: 'gone.ts', kind: 'deleted' }],
  });
});

test('a folder that is not in a repository says so; one outside home is refused', async () => {
  const plain = fs.mkdtempSync(path.join(os.homedir(), 'homebot-scm-plain-'));
  try {
    expect(await gitWorkspaceStatus(plain)).toEqual({ isRepo: false, staged: [], unstaged: [] });
  } finally { fs.rmSync(plain, { recursive: true, force: true }); }
  const outside = path.parse(os.homedir()).root;
  await expect(gitWorkspaceStatus(outside)).rejects.toThrow(/inside your home folder/);
});

test('stage, unstage before the first commit, commit, then see the tree clean', async () => {
  write('src/app file.ts', 'export const a = 1;\n');
  write('README.md', '# hi\n');
  let status = await gitWorkspaceStatus(repo);
  expect(status.isRepo).toBe(true);
  expect(status.unstaged.map(c => [c.path, c.kind]).sort()).toEqual([['README.md', 'untracked'], ['src/app file.ts', 'untracked']]);

  await gitWorkspaceStage(repo, ['src/app file.ts', 'README.md']);
  status = await gitWorkspaceStatus(repo);
  expect(status.staged.map(c => c.path).sort()).toEqual(['README.md', 'src/app file.ts']);

  await gitWorkspaceUnstage(repo, ['README.md']); // no HEAD yet
  status = await gitWorkspaceStatus(repo);
  expect(status.staged.map(c => c.path)).toEqual(['src/app file.ts']);

  await expect(gitWorkspaceCommit(repo, '   ')).rejects.toThrow(/commit message/);
  const { hash } = await gitWorkspaceCommit(repo, 'Add the app file');
  expect(hash).toMatch(/^[0-9a-f]{7,}$/);
  expect(git('log', '-1', '--format=%s').trim()).toBe('Add the app file');
  expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('src/app file.ts');

  await gitWorkspaceStage(repo, ['README.md']);
  await gitWorkspaceCommit(repo, 'Add readme');
  expect((await gitWorkspaceStatus(repo)).staged).toEqual([]);
  await expect(gitWorkspaceCommit(repo, 'Nothing to commit')).rejects.toThrow(/Stage at least one change/);

  write('README.md', '# changed\n');
  await gitWorkspaceStage(repo, ['README.md']);
  await gitWorkspaceUnstage(repo, ['README.md']); // with a HEAD
  status = await gitWorkspaceStatus(repo);
  expect(status.staged).toEqual([]);
  expect(status.unstaged).toEqual([{ path: 'README.md', kind: 'modified' }]);
});

test('paths that climb out of the repository are refused before git runs', async () => {
  write('a.txt', 'a');
  await expect(gitWorkspaceStage(repo, ['../outside.txt'])).rejects.toThrow(/outside the repository/);
  await expect(gitWorkspaceStage(repo, [])).rejects.toThrow(/at least one file/);
});

test('branches are listed and switched; an unknown branch is refused', async () => {
  write('a.txt', 'a');
  await gitWorkspaceStage(repo, ['a.txt']);
  await gitWorkspaceCommit(repo, 'first');
  git('branch', 'feature/x');
  expect(await gitWorkspaceBranches(repo)).toEqual({ current: 'main', branches: ['feature/x', 'main'] });
  await gitWorkspaceCheckout(repo, 'feature/x');
  expect((await gitWorkspaceStatus(repo)).branch).toBe('feature/x');
  await expect(gitWorkspaceCheckout(repo, 'main; rm -rf /')).rejects.toThrow(/existing branches/);
});
