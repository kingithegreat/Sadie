import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { Socket } from 'net';

let mockHome: string, mockProfile: string, mockEndpoint: string, mockWindow: any;
let mockProvider: 'cloud' | 'code';
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
  ollamaUrl: mockEndpoint, chatModel: 'qwen2.5:7b', codeModel: 'qwen2.5:7b', uncensoredModel: 'qwen2.5:7b',
  saveConversationHistory: false, allowAutoTools: true, enableSmartRouting: false, toolRouting: false,
  useCustomLLM: true,
  customLLM: mockProvider === 'cloud' ? { enabled: true, name: 'Workspace HTTP fixture', provider: 'openai', model: 'gpt-4o', apiUrl: mockEndpoint, apiKey: 'fixture-not-a-secret' } : undefined,
  codeApiKey: mockProvider === 'code' ? 'fixture-not-a-secret' : '', codeApiProvider: 'openai', codeApiUrl: mockEndpoint,
  permissions: {},
}), saveSettings: jest.fn() }));
jest.mock('../memory-manager', () => ({ MemoryManager: {
  getConversation: jest.fn(() => null), saveConversation: jest.fn(), addMessageToConversation: jest.fn(),
} }));
jest.mock('../mcp-client', () => ({ getMcpTools: () => [], seedMcpDefaults: jest.fn(), discoverExternalMcpServers: jest.fn(), initializeMcpServers: jest.fn(async () => {}) }));
import { registerMessageRouter, setUncensoredMode } from '../message-router';
import { approveWorkspacePlan, prepareWorkspacePlan } from '../workspace-context';

jest.setTimeout(20_000);
describe('ordinary authoritative workspace prompts at the actual cloud HTTP boundary', () => {
  let root: string, file: string, server: http.Server, bodies: any[], sockets: Set<Socket>, previousOllama: string | undefined;
  const planText = 'Inspect main.ts first.\nPropose renaming original to reviewedName; preserve every other byte.';
  beforeEach(async () => {
    mockHome = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-provider-'));
    mockProfile = path.join(mockHome, 'profile'); root = path.join(mockHome, 'project');
    fs.mkdirSync(root); file = path.join(root, 'main.ts'); fs.writeFileSync(file, 'const original = 1;\r\n');
    bodies = []; sockets = new Set(); mockProvider = 'cloud';
    server = http.createServer(async (req, res) => {
      let text = ''; for await (const chunk of req) text += chunk;
      if (req.url === '/chat/completions') {
        bodies.push(JSON.parse(text)); res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'WORKSPACE_PROMPT_OK' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }], capabilities: ['completion', 'tools'], version: 'fixture' })); }
    });
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    mockEndpoint = `http://127.0.0.1:${(server.address() as any).port}`;
    previousOllama = process.env.OLLAMA_URL; process.env.OLLAMA_URL = mockEndpoint;
    registerMessageRouter({} as any, mockEndpoint); setUncensoredMode(false);
  });
  afterEach(async () => {
    if (previousOllama === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = previousOllama;
    await new Promise<void>(resolve => { server.close(() => resolve()); for (const socket of sockets) socket.destroy(); });
    fs.rmSync(mockHome, { recursive: true, force: true });
  });
  async function send(planId?: string) {
    const id = `workspace:provider-${Date.now()}-${Math.random()}`;
    const sends: Array<{ channel: string; payload: any }> = [];
    let complete!: () => void;
    const finished = new Promise<void>(resolve => { complete = resolve; });
    const sender = { id: 3, mainFrame: {}, send: (channel: string, payload: any) => { sends.push({ channel, payload }); if (channel === 'homebot:stream-end' || channel === 'homebot:stream-error') complete(); } };
    mockWindow = { isDestroyed: () => false, webContents: sender };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // No inline mode and no client-supplied conversationPrompt: main must derive scope.
      await mockHandlers['homebot:stream-message']({ sender, senderFrame: sender.mainFrame }, {
        streamId: id, conversation_id: id, user_id: 'desktop_user', workspace: { root, ...(planId ? { planId } : {}) },
        message: 'Write a TypeScript function after inspecting main.ts. Explain the proposed code change.',
      });
      await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Workspace IPC did not complete its real HTTP request.')), 5000); })]);
      return sends;
    } finally { clearTimeout(timer); }
  }
  function systemPrompt() {
    expect(bodies).toHaveLength(1);
    const system = bodies[0].messages.filter((message: any) => message.role === 'system').map((message: any) => message.content).join('\n');
    expect(system).not.toContain('Return only the requested replacement source code');
    return system;
  }
  test.each(['cloud', 'code'] as const)('%s receives canonical project scope and read-only planning rules without approval', async provider => {
    mockProvider = provider;
    const sends = await send();
    const prompt = systemPrompt();
    expect(prompt).toContain(`You are in the IDE project ${fs.realpathSync(root)}. Relative file paths resolve here. Read-only planning. Explain a concrete plan first; no edits until the user separately approves a plan.`);
    expect(prompt).not.toContain('The user approved this plan:');
    expect(sends.filter(item => item.channel === 'homebot:stream-error')).toEqual([]);
    expect(sends.filter(item => item.channel === 'homebot:stream-chunk').map(item => item.payload.chunk).join('')).toContain('WORKSPACE_PROMPT_OK');
    expect(fs.readFileSync(file, 'utf8')).toBe('const original = 1;\r\n');
  });
  test.each(['cloud', 'code'] as const)('%s receives the actual approved multiline plan and review-only execution rules', async provider => {
    mockProvider = provider;
    const prepared = prepareWorkspacePlan(root, planText, 3);
    approveWorkspacePlan(root, prepared.id, 3);
    const sends = await send(prepared.id);
    const prompt = systemPrompt();
    expect(prompt).toContain(`You are in the IDE project ${fs.realpathSync(root)}. Relative file paths resolve here. The user approved this plan: ${planText}. Propose file changes for review; do not execute shell commands.`);
    expect(prompt).not.toContain('Read-only planning.');
    expect(sends.filter(item => item.channel === 'homebot:stream-error')).toEqual([]);
    expect(sends.filter(item => item.channel === 'homebot:stream-chunk').map(item => item.payload.chunk).join('')).toContain('WORKSPACE_PROMPT_OK');
    expect(fs.readFileSync(file, 'utf8')).toBe('const original = 1;\r\n');
  });
  test.each(['cloud', 'code'] as const)('%s cannot send another window\'s approval to the provider', async provider => {
    mockProvider = provider;
    const prepared = prepareWorkspacePlan(root, planText, 4);
    approveWorkspacePlan(root, prepared.id, 4);
    const sends = await send(prepared.id);
    expect(bodies).toEqual([]);
    expect(sends.some(item => item.channel === 'homebot:stream-error' && /Approve a current plan/.test(item.payload.message))).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('const original = 1;\r\n');
  });
});
