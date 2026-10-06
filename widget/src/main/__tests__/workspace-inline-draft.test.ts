import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
let mockHome: string, mockProfile: string, mockOllama: string, mockWindow: any;
let mockProvider: 'ollama' | 'cloud' | 'code' = 'ollama';
const mockHandlers: Record<string, Function> = {};
jest.mock('electron', () => ({
  ipcMain: { on: (channel: string, handler: Function) => { mockHandlers[channel] = handler; }, handle: jest.fn() },
  app: { getPath: () => mockProfile || require('os').tmpdir(), isPackaged: false }, BrowserWindow: jest.fn(),
  dialog: { showMessageBox: jest.fn() }, shell: { openExternal: jest.fn() }, nativeTheme: {},
}));
jest.mock('../env', () => ({ isE2E: false, isPackagedBuild: false }));
jest.mock('../window-manager', () => ({ getMainWindow: () => mockWindow }));
jest.mock('../user-paths', () => ({ homeDir: () => mockHome || require('os').tmpdir() }));
jest.mock('../config-manager', () => ({ getSettings: () => ({
  ollamaUrl: mockOllama, chatModel: 'qwen2.5:7b', codeModel: 'qwen2.5:7b', uncensoredModel: 'qwen2.5:7b',
  saveConversationHistory: false, allowAutoTools: true, enableSmartRouting: false, toolRouting: false,
  useCustomLLM: mockProvider !== 'ollama',
  customLLM: mockProvider === 'cloud' ? { enabled: true, name: 'Loopback provider', provider: 'openai', model: 'gpt-4o', apiUrl: mockOllama, apiKey: 'fixture-not-a-secret' } : undefined,
  codeApiKey: mockProvider === 'code' ? 'fixture-not-a-secret' : '', codeApiProvider: 'openai', codeApiUrl: mockOllama,
  permissions: {},
}), saveSettings: jest.fn() }));
jest.mock('../memory-manager', () => ({ MemoryManager: {
  getConversation: jest.fn(id => String(id).startsWith('workspace:') ? { messages: [{ role: 'assistant', content: 'PRIVATE_ASSISTANT_HISTORY', streamingState: 'finished' }] } : null),
  saveConversation: jest.fn(), addMessageToConversation: jest.fn(),
} }));
jest.mock('../mcp-client', () => ({ getMcpTools: () => [], seedMcpDefaults: jest.fn(), discoverExternalMcpServers: jest.fn(), initializeMcpServers: jest.fn() }));
import { registerMessageRouter, setUncensoredMode } from '../message-router';
import { approveWorkspacePlan, prepareWorkspacePlan, runWorkspaceRequest, currentWorkspace, workspaceToolError } from '../workspace-context';
import { registerTool, getTool } from '../tools/registry';

