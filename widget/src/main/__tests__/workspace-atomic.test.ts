import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
let mockRoot: string;
jest.mock('electron', () => ({ app: { getPath: () => require('path').join(mockRoot, 'profile') } }));
jest.mock('../user-paths', () => ({ homeDir: () => require('os').tmpdir() }));
jest.mock('../config-manager', () => ({ getSettings: () => ({ projectPath: mockRoot }) }));
jest.mock('../file-change-log', () => ({ recordChange: jest.fn() }));
import { applyProposal, proposeEdit, getProposal, __clearProposals } from '../workspace-proposals';
import { atomicProjectWrite } from '../workspace-atomic';

const nativeFs = require('node:fs') as typeof fs;
describe('atomic accepted edits preserve original files on actual I/O failures', () => {
  let file: string;
  const before = Buffer.from('\ufefforiginal\r\n'), after = 'replacement\r\n';
  beforeEach(() => { mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-atomic-')); file = path.join(mockRoot, 'code.ts'); fs.writeFileSync(file, before); __clearProposals(); });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(mockRoot, { recursive: true, force: true }); });
  test('a partial write followed by disk failure never truncates the live document', () => {
    const proposal = proposeEdit({ path: file, nextContent: after, tool: 'edit_file' });
    const originalWrite = nativeFs.writeFileSync;
    jest.spyOn(nativeFs, 'writeFileSync').mockImplementation(((target: any, bytes: any, options: any) => {
      const partial = Buffer.from(bytes).subarray(0, 3);
      if (typeof target === 'number') nativeFs.writeSync(target, partial); else originalWrite(target, partial, options);
      throw new Error('Simulated disk full after partial write');
    }) as any);
    expect(applyProposal(proposal.id, [0])).toMatchObject({ success: false });
    expect(fs.readFileSync(file)).toEqual(before); expect(fs.readdirSync(mockRoot)).toEqual(['code.ts']);
    expect(getProposal(proposal.id)).toBeDefined();
  });
  test('rename failure preserves bytes/mode and allows a later successful retry', () => {
    fs.chmodSync(file, 0o640); const mode = fs.statSync(file).mode & 0o7777;
    const proposal = proposeEdit({ path: file, nextContent: after, tool: 'edit_file' });
    const rename = jest.spyOn(nativeFs, 'renameSync').mockImplementation(() => { throw new Error('Simulated destination lock'); });
    expect(applyProposal(proposal.id, [0])).toMatchObject({ success: false });
    expect(fs.readFileSync(file)).toEqual(before); expect(fs.statSync(file).mode & 0o7777).toBe(mode);
    expect(fs.readdirSync(mockRoot)).toEqual(['code.ts']); rename.mockRestore();
    expect(applyProposal(proposal.id, [0]).success).toBe(true); expect(fs.readFileSync(file, 'utf8')).toBe(after); expect(fs.statSync(file).mode & 0o7777).toBe(mode);
  });
  test('a file created by another writer at commit time cannot be overwritten', () => {
    const created = path.join(mockRoot, 'new.ts'), proposal = proposeEdit({ path: created, nextContent: 'agent', tool: 'write_file' });
    const originalLink = nativeFs.linkSync;
    jest.spyOn(nativeFs, 'linkSync').mockImplementation((source: any, target: any) => { fs.writeFileSync(target, 'other writer'); originalLink(source, target); });
    expect(applyProposal(proposal.id, [0])).toMatchObject({ success: false });
    expect(fs.readFileSync(created, 'utf8')).toBe('other writer'); expect(fs.readdirSync(mockRoot).sort()).toEqual(['code.ts', 'new.ts']);
  });
  test('changed disk bytes during staging and a legacy proposal redirected by a junction are refused', () => {
    const originalFsync = nativeFs.fsyncSync;
    jest.spyOn(nativeFs, 'fsyncSync').mockImplementation(descriptor => { fs.writeFileSync(file, 'newer external bytes'); originalFsync(descriptor); });
    expect(() => atomicProjectWrite(file, Buffer.from(after), { expectedExists: true, expectedHash: require('crypto').createHash('sha256').update(before).digest('hex') })).toThrow('changed');
    expect(fs.readFileSync(file, 'utf8')).toBe('newer external bytes'); jest.restoreAllMocks();
    const folder = path.join(mockRoot, 'folder'), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-outside-'));
    try {
      fs.mkdirSync(folder); const nested = path.join(folder, 'nested.ts'); fs.writeFileSync(nested, 'original');
      const proposal = proposeEdit({ path: nested, nextContent: 'agent', tool: 'edit_file' });
      fs.renameSync(folder, path.join(mockRoot, 'moved')); fs.writeFileSync(path.join(outside, 'nested.ts'), 'outside human');
      fs.symlinkSync(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
      expect(applyProposal(proposal.id, [0])).toMatchObject({ success: false });
      expect(fs.readFileSync(path.join(outside, 'nested.ts'), 'utf8')).toBe('outside human');
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
});
