import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let mockHome: string, mockProfile: string;
jest.mock('electron', () => ({
  app: { getPath: () => mockProfile || require('os').tmpdir(), isPackaged: false },
  ipcMain: { on: jest.fn(), handle: jest.fn() }, BrowserWindow: jest.fn(),
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  shell: { openExternal: jest.fn(), openPath: jest.fn() }, nativeTheme: { themeSource: 'system' },
}));
jest.mock('../window-manager', () => ({ getMainWindow: jest.fn() }));
jest.mock('../user-paths', () => ({ homeDir: () => mockHome || require('os').tmpdir() }));
jest.mock('../config-manager', () => ({ getSettings: () => ({ allowAutoTools: true, saveConversationHistory: false, chatModel: 'llama3.2:3b' }), saveSettings: jest.fn() }));
jest.mock('../memory-manager', () => ({ MemoryManager: { getConversation: jest.fn(), saveConversation: jest.fn(), addMessageToConversation: jest.fn() } }));
jest.mock('../mcp-client', () => ({ seedMcpDefaults: jest.fn(), discoverExternalMcpServers: jest.fn(), initializeMcpServers: jest.fn(), getMcpTools: () => [] }));

import { analyzeAndRouteMessage, preProcessIntent } from '../message-router';
import { approveWorkspacePlan, currentWorkspace, prepareWorkspacePlan, runWorkspaceRequest } from '../workspace-context';

describe('authoritative IDE requests cannot select legacy automatic effect handlers', () => {
  let root: string, report: string, projectFile: string;
  beforeEach(() => {
    mockHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-intent-'));
    mockProfile = path.join(mockHome, 'profile'); root = path.join(mockHome, 'project');
    fs.mkdirSync(root); fs.mkdirSync(path.join(mockHome, 'Desktop'));
    report = path.join(mockHome, 'Desktop', 'weather_your_location.txt'); projectFile = path.join(root, 'keep.ts');
    fs.writeFileSync(report, 'Keep the existing Desktop report.\r\n'); fs.writeFileSync(projectFile, 'Keep the project bytes.\r\n');
  });
  afterEach(() => fs.rmSync(mockHome, { recursive: true, force: true }));
  const prompts = [
    'save the weather forecast to a file', 'save the NBA scores to a file',
    'save the surf forecast to a file', 'search for current election results and save to a file',
    'draw a cat', 'open spotify',
  ];
  const request = (planId?: string) => ({ workspace: { root, ...(planId ? { planId } : {}) }, streamId: 'intent-control', conversation_id: 'ordinary-looking-chat-id' });

  test.each([false, true])('the real async IDE scope routes legacy prompts to the reviewed model path (approved=%s)', async approved => {
    let planId: string | undefined;
    if (approved) { const plan = prepareWorkspacePlan(root, 'Review proposed project changes.', 1); approveWorkspacePlan(root, plan.id, 1); planId = plan.id; }
    const beforeDesktop = fs.readFileSync(report), beforeProject = fs.readFileSync(projectFile);
    await runWorkspaceRequest(request(planId), 1, async () => {
      await Promise.resolve(); // The request authority must survive async preprocessing.
      expect(currentWorkspace()).toMatchObject({ root: fs.realpathSync(root), approved });
      for (const prompt of prompts) {
        expect(await preProcessIntent(prompt, 'ordinary-looking-chat-id')).toBeNull();
        expect(await analyzeAndRouteMessage(prompt)).toEqual({ type: 'llm' });
      }
    });
    expect(currentWorkspace()).toBeUndefined();
    expect(fs.readFileSync(report)).toEqual(beforeDesktop); expect(fs.readFileSync(projectFile)).toEqual(beforeProject);
    expect(fs.readdirSync(path.join(mockHome, 'Desktop'))).toEqual([path.basename(report)]);
  });

  test('parallel normal chat still selects automatic compound and regular intents while an IDE scope awaits', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const ide = runWorkspaceRequest(request(), 1, async () => { await pending; return analyzeAndRouteMessage(prompts[0]); });
    try {
      expect(currentWorkspace()).toBeUndefined();
      expect(await analyzeAndRouteMessage(prompts[0])).toMatchObject({ type: 'tools', calls: [{ name: '__compound_weather_file' }] });
      expect(await preProcessIntent('draw a cat')).toMatchObject({ calls: [{ name: 'image_generate' }] });
    } finally { release(); }
    expect(await ide).toEqual({ type: 'llm' });
  });

  test('a cancelled IDE scope cannot fall back to a legacy direct-write intent', async () => {
    await runWorkspaceRequest(request(), 1, async () => {
      currentWorkspace()!.cancelled = true;
      await Promise.resolve();
      expect(await analyzeAndRouteMessage(prompts[0])).toEqual({ type: 'llm' });
    });
    expect(fs.readFileSync(report, 'utf8')).toBe('Keep the existing Desktop report.\r\n');
  });
});