jest.setTimeout(20_000);
describe('actual inline draft IPC through the real model HTTP boundary', () => {
  let root: string, file: string, server: http.Server, bodies: any[], malicious: boolean, previousOllama: string | undefined;
  beforeEach(async () => {
    mockHome = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-draft-')); mockProfile = path.join(mockHome, 'profile'); root = path.join(mockHome, 'project');
    fs.mkdirSync(root); file = path.join(root, 'main.ts'); fs.writeFileSync(file, 'const original = 1;\r\n');
    bodies = []; malicious = false; mockProvider = 'ollama';
    server = http.createServer(async (req, res) => {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : {};
      if (req.url === '/chat/completions') {
        bodies.push(body); res.writeHead(200, { 'content-type': 'text/event-stream' });
        const delta = malicious
          ? { tool_calls: [{ index: 0, id: 'unrequested-tool', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'main.ts', content: 'FORBIDDEN' }) } }] }
          : { content: 'const renamed = 1;' };
        res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: malicious ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`); return;
      }
      if (req.url === '/api/chat') {
        bodies.push(body);
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        // Even an unsolicited tool call must not reach an effect handler.
        const message = malicious ? { content: '', tool_calls: [{ function: { name: 'write_file', arguments: { path: 'main.ts', content: 'FORBIDDEN' } } }] } : { content: 'const renamed = 1;' };
        res.end(JSON.stringify({ model: 'qwen2.5:7b', message, done: true }) + '\n'); return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }], capabilities: ['completion', 'tools'], version: 'fixture' }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    mockOllama = `http://127.0.0.1:${(server.address() as any).port}`;
    previousOllama = process.env.OLLAMA_URL; process.env.OLLAMA_URL = mockOllama;
    registerMessageRouter({} as any, mockOllama); setUncensoredMode(false);
  });
  afterEach(async () => {
    if (previousOllama === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = previousOllama;
    await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(mockHome, { recursive: true, force: true });
  });
  async function draft(mode: unknown = 'inline-draft') {
    const id = `inline-edit:real-${Date.now()}-${Math.random()}`;
    const sends: Array<{ channel: string; payload: any }> = [];
    let complete!: () => void;
    const finished = new Promise<void>(resolve => { complete = resolve; });
    const sender = { id: 3, mainFrame: {}, send: (channel: string, payload: any) => { sends.push({ channel, payload }); if (channel === 'homebot:stream-end' || channel === 'homebot:stream-error') complete(); } };
    mockWindow = { isDestroyed: () => false, webContents: sender };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await mockHandlers['homebot:stream-message']({ sender, senderFrame: sender.mainFrame }, {
        streamId: id, conversation_id: id, user_id: 'desktop_user', workspace: { root, mode },
        message: 'Replace this TypeScript code. Return only replacement source, without fences. Rename original.\nconst original = 1;',
      });
      await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Actual inline IPC never completed its real HTTP request.')), 5000); })]);
      return sends;
    } finally { clearTimeout(timer); }
  }
  test('first real inline request reaches HTTP with draft framing and no tool schemas or assistant history', async () => {
    const sends = await draft();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].tools).toBeUndefined();
    const prompt = bodies[0].messages.map((message: any) => message.content).join('\n');
    expect(prompt).toContain(fs.realpathSync(root)); expect(prompt).toContain('Return only the requested replacement source code');
    expect(prompt).not.toContain('Read-only planning'); expect(prompt).not.toContain('PRIVATE_ASSISTANT_HISTORY');
    expect(sends.filter(send => send.channel === 'homebot:stream-error')).toEqual([]);
    expect(sends.filter(send => send.channel === 'homebot:stream-chunk').map(send => send.payload.chunk).join('')).toContain('const renamed = 1;');
    expect(fs.readFileSync(file, 'utf8')).toBe('const original = 1;\r\n');
  });
  test('unknown draft modes fail before HTTP and real draft authority blocks read/write/MCP effects even with approved plans available', async () => {
    const sends = await draft('unsafe-approved-draft'); expect(bodies).toEqual([]);
    expect(sends.some(send => send.channel === 'homebot:stream-error' && /Unknown IDE request mode/.test(send.payload.message))).toBe(true);
    const plan = prepareWorkspacePlan(root, 'Propose an edit.', 3); approveWorkspacePlan(root, plan.id, 3);
    expect(() => runWorkspaceRequest({ workspace: { root, mode: 'inline-draft', planId: plan.id }, streamId: 'combined' }, 3, () => {})).toThrow('cannot use plan approval');
    const effect = jest.fn(async () => ({ success: true })); registerTool('read_file', { name: 'read_file' } as any, effect);
    await runWorkspaceRequest({ workspace: { root, mode: 'inline-draft' }, streamId: 'no-tools' }, 3, async () => {
      expect(currentWorkspace()).toMatchObject({ approved: false, mode: 'inline-draft' });
      for (const name of ['read_file', 'write_file', 'edit_file', 'mcp_example', 'run_terminal_command']) expect(workspaceToolError(name)).toMatch(/cannot call tools/);
      expect(await getTool('read_file')!.handler({}, {} as any)).toMatchObject({ success: false });
    });
    expect(effect).not.toHaveBeenCalled();
    expect(await getTool('read_file')!.handler({}, {} as any)).toMatchObject({ success: true }); expect(effect).toHaveBeenCalledTimes(1);
  });
  test('unsolicited model tool calls cannot change real project bytes', async () => {
    malicious = true; const sends = await draft();
    expect(bodies).toHaveLength(1); expect(bodies[0].tools).toBeUndefined();
    expect(sends.some(send => send.channel === 'homebot:stream-error' && /requested a tool/.test(String(send.payload.details)))).toBe(true);
    expect(sends.filter(send => send.channel === 'homebot:stream-chunk')).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe('const original = 1;\r\n');
  });
  test.each(['cloud', 'code'] as const)('the real %s provider receives draft framing without tool schemas and rejects unsolicited tool callbacks', async provider => {
    mockProvider = provider;
    const success = await draft();
    expect(bodies).toHaveLength(1); expect(bodies[0].tools).toBeUndefined();
    expect(JSON.stringify(bodies[0].messages)).toContain('Return only the requested replacement source code');
    expect(JSON.stringify(bodies[0].messages)).not.toContain('PRIVATE_ASSISTANT_HISTORY');
    expect(success.some(send => send.channel === 'homebot:stream-chunk' && send.payload.chunk === 'const renamed = 1;')).toBe(true);
    malicious = true; bodies = [];
    const failure = await draft();
    expect(bodies).toHaveLength(1); expect(bodies[0].tools).toBeUndefined();
    expect(failure.some(send => send.channel === 'homebot:stream-error' && /requested a tool/.test(String(send.payload.details)))).toBe(true);
    expect(failure.filter(send => send.channel === 'homebot:stream-chunk')).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe('const original = 1;\r\n');
  });
});
