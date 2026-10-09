import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { stageVerifiedWorkspaceWindowsJobHost } from '../workspace-windows-job-host-copy';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let root: string, installed: string, bytes: Buffer;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-job-host-copy-'));
  installed = path.join(root, 'OwnedWindowsJobHost.exe');
  bytes = Buffer.alloc(4096, 7); bytes.write('MZ');
  fs.writeFileSync(installed, bytes);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const stage = () => stageVerifiedWorkspaceWindowsJobHost(installed, digest(bytes), { directory: root });

test('launch path is a private per-run copy of exactly the verified bytes, never the installed path', () => {
  const staged = stage();
  expect(staged.path).not.toBe(installed);
  expect(path.dirname(path.dirname(staged.path))).toBe(root);
  expect(fs.readFileSync(staged.path).equals(bytes)).toBe(true);
  if (process.platform !== 'win32') expect(fs.statSync(path.dirname(staged.path)).mode & 0o077).toBe(0);
  expect(() => staged.confirmLaunched()).not.toThrow();
  staged.release();
  expect(fs.existsSync(path.dirname(staged.path))).toBe(false);
});

test('swapping the installed host after verification cannot change what is launched', () => {
  const staged = stage();
  // The attack from the review: replace the installed pathname after hashing.
  fs.writeFileSync(installed, Buffer.from('MZ' + 'evil'.repeat(200)));
  expect(fs.readFileSync(staged.path).equals(bytes)).toBe(true);
  expect(() => staged.confirmLaunched()).not.toThrow();
  staged.release();
});

test('an installed host that does not match the pinned hash is never staged', () => {
  fs.writeFileSync(installed, Buffer.concat([bytes.subarray(0, 4095), Buffer.from([8])]));
  const before = fs.readdirSync(root).length;
  expect(() => stage()).toThrow('hash does not match');
  expect(fs.readdirSync(root).length).toBe(before);
  expect(() => stageVerifiedWorkspaceWindowsJobHost(installed, 'not-a-hash', { directory: root })).toThrow('invalid');
});

test('replacing or rewriting the staged copy before launch is detected by confirmLaunched', () => {
  const swapped = stage();
  const evil = Buffer.from(bytes); evil[100] = 9;
  // Rename-swap the private copy for different bytes at the same pathname.
  fs.renameSync(swapped.path, swapped.path + '.old');
  fs.writeFileSync(swapped.path, evil);
  expect(() => swapped.confirmLaunched()).toThrow('not the verified private copy');
  swapped.release();
  const rewritten = stage();
  fs.chmodSync(rewritten.path, 0o700);
  fs.writeFileSync(rewritten.path, evil); // in place, same file identity
  expect(() => rewritten.confirmLaunched()).toThrow('not the verified private copy');
  rewritten.release();
  expect(() => rewritten.confirmLaunched()).toThrow('released');
});
