import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { verifiedWorkspaceWindowsJobAsset } from '../workspace-windows-job-asset';

jest.mock('fs', () => ({ lstatSync: jest.fn(), realpathSync: { native: jest.fn() }, openSync: jest.fn(), fstatSync: jest.fn(), readSync: jest.fn(), closeSync: jest.fn() }));
const native = path.resolve(__dirname, '../../../native');
const asset = path.join(native, 'generated', 'OwnedWindowsJob.dll');
const manifestFile = path.join(native, 'generated', 'manifest.json');
const source = Buffer.from('immutable product-only C# source');
const preparation = Buffer.from('immutable preparation code');
const preparationFile = path.resolve(__dirname, '../../../scripts/prepare-windows-job.cjs');
const bytes = Buffer.alloc(512); bytes.write('MZ');
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const stat = (size: number) => ({ dev: 1, ino: 2, size, isFile: () => true, isSymbolicLink: () => false });
let files: Map<string, Buffer>, held: string;
beforeEach(() => {
  files = new Map([[asset, Buffer.from(bytes)], [path.join(native, 'OwnedWindowsJob.cs'), source], [preparationFile, preparation], [manifestFile, Buffer.from(JSON.stringify({ version: 2, sourceSha256: digest(source), preparationSha256: digest(preparation), compilerSha256: 'c'.repeat(64), optionsSha256: 'd'.repeat(64), references: ['mscorlib.dll', 'System.dll', 'System.Core.dll'].map(name => ({ name, sha256: 'e'.repeat(64) })), assemblySha256: digest(bytes) }))]]);
  (fs.lstatSync as jest.Mock).mockImplementation(file => { const value = files.get(file); if (!value) throw new Error('missing'); return stat(value.length); });
  (fs.realpathSync.native as jest.Mock).mockImplementation(file => file);
  (fs.openSync as jest.Mock).mockClear().mockImplementation(file => { held = file; return 9; });
  (fs.fstatSync as jest.Mock).mockImplementation(() => stat(files.get(held)!.length));
  (fs.readSync as jest.Mock).mockImplementation((_fd, target: Buffer, offset: number, length: number, position: number) => files.get(held)!.copy(target, offset, position, position + length));
  (fs.closeSync as jest.Mock).mockClear();
});

it('loads only the fixed product-source asset and closes every held read', () => {
  expect(verifiedWorkspaceWindowsJobAsset()).toEqual({ assembly: asset, sha256: digest(bytes) });
  expect(fs.openSync).toHaveBeenCalledWith(asset, 'r');
  expect(fs.closeSync).toHaveBeenCalledTimes(4);
});
it('rejects a missing asset without runtime preparation', () => {
  files.delete(asset); expect(() => verifiedWorkspaceWindowsJobAsset()).toThrow('missing');
});
it('rejects changed assembly bytes with the original manifest', () => {
  files.get(asset)![511] = 1; expect(() => verifiedWorkspaceWindowsJobAsset()).toThrow('hash');
});
it('rejects a stale immutable-source manifest', () => {
  files.set(path.join(native, 'OwnedWindowsJob.cs'), Buffer.from('changed'));
  expect(() => verifiedWorkspaceWindowsJobAsset()).toThrow('stale');
});
it('rejects stale preparation code without loading the source-mode DLL', () => {
  files.set(preparationFile, Buffer.from('changed preparation'));
  expect(() => verifiedWorkspaceWindowsJobAsset()).toThrow('stale');
  expect(fs.openSync).not.toHaveBeenCalledWith(asset, 'r');
});
it.each(['null', '[]', '{"version":2}', '{"version":1,"assemblySha256":"../other.dll"}'])('rejects malformed metadata %s', value => {
  files.set(manifestFile, Buffer.from(value)); expect(() => verifiedWorkspaceWindowsJobAsset()).toThrow();
});
it('rejects a link or nonregular asset at the fixed filename', () => {
  (fs.lstatSync as jest.Mock).mockImplementation(file => ({ ...stat(files.get(file)!.length), isFile: () => file !== asset, isSymbolicLink: () => file === asset }));
  expect(() => verifiedWorkspaceWindowsJobAsset()).toThrow('regular');
});
it('rejects an ancestor junction redirect instead of loading another product asset', () => {
  (fs.realpathSync.native as jest.Mock).mockImplementation(file => file === asset ? path.join(native, 'elsewhere.dll') : file);
  expect(() => verifiedWorkspaceWindowsJobAsset()).toThrow('regular');
});
it('rejects path substitution between validation and held open', () => {
  (fs.fstatSync as jest.Mock).mockImplementation(() => ({ ...stat(files.get(held)!.length), ino: 99 }));
  expect(() => verifiedWorkspaceWindowsJobAsset()).toThrow('opening');
  expect(fs.closeSync).toHaveBeenCalledWith(9);
});
it('rejects a growing file even after its held stat passed', () => {
  (fs.readSync as jest.Mock).mockImplementation((_fd, target: Buffer, offset: number, length: number, position: number) => (held === asset ? Buffer.alloc(1024 * 1024 + 1) : files.get(held)!).copy(target, offset, position, position + length));
  expect(() => verifiedWorkspaceWindowsJobAsset()).toThrow('reading');
});
