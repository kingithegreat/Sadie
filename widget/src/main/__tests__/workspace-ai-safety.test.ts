import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
// Real filesystem/loopback work uses the explicit timeout required by AGENTS.md.
jest.setTimeout(15_000);
const nativeFs: typeof import('fs') = jest.requireActual('fs');
let mockUserData: string;
let mockConfiguredRoot: string;
let mockWindow: any;
jest.mock('electron', () => ({ app: { getPath: () => mockUserData } }));
jest.mock('../user-paths', () => ({ homeDir: () => require('os').tmpdir() }));
jest.mock('../config-manager', () => ({ getSettings: () => ({ projectPath: mockConfiguredRoot, ollamaUrl: 'http://127.0.0.1:11434' }) }));
jest.mock('../file-change-log', () => ({ recordChange: jest.fn(), captureBefore: (file: string) => { try { return { text: require('fs').readFileSync(file, 'utf8'), existed: true }; } catch { return { text: '', existed: false }; } } }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => mockWindow }));
jest.mock('../tools', () => ({
  executeTool: (call: any, context: any) => require('../tools/registry').getTool(call.name).handler(call.arguments, context),
  getTool: (name: string) => require('../tools/registry').getTool(name),
}));
import axios from 'axios';
import { approveWorkspacePlan, createWorkspaceBridgeToken, currentWorkspace, prepareWorkspacePlan, releaseWorkspaceStream, runWorkspaceRequest, workspaceStreamHandler, workspaceToolError } from '../workspace-context';
import { startAssistantBridge, stopAssistantBridge } from '../assistant-bridge';
import { writeFileHandler, validatePath } from '../tools/filesystem';
import { applyProposal, listProposals, __clearProposals } from '../workspace-proposals';
import { compareWorkspaceCheckpointRun, listWorkspaceCheckpointRuns, listWorkspaceCheckpoints, recordWorkspaceCheckpoint, restoreWorkspaceCheckpoint, restoreWorkspaceCheckpointRun } from '../workspace-checkpoints';
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
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
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
    // Even a handler captured before request scope begins must enforce the
    // authority active at invocation, rather than exposing an unguarded copy.
    const capturedHandler = getTool('run_terminal_command')!.handler;
    await runWorkspaceRequest(request(approved(rootA)), 1, async () => {
      expect(workspaceToolError('run_terminal_command')).toBeDefined();
      expect(await getTool('run_terminal_command')!.handler({}, {} as any)).toMatchObject({ success: false });
      expect(await capturedHandler({}, {} as any)).toMatchObject({ success: false });
      expect(fs.existsSync(effect)).toBe(false);
    });
    expect(fs.existsSync(effect)).toBe(false);
    expect(await getTool('run_terminal_command')!.handler({}, {} as any)).toMatchObject({ success: true });
    expect(fs.readFileSync(effect, 'utf8')).toBe('effect');
  });
  test('Stop belongs to the requesting window and blocks a late confirmed edit', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const sender = { id: 1, send: jest.fn(), mainFrame: {} }; let result: any;
    mockWindow = { isDestroyed: () => false, webContents: sender };
    const handler = workspaceStreamHandler(async (event, req) => {
      await gate; result = await writeFileHandler({ path: 'late.ts', content: 'late write' }, {} as any);
      event.sender.send('homebot:stream-end', { streamId: req.streamId });
    });
    const running = handler({ sender, senderFrame: sender.mainFrame }, request(approved(rootA), 'late'));
    expect(releaseWorkspaceStream('late', 2)).toBe(false);
    expect(releaseWorkspaceStream('late', 1)).toBe(true);
    release(); await running;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('stopped') });
    expect(fs.existsSync(path.join(rootA, 'late.ts'))).toBe(false); expect(listProposals()).toEqual([]);
  });
  test('actual bridge HTTP calls re-enter two independent roots and reject wrong/expired/stopped tokens', async () => {
    registerTool('write_file', { name: 'write_file' } as any, writeFileHandler);
    const bridge = await startAssistantBridge({ requestConfirmation: async () => true });
    const rpc = (token: string, content: string) => new Promise<any>((resolve, reject) => {
      const url = new URL(bridge.url), body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_file', arguments: { path: 'bridge.ts', content } } });
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      }); req.on('error', reject); req.end(body);
    });
    try {
      const tokenA = runWorkspaceRequest(request(approved(rootA), 'bridge-a'), 1, () => createWorkspaceBridgeToken()!);
      const tokenB = runWorkspaceRequest(request(approved(rootB), 'bridge-b'), 1, () => createWorkspaceBridgeToken()!);
      const [a, b] = await Promise.all([rpc(tokenA, 'A'), rpc(tokenB, 'B')]);
      expect(a.body.result.isError).toBe(false); expect(b.body.result.isError).toBe(false);
      expect(listProposals(rootA)[0].path).toBe(path.join(rootA, 'bridge.ts'));
      expect(listProposals(rootB)[0].path).toBe(path.join(rootB, 'bridge.ts'));
      expect(fs.existsSync(path.join(rootA, 'bridge.ts'))).toBe(false); expect(fs.existsSync(path.join(rootB, 'bridge.ts'))).toBe(false);
      expect((await rpc('invalid', 'BAD')).status).toBe(401);
      const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000);
      try { expect((await rpc(tokenA, 'EXPIRED')).status).toBe(401); } finally { clock.mockRestore(); }
      let stoppedToken!: string, release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const sender = { id: 1, send: jest.fn(), mainFrame: {} }; mockWindow = { isDestroyed: () => false, webContents: sender };
      const running = workspaceStreamHandler(async (event, req) => { stoppedToken = createWorkspaceBridgeToken()!; await gate; event.sender.send('homebot:stream-end', { streamId: req.streamId }); })({ sender, senderFrame: sender.mainFrame }, request(approved(rootA), 'bridge-stop'));
      releaseWorkspaceStream('bridge-stop', 1);
      expect((await rpc(stoppedToken, 'STOPPED')).status).toBe(401);
      release(); await running;
      expect(listProposals()).toHaveLength(2);
    } finally { stopAssistantBridge(); }
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
  test('whole-run restore preflights every touched file, preserves conflicts and retains a reversible recovery run', () => {
    const a = path.join(rootA, 'a.ts'), b = path.join(rootA, 'b.ts'), created = path.join(rootA, 'created.ts'), untouched = path.join(rootA, 'human.ts');
    const beforeA = Buffer.from('\ufeffA original\r\n'), beforeB = Buffer.from('B original\r\n');
    fs.writeFileSync(a, 'A agent'); fs.writeFileSync(b, 'B agent'); fs.writeFileSync(created, 'created agent'); fs.writeFileSync(untouched, 'never touch');
    recordWorkspaceCheckpoint(rootA, a, beforeA, Buffer.from('A agent'), 'edit_file', 'multi-file-run');
    recordWorkspaceCheckpoint(rootA, b, beforeB, Buffer.from('B agent'), 'edit_file', 'multi-file-run');
    recordWorkspaceCheckpoint(rootA, created, null, Buffer.from('created agent'), 'write_file', 'multi-file-run');
    fs.writeFileSync(b, 'B human later');
    expect(restoreWorkspaceCheckpointRun(rootA, 'multi-file-run')).toMatchObject({ success: false, conflict: true });
    expect(fs.readFileSync(a, 'utf8')).toBe('A agent'); expect(fs.readFileSync(b, 'utf8')).toBe('B human later'); expect(fs.existsSync(created)).toBe(true);
    const compared = compareWorkspaceCheckpointRun(rootA, 'multi-file-run');
    const staleHashes = Object.fromEntries(compared.files.map(file => [file.path, file.currentHash]));
    fs.writeFileSync(b, 'B human newest');
    expect(restoreWorkspaceCheckpointRun(rootA, 'multi-file-run', { confirmedHashes: staleHashes })).toMatchObject({ success: false, conflict: true });
    expect(fs.readFileSync(a, 'utf8')).toBe('A agent');
    const freshHashes = Object.fromEntries(compareWorkspaceCheckpointRun(rootA, 'multi-file-run').files.map(file => [file.path, file.currentHash]));
    const restored = restoreWorkspaceCheckpointRun(rootA, 'multi-file-run', { confirmedHashes: freshHashes });
    expect(restored.success).toBe(true); expect(restored.restored).toHaveLength(3);
    expect(fs.readFileSync(a)).toEqual(beforeA); expect(fs.readFileSync(b)).toEqual(beforeB); expect(fs.existsSync(created)).toBe(false);
    expect(fs.readFileSync(untouched, 'utf8')).toBe('never touch');
    expect(listWorkspaceCheckpointRuns(rootA).some(run => run.id === restored.recoveryRunId)).toBe(true);
    expect(restoreWorkspaceCheckpointRun(rootA, restored.recoveryRunId).success).toBe(true);
    expect(fs.readFileSync(a, 'utf8')).toBe('A agent'); expect(fs.readFileSync(b, 'utf8')).toBe('B human newest'); expect(fs.readFileSync(created, 'utf8')).toBe('created agent');
  });
  test('human edits made between two accepted edits in one run require explicit restore confirmation', () => {
    const file = path.join(rootA, 'sequence.ts'); fs.writeFileSync(file, 'agent first');
    recordWorkspaceCheckpoint(rootA, file, Buffer.from('original'), Buffer.from('agent first'), 'edit_file', 'sequence-run');
    fs.writeFileSync(file, 'human edit then agent second');
    recordWorkspaceCheckpoint(rootA, file, Buffer.from('human edit'), Buffer.from('human edit then agent second'), 'edit_file', 'sequence-run');
    expect(restoreWorkspaceCheckpointRun(rootA, 'sequence-run')).toMatchObject({ success: false, conflict: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('human edit then agent second');
    const compare = compareWorkspaceCheckpointRun(rootA, 'sequence-run'); expect(compare.files[0]).toMatchObject({ before: 'original', conflict: true });
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
  test('ancestor codebase keyword and semantic scans exclude protected profile bytes before read or embedding', async () => {
    fs.mkdirSync(mockUserData); const secret = path.join(mockUserData, 'user-settings.json');
    fs.writeFileSync(secret, JSON.stringify({ marker: 'SYNTHETIC_PROFILE_CODEBASE_SECRET', mcpEnvironment: 'SYNTHETIC_MCP_ENV_SECRET' }));
    fs.writeFileSync(path.join(rootA, 'allowed.ts'), 'const allowedProjectMarker = 1;');
    const opened = jest.spyOn(nativeFs, 'openSync'), listed = jest.spyOn(nativeFs, 'readdirSync');
    const keyword = await searchWorkspaceCode(directory, 'SYNTHETIC_PROFILE_CODEBASE_SECRET');
    expect(keyword.matches).toEqual([]); expect(keyword.files).toBe(1);
    (axios.get as jest.Mock).mockResolvedValue({ data: { models: [{ name: 'nomic-embed-text:latest' }] } });
    (axios.post as jest.Mock).mockResolvedValue({ data: { embedding: [1, 0] } });
    const semantic = await searchWorkspaceCode(directory, 'allowedProjectMarker', true);
    expect(semantic.matches.some(match => match.text.includes('allowedProjectMarker'))).toBe(true);
    expect(JSON.stringify(semantic)).not.toContain('SYNTHETIC_PROFILE_CODEBASE_SECRET');
    expect(JSON.stringify((axios.post as jest.Mock).mock.calls)).not.toContain('SYNTHETIC_MCP_ENV_SECRET');
    expect(opened.mock.calls.some(call => String(call[0]) === secret)).toBe(false);
    expect(listed.mock.calls.some(call => String(call[0]) === mockUserData)).toBe(false);
    expect(fs.readFileSync(secret, 'utf8')).toContain('SYNTHETIC_PROFILE_CODEBASE_SECRET');
  });
  test('codebase scans preserve synthetic protected system directories and their allowed siblings', async () => {
    const prior = process.env.ProgramData, protectedRoot = path.join(rootA, 'protected-system');
    fs.mkdirSync(protectedRoot); fs.writeFileSync(path.join(protectedRoot, 'config.json'), 'SYNTHETIC_SYSTEM_CODEBASE_SECRET');
    fs.writeFileSync(path.join(rootA, 'allowed.ts'), 'const allowedSystemSibling = 1;');
    process.env.ProgramData = protectedRoot;
    try {
      expect((await searchWorkspaceCode(rootA, 'SYNTHETIC_SYSTEM_CODEBASE_SECRET')).matches).toEqual([]);
      expect((await searchWorkspaceCode(rootA, 'allowedSystemSibling')).matches[0].text).toContain('allowedSystemSibling');
      expect(fs.readFileSync(path.join(protectedRoot, 'config.json'), 'utf8')).toBe('SYNTHETIC_SYSTEM_CODEBASE_SECRET');
    } finally { if (prior === undefined) delete process.env.ProgramData; else process.env.ProgramData = prior; }
  });
  test('codebase held reads reject a same-byte file redirected to a protected profile', async () => {
    fs.mkdirSync(mockUserData); const file = path.join(rootA, 'allowed.ts'), secret = path.join(mockUserData, 'secret.ts');
    fs.writeFileSync(file, 'const syntheticRedirectMarker = 1;'); fs.writeFileSync(secret, 'const syntheticRedirectMarker = 1;');
    const original = nativeFs.openSync;
    jest.spyOn(nativeFs, 'openSync').mockImplementation(((input: any, flags: any, mode: any) => original(input === file ? secret : input, flags, mode)) as any);
    expect((await searchWorkspaceCode(rootA, 'syntheticRedirectMarker')).matches).toEqual([]);
    expect(fs.readFileSync(secret, 'utf8')).toBe('const syntheticRedirectMarker = 1;');
  });
});
