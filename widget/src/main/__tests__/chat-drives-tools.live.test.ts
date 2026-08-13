/**
 * Can the model actually reach the tools?
 *
 * OPT-IN. Needs Ollama running with the configured models:
 *
 *   cd widget && npx cross-env HOMEBOT_LIVE=1 npx jest chat-drives-tools.live
 *
 * Every stage of the Media Studio is tested by calling its tool directly. That
 * proves the stage works and says nothing about whether a request in chat ever
 * arrives at it — the defect this codebase produces over and over.
 *
 * The specific failure this exists to catch: uncensoredMode ships ON, which
 * selected dolphin-mistral:7b, and Ollama rejects any request carrying tools
 * for that model outright —
 *
 *   400 "registry.ollama.ai/library/dolphin-mistral:7b does not support tools"
 *
 * so on a default install NO tool in HomeBot could be called from chat. The
 * request errored and the non-stream fallback answered without tools, which
 * looks like a working assistant that simply never does anything.
 */

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

jest.mock('../mcp-client', () => ({
  seedMcpDefaults: jest.fn(),
  discoverExternalMcpServers: jest.fn(),
  initializeMcpServers: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => require('os').tmpdir()),
    getAppPath: jest.fn(() => require('os').tmpdir()),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  BrowserWindow: jest.fn().mockImplementation(() => ({ webContents: { send: jest.fn() } })),
  Notification: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  dialog: { showMessageBox: jest.fn(), showOpenDialog: jest.fn() },
  nativeTheme: { themeSource: 'system' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { streamFromLLM, setUncensoredMode } from '../message-router';
import { initializeTools } from '../tools';
import { __resetMediaJobsForTests, readJobs } from '../tools/media';

jest.setTimeout(8 * 60 * 1000);

/** Run one chat turn and report what the model reached for. */
async function turn(message: string) {
  const toolCalls: string[] = [];
  let usedModel = '';
  let text = '';
  let error: any = null;

  await new Promise<void>((resolve) => {
    streamFromLLM(
      message,
      undefined,
      `live-${Date.now()}`,
      (chunk) => { text += chunk; },
      (toolName) => { toolCalls.push(toolName); },
      () => {},
      () => resolve(),
      (err) => { error = err; resolve(); },
      undefined,
      undefined,
      {},
      (meta) => { usedModel = meta.model; },
    ).catch((e) => { error = e; resolve(); });
  });

  return { toolCalls, usedModel, text, error };
}

maybe('a chat turn reaches the tools', () => {
  beforeAll(() => { initializeTools(); __resetMediaJobsForTests(); });
  afterAll(() => { __resetMediaJobsForTests(); });

  it('picks a tool-capable model when the turn needs tools, even in uncensored mode', async () => {
    setUncensoredMode(true); // the shipped default

    const res = await turn('Make me a short video about Jonah and the storm.');
    // eslint-disable-next-line no-console
    console.log(`model=${res.usedModel} toolCalls=${JSON.stringify(res.toolCalls)} err=${res.error?.message || ''}`);

    // The heart of it: the model chosen must be one Ollama will accept tools
    // for. dolphin-mistral is not.
    expect(res.usedModel).toBeTruthy();
    expect(res.usedModel).not.toMatch(/dolphin/i);
    expect(res.error).toBeNull();
  });

  it('actually creates the job, not just an answer about creating one', async () => {
    setUncensoredMode(true);
    __resetMediaJobsForTests();

    const res = await turn('Start a new short video in the Media Studio titled "Jonah and the storm".');
    // eslint-disable-next-line no-console
    console.log(`model=${res.usedModel} toolCalls=${JSON.stringify(res.toolCalls)}`);
    // eslint-disable-next-line no-console
    console.log('jobs after the turn:', readJobs().map(j => `${j.title} [${j.state}]`));

    // A model may phrase things differently, so the assertion is on the
    // OUTCOME — a job exists — rather than on which tool name it chose.
    expect(readJobs().length).toBeGreaterThan(0);
  });

  it('still uses the uncensored model for plain conversation', async () => {
    // The fix must not quietly disable uncensored mode. A turn that needs no
    // tools should be unaffected.
    setUncensoredMode(true);
    const res = await turn('Hello.');
    // eslint-disable-next-line no-console
    console.log(`greeting model=${res.usedModel}`);
    expect(res.usedModel).toMatch(/dolphin/i);
  });
});
