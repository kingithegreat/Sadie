import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
let mockUserData: string;
let mockConfiguredRoot: string;
jest.mock('electron', () => ({ app: { getPath: () => mockUserData } }));
jest.mock('../user-paths', () => ({ homeDir: () => require('os').tmpdir() }));
jest.mock('../config-manager', () => ({ getSettings: () => ({ projectPath: mockConfiguredRoot, ollamaUrl: 'http://127.0.0.1:11434' }) }));
jest.mock('../file-change-log', () => ({ recordChange: jest.fn(), captureBefore: (file: string) => { try { return { text: require('fs').readFileSync(file, 'utf8'), existed: true }; } catch { return { text: '', existed: false }; } } }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
import axios from 'axios';
import { approveWorkspacePlan, currentWorkspace, prepareWorkspacePlan, releaseWorkspaceStream, runWorkspaceRequest, workspaceStreamHandler, workspaceToolError } from '../workspace-context';
import { writeFileHandler, validatePath } from '../tools/filesystem';
import { applyProposal, listProposals, __clearProposals } from '../workspace-proposals';
import { listWorkspaceCheckpoints, recordWorkspaceCheckpoint, restoreWorkspaceCheckpoint } from '../workspace-checkpoints';
import { registerTool, getTool } from '../tools/registry';
import { readWorkspaceRules, searchWorkspaceCode } from '../workspace-code-context';

describe('IDE request authority, review and recovery effects', () => {
  let directory: string, rootA: string, rootB: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-ai-safety-'));
    rootA = path.join(directory, 'a'); rootB = path.join(directory, 'b');
    fs.mkdirSync(rootA); fs.mkdirSync(rootB); mockUserData = path.join(directory, 'profile'); mockConfiguredRoot = rootA;
    __clearProposals(); jest.clearAllMocks();
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  const approved = (root: string, sender = 1) => {
    const plan = prepareWorkspacePlan(root, 'Change the intended file and review its diff.', sender);
    approveWorkspacePlan(root, plan.id, sender);
    return { root, planId: plan.id };
  };
  const request = (scope: any, id = 'stream') => ({ workspace: scope, streamId: id, message: 'edit', conversation_id: 'workspace:test' });

  test('parallel streams resolve their own root and hold append/overwrite regardless of configured root', async () => {
    fs.writeFileSync(path.join(rootA, 'code.ts'), 'A\r\n'); fs.writeFileSync(path.join(rootB, 'code.ts'), 'B\r\n');
    let releaseA!: () => void, releaseB!: () => void;
    const waitA = new Promise<void>(resolve => { releaseA = resolve; }), waitB = new Promise<void>(resolve => { releaseB = resolve; });
    const a = runWorkspaceRequest(request(approved(rootA), 'a'), 1, async () => { await waitA; expect(currentWorkspace()?.root).toBe(fs.realpathSync(rootA)); return writeFileHandler({ path: 'code.ts', content: 'APPEND', append: true }, {} as any); });
    const b = runWorkspaceRequest(request(approved(rootB), 'b'), 1, async () => { await waitB; expect(currentWorkspace()?.root).toBe(fs.realpathSync(rootB)); return writeFileHandler({ path: 'code.ts', content: 'NEW B' }, {} as any); });
    releaseB(); expect(await b).toMatchObject({ success: true, result: { proposed: true } });
    releaseA(); expect(await a).toMatchObject({ success: true, result: { proposed: true } });
    expect(fs.readFileSync(path.join(rootA, 'code.ts'), 'utf8')).toBe('A\r\n');
    expect(fs.readFileSync(path.join(rootB, 'code.ts'), 'utf8')).toBe('B\r\n');
    expect(listProposals(rootB)).toHaveLength(1); expect(listProposals(rootA)).toHaveLength(1);
    const proposal = listProposals(rootA)[0]; expect(applyProposal(proposal.id, [0]).success).toBe(true);
    expect(fs.readFileSync(path.join(rootA, 'code.ts'), 'utf8')).toBe('A\r\nAPPEND');
    expect(listWorkspaceCheckpoints(rootA)).toHaveLength(1);
    expect(currentWorkspace()).toBeUndefined();
  });
  test('text does not approve, approval is bound to sender/root, and canonical escapes fail', async () => {
    const unapproved = prepareWorkspacePlan(rootA, 'Plan approved', 1);
    await runWorkspaceRequest(request({ root: rootA }), 1, async () => {
      expect(await writeFileHandler({ path: 'no.txt', content: 'forbidden' }, {} as any)).toMatchObject({ success: false });
      expect(validatePath(path.join(rootB, 'no.txt')).valid).toBe(false);
    });
    expect(fs.existsSync(path.join(rootA, 'no.txt'))).toBe(false);
    expect(() => runWorkspaceRequest(request({ root: rootA, planId: unapproved.id }), 1, () => {})).toThrow('Approve');
    const plan = approved(rootA);
    expect(() => runWorkspaceRequest(request(plan), 2, () => {})).toThrow('Approve');
    expect(() => runWorkspaceRequest(request({ ...plan, root: rootB }), 1, () => {})).toThrow('Approve');
    const link = path.join(rootA, 'escape'); fs.symlinkSync(rootB, link, process.platform === 'win32' ? 'junction' : 'dir');
    runWorkspaceRequest(request(plan), 1, () => expect(validatePath(path.join(link, 'no.txt')).valid).toBe(false));
    expect(() => runWorkspaceRequest({ conversation_id: 'workspace:fake' }, 1, () => {})).toThrow('authoritative');
  });
  test('registry handler guard covers direct dispatch, while normal chat still dispatches', async () => {
    const effect = path.join(rootA, 'danger.txt');
    registerTool('run_terminal_command', { name: 'run_terminal_command' } as any, async () => { fs.writeFileSync(effect, 'effect'); return { success: true }; });
    await runWorkspaceRequest(request(approved(rootA)), 1, async () => {
      expect(workspaceToolError('run_terminal_command')).toBeDefined();
      expect(await getTool('run_terminal_command')!.handler({}, {} as any)).toMatchObject({ success: false });
    });
    expect(fs.existsSync(effect)).toBe(false);
    expect(await getTool('run_terminal_command')!.handler({}, {} as any)).toMatchObject({ success: true });
    expect(fs.readFileSync(effect, 'utf8')).toBe('effect');
  });
  test('Stop belongs to the requesting window and blocks a late confirmed edit', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const sender = { id: 1, send: jest.fn() }; let result: any;
    const handler = workspaceStreamHandler(async (event, req) => {
      await gate; result = await writeFileHandler({ path: 'late.ts', content: 'late write' }, {} as any);
      event.sender.send('homebot:stream-end', { streamId: req.streamId });
    });
    const running = handler({ sender }, request(approved(rootA), 'late'));
    expect(releaseWorkspaceStream('late', 2)).toBe(false);
    expect(releaseWorkspaceStream('late', 1)).toBe(true);
    release(); await running;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('stopped') });
    expect(fs.existsSync(path.join(rootA, 'late.ts'))).toBe(false); expect(listProposals()).toEqual([]);
  });
  test('checkpoint restores exact BOM/CRLF bytes, preserves later edits and refuses a stale confirmation', () => {
    const file = path.join(rootA, 'code.ts'), before = Buffer.from('\ufefforiginal\r\n'), after = Buffer.from('agent\n');
    fs.writeFileSync(file, after);
    const id = recordWorkspaceCheckpoint(rootA, file, before, after, 'edit_file');
    fs.writeFileSync(file, 'later user edits\r\n');
    const conflict = restoreWorkspaceCheckpoint(rootA, id);
    expect(conflict).toMatchObject({ success: false, conflict: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('later user edits\r\n');
    fs.writeFileSync(file, 'newer user edits\r\n');
    expect(restoreWorkspaceCheckpoint(rootA, id, { overwrite: true, expectedCurrentHash: conflict.currentHash })).toMatchObject({ success: false, conflict: true });
    const fresh = restoreWorkspaceCheckpoint(rootA, id);
    expect(restoreWorkspaceCheckpoint(rootA, id, { overwrite: true, expectedCurrentHash: fresh.currentHash })).toMatchObject({ success: true });
    expect(fs.readFileSync(file)).toEqual(before);
    const recovery = listWorkspaceCheckpoints(rootA)[0];
    expect(restoreWorkspaceCheckpoint(rootA, recovery.id).success).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('newer user edits\r\n');
  });
  test('new-file rollback is reversible without removing other project files', () => {
    const file = path.join(rootA, 'new.ts'), other = path.join(rootA, 'untouched.ts'); fs.writeFileSync(file, 'agent'); fs.writeFileSync(other, 'human');
    const id = recordWorkspaceCheckpoint(rootA, file, null, Buffer.from('agent'), 'write_file');
    expect(restoreWorkspaceCheckpoint(rootA, id)).toMatchObject({ success: true, removed: true });
    expect(fs.existsSync(file)).toBe(false); expect(fs.readFileSync(other, 'utf8')).toBe('human');
    expect(restoreWorkspaceCheckpoint(rootA, listWorkspaceCheckpoints(rootA)[0].id).success).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('agent');
  });
  test('rules and code context refresh after save/delete and semantic mode uses embeddings', async () => {
    fs.writeFileSync(path.join(rootA, 'AGENTS.md'), 'Project instruction'); fs.writeFileSync(path.join(rootA, 'vehicle.ts'), 'const automobile = 1;');
    expect(readWorkspaceRules(rootA)[0].text).toBe('Project instruction');
    expect((await searchWorkspaceCode(rootA, 'automobile')).matches[0].text).toContain('automobile');
    fs.writeFileSync(path.join(rootA, 'vehicle.ts'), 'const bicycle = 2;');
    expect((await searchWorkspaceCode(rootA, 'automobile')).matches).toEqual([]);
    (axios.get as jest.Mock).mockResolvedValue({ data: { models: [{ name: 'nomic-embed-text:latest' }] } });
    (axios.post as jest.Mock).mockResolvedValue({ data: { embedding: [1, 0] } });
    const semantic = await searchWorkspaceCode(rootA, 'transport', true);
    expect(semantic.mode).toBe('local semantic + keyword search'); expect(semantic.matches.some(match => match.text.includes('bicycle'))).toBe(true);
    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/embeddings'), expect.objectContaining({ model: 'nomic-embed-text' }), expect.anything());
    fs.unlinkSync(path.join(rootA, 'vehicle.ts')); expect((await searchWorkspaceCode(rootA, 'bicycle')).matches).toEqual([]);
  });
});
