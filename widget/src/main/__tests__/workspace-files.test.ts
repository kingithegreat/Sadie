import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkedWorkspacePath, readWorkspaceSnapshot, saveWorkspaceSnapshot } from '../workspace-files';
import { WorkspaceRecoveryStore } from '../workspace-recovery';

jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
let folder: string;
beforeEach(() => { folder = fs.mkdtempSync(path.join(os.homedir(), 'homebot-safe-save-')); });
afterEach(() => { fs.rmSync(folder, { recursive: true, force: true }); });

test('an external writer is preserved; explicit reviewed overwrite requires its current version', () => {
  const file = path.join(folder, 'sample.ts');
  fs.writeFileSync(file, 'original');
  const opened = readWorkspaceSnapshot(file);
  fs.writeFileSync(file, 'external edit');
  const refused = saveWorkspaceSnapshot(file, 'my draft', { expectedVersion: opened.version });
  expect(refused).toMatchObject({ success: false, conflict: true, disk: { content: 'external edit' } });
  expect(fs.readFileSync(file, 'utf8')).toBe('external edit');
  fs.writeFileSync(file, 'second external edit');
  expect(saveWorkspaceSnapshot(file, 'my draft', { expectedVersion: refused.disk!.version }).success).toBe(false);
  const latest = readWorkspaceSnapshot(file);
  expect(saveWorkspaceSnapshot(file, 'my draft', { expectedVersion: latest.version }).success).toBe(true);
  expect(fs.readFileSync(file, 'utf8')).toBe('my draft');
});

test('missing version or deleted file never creates or overwrites bytes', () => {
  const file = path.join(folder, 'sample.txt');
  fs.writeFileSync(file, 'keep me');
  const opened = readWorkspaceSnapshot(file);
  expect(saveWorkspaceSnapshot(file, 'erase me').success).toBe(false);
  expect(fs.readFileSync(file, 'utf8')).toBe('keep me');
  fs.unlinkSync(file);
  expect(saveWorkspaceSnapshot(file, 'draft', { expectedVersion: opened.version })).toMatchObject({ success: false, conflict: true });
  expect(fs.existsSync(file)).toBe(false);
});

test('BOM and CRLF survive normalized editor content and can explicitly be changed', () => {
  const file = path.join(folder, 'windows.txt');
  fs.writeFileSync(file, '\uFEFFfirst\r\nsecond\r\n');
  const opened = readWorkspaceSnapshot(file);
  expect(opened).toMatchObject({ content: 'first\nsecond\n', bom: true, eol: 'crlf' });
  const saved = saveWorkspaceSnapshot(file, 'first\nupdated\n', { expectedVersion: opened.version });
  expect(saved.success).toBe(true);
  expect(fs.readFileSync(file, 'utf8')).toBe('\uFEFFfirst\r\nupdated\r\n');
  expect(fs.readdirSync(folder)).toEqual(['windows.txt']);
  expect(saveWorkspaceSnapshot(file, 'plain\n', { expectedVersion: saved.version, bom: false, eol: 'lf' }).success).toBe(true);
  expect(fs.readFileSync(file, 'utf8')).toBe('plain\n');
});

test('a failed atomic replacement leaves original bytes and removes its temporary sibling', () => {
  const file = path.join(folder, 'failure.txt');
  fs.writeFileSync(file, 'original');
  const opened = readWorkspaceSnapshot(file);
  const rename = jest.spyOn(require('fs'), 'renameSync').mockImplementationOnce(() => { throw new Error('Disk unavailable'); });
  try { expect(() => saveWorkspaceSnapshot(file, 'draft', { expectedVersion: opened.version })).toThrow('Disk unavailable'); }
  finally { rename.mockRestore(); }
  expect(fs.readFileSync(file, 'utf8')).toBe('original');
  expect(fs.readdirSync(folder)).toEqual(['failure.txt']);
});

test('lossy non-UTF8 files are rejected before editing', () => {
  const file = path.join(folder, 'encoded.txt');
  fs.writeFileSync(file, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  expect(() => readWorkspaceSnapshot(file)).toThrow(/not UTF-8/);
});

test('project containment rejects traversal and a sibling prefix', () => {
  const root = path.join(folder, 'project');
  fs.mkdirSync(root);
  expect(() => checkedWorkspacePath(path.join(folder, 'project-other', 'new.txt'), root)).toThrow(/outside the trusted project/);
  expect(() => checkedWorkspacePath(path.join(root, '..', 'new.txt'), root)).toThrow(/outside the trusted project/);
  expect(checkedWorkspacePath(path.join(root, 'new.txt'), root)).toBe(path.join(root, 'new.txt'));
});

test('recovery survives a new store instance and is isolated per project and profile', () => {
  const root = path.join(folder, 'project');
  const other = path.join(folder, 'other-project');
  fs.mkdirSync(root); fs.mkdirSync(other);
  const profile = path.join(folder, 'profile');
  const draft = { activePath: path.join(root, 'new.ts'), files: [{ path: path.join(root, 'new.ts'), content: 'unsaved', original: 'old', version: 'version' }] };
  new WorkspaceRecoveryStore(profile).save(root, draft);
  expect(new WorkspaceRecoveryStore(profile).load(root)).toMatchObject(draft);
  expect(new WorkspaceRecoveryStore(profile).load(other)).toBeNull();
  expect(new WorkspaceRecoveryStore(path.join(folder, 'other-profile')).load(root)).toBeNull();
  expect(() => new WorkspaceRecoveryStore(profile).save(root, { files: [{ path: path.join(other, 'x'), content: 'x', original: '' }] })).toThrow(/trusted project/);
});

test('an external edit during the durable temporary write is rechecked before replacement', () => {
  const file = path.join(folder, 'race.txt'); fs.writeFileSync(file, 'original');
  const opened = readWorkspaceSnapshot(file);
  const sync = jest.spyOn(require('fs'), 'fsyncSync').mockImplementationOnce(() => { fs.writeFileSync(file, 'external during write'); });
  try { expect(() => saveWorkspaceSnapshot(file, 'draft', { expectedVersion: opened.version })).toThrow(/changed/); }
  finally { sync.mockRestore(); }
  expect(fs.readFileSync(file, 'utf8')).toBe('external during write');
  expect(fs.readdirSync(folder)).toEqual(['race.txt']);
});
