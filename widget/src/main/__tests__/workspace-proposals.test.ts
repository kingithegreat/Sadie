let mockProjectPath: string | undefined;
jest.mock('../config-manager', () => ({ getSettings: () => ({ projectPath: mockProjectPath }) }));
jest.mock('../file-change-log', () => ({
  recordChange: jest.fn(),
  captureBefore: (file: string) => {
    try { return { text: require('fs').readFileSync(file, 'utf-8'), existed: true }; }
    catch { return { text: '', existed: false }; }
  },
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyProposal, listProposals, proposeEdit, rejectProposal, shouldReviewEdit, __clearProposals,
} from '../workspace-proposals';
import { editFileHandler, writeFileHandler } from '../tools/filesystem';
import { recordChange } from '../file-change-log';

/**
 * IDE-3. The feature is only worth having if two things are exactly true:
 * a rejected hunk leaves the file byte-identical, and an accepted hunk writes
 * exactly the lines that were shown.
 */
describe('edits held for review', () => {
  let root: string;
  let file: string;
  const original = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'].join('\n') + '\n';
  const proposed = original.replace('two', 'TWO CHANGED').replace('fourteen', 'FOURTEEN CHANGED');

  beforeEach(() => {
    __clearProposals();
    (recordChange as jest.Mock).mockClear();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-proposals-'));
    // The sandbox in validatePath only allows the user's own folders, and the
    // real home directory is where an editor workspace actually lives.
    mockProjectPath = root;
    file = path.join(root, 'code.ts');
    fs.writeFileSync(file, original, 'utf-8');
  });
  afterEach(() => {
    mockProjectPath = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('only holds edits inside the Workspace folder', () => {
    expect(shouldReviewEdit(file)).toBe(true);
    expect(shouldReviewEdit(path.join(root, 'nested', 'deep.ts'))).toBe(true);
    expect(shouldReviewEdit(path.join(os.tmpdir(), 'elsewhere.txt'))).toBe(false);
    mockProjectPath = undefined;
    expect(shouldReviewEdit(file)).toBe(false);
  });

  it('shows the edit as hunks without touching the file', () => {
    const result = proposeEdit({ path: file, nextContent: proposed, tool: 'write_file' });
    expect(result).toMatchObject({ identical: false, created: false, hunkCount: 2 });
    expect(fs.readFileSync(file, 'utf-8')).toBe(original);

    const [waiting] = listProposals();
    expect(waiting.path).toBe(file);
    expect(waiting.hunks).toHaveLength(2);
    expect(waiting.stats).toMatchObject({ added: 2, removed: 2 });
  });

  it('rejecting leaves the file byte-identical', () => {
    const { id } = proposeEdit({ path: file, nextContent: proposed, tool: 'write_file' });
    expect(rejectProposal(id)).toEqual({ success: true });
    expect(fs.readFileSync(file, 'utf-8')).toBe(original);
    expect(listProposals()).toEqual([]);
    expect(rejectProposal(id)).toMatchObject({ success: false });
  });

  it('accepting one hunk writes exactly that hunk and leaves the other lines alone', () => {
    const { id } = proposeEdit({ path: file, nextContent: proposed, tool: 'write_file' });
    expect(applyProposal(id, [1])).toMatchObject({ success: true, applied: 1 });
    expect(fs.readFileSync(file, 'utf-8')).toBe(original.replace('fourteen', 'FOURTEEN CHANGED'));
    // Deciding closes the proposal: a stale half-applied diff helps nobody.
    expect(listProposals()).toEqual([]);
    expect(recordChange).toHaveBeenCalledWith(expect.objectContaining({ path: file, before: original }));
  });

  it('accepting everything writes the proposal exactly, including a new file', () => {
    const { id } = proposeEdit({ path: file, nextContent: proposed, tool: 'write_file' });
    expect(applyProposal(id, [0, 1])).toMatchObject({ success: true, applied: 2 });
    expect(fs.readFileSync(file, 'utf-8')).toBe(proposed);

    const fresh = path.join(root, 'new-file.ts');
    const created = proposeEdit({ path: fresh, nextContent: 'brand new\n', tool: 'write_file' });
    expect(created.created).toBe(true);
    expect(fs.existsSync(fresh)).toBe(false);
    expect(applyProposal(created.id, [0])).toMatchObject({ success: true });
    expect(fs.readFileSync(fresh, 'utf-8')).toBe('brand new\n');
  });

  it('refuses to apply when the file moved on, rather than reverting what changed', () => {
    const { id } = proposeEdit({ path: file, nextContent: proposed, tool: 'write_file' });
    const edited = original.replace('five', 'FIVE EDITED BY THE USER');
    fs.writeFileSync(file, edited, 'utf-8');

    const result = applyProposal(id, [0]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/changed since the edit was proposed/);
    expect(fs.readFileSync(file, 'utf-8')).toBe(edited);
    expect(listProposals()).toEqual([]);
  });

  it('no accepted hunks, an unknown id, and an unchanged proposal each say why', () => {
    const { id } = proposeEdit({ path: file, nextContent: proposed, tool: 'write_file' });
    expect(applyProposal(id, [])).toMatchObject({ success: false, error: expect.stringMatching(/at least one/) });
    expect(applyProposal('nope', [0])).toMatchObject({ success: false, error: expect.stringMatching(/no longer waiting/) });
    expect(proposeEdit({ path: file, nextContent: original, tool: 'write_file' })).toMatchObject({ identical: true, hunkCount: 0 });
    expect(fs.readFileSync(file, 'utf-8')).toBe(original);
  });

  it('a second edit to the same file replaces the first, so one question has one answer', () => {
    proposeEdit({ path: file, nextContent: proposed, tool: 'write_file' });
    proposeEdit({ path: file, nextContent: original.replace('one', 'ONE ONLY'), tool: 'edit_file' });
    const waiting = listProposals();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].tool).toBe('edit_file');
  });
});

describe('the write tools inside a Workspace folder', () => {
  let root: string;
  let file: string;

  beforeEach(() => {
    __clearProposals();
    // validatePath sandboxes to the user's own directories, so the workspace
    // used here is a real folder under the home directory.
    root = fs.mkdtempSync(path.join(os.homedir(), '.homebot-proposal-test-'));
    mockProjectPath = root;
    file = path.join(root, 'app.ts');
    fs.writeFileSync(file, 'const a = 1;\nconst b = 2;\n', 'utf-8');
  });
  afterEach(() => {
    mockProjectPath = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('write_file proposes instead of writing, and says so to the assistant', async () => {
    const result = await writeFileHandler({ path: file, content: 'const a = 99;\nconst b = 2;\n' }, {} as any);
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ proposed: true, hunks: 1 });
    expect(result.result.message).toMatch(/Nothing is written until they are accepted/);
    expect(fs.readFileSync(file, 'utf-8')).toBe('const a = 1;\nconst b = 2;\n');

    const [waiting] = listProposals();
    expect(applyProposal(waiting.id, [0])).toMatchObject({ success: true });
    expect(fs.readFileSync(file, 'utf-8')).toBe('const a = 99;\nconst b = 2;\n');
  });

  it('edit_file proposes too, and its old_string checks still run first', async () => {
    const missing = await editFileHandler({ path: file, old_string: 'not here', new_string: 'x' }, {} as any);
    expect(missing).toMatchObject({ success: false, error: expect.stringMatching(/old_string not found/) });
    expect(listProposals()).toEqual([]);

    const result = await editFileHandler({ path: file, old_string: 'const b = 2;', new_string: 'const b = 42;' }, {} as any);
    expect(result.result).toMatchObject({ proposed: true });
    expect(fs.readFileSync(file, 'utf-8')).toBe('const a = 1;\nconst b = 2;\n');
    expect(listProposals()[0].path).toBe(file);
  });

  it('a write outside the Workspace folder still writes immediately', async () => {
    const outside = path.join(os.homedir(), `.homebot-outside-${Date.now()}.txt`);
    try {
      const result = await writeFileHandler({ path: outside, content: 'written now\n' }, {} as any);
      expect(result.success).toBe(true);
      expect(result.result.proposed).toBeUndefined();
      expect(fs.readFileSync(outside, 'utf-8')).toBe('written now\n');
      expect(listProposals()).toEqual([]);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
