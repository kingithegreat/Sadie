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

import * as fs from 'fs';
import { streamFromLLM, setUncensoredMode, detectToolCategories } from '../message-router';
import { initializeTools, getSmallModelTools } from '../tools';
import { __resetMediaJobsForTests, readJobs } from '../tools/media';

jest.setTimeout(20 * 60 * 1000);

/**
 * Run one chat turn. The conversation id is a parameter so a sequence of turns
 * shares history, which is what makes "write the script for it" resolvable.
 */
async function turnIn(conversationId: string, message: string) {
  const toolCalls: string[] = [];
  let usedModel = '';
  let text = '';
  let error: any = null;

  await new Promise<void>((resolve) => {
    streamFromLLM(
      message,
      undefined,
      conversationId,
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

/** A one-off turn in its own conversation. */
const turn = (message: string) => turnIn(`live-${Date.now()}`, message);

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

    // Up to three attempts, because the claim is "a 7B CAN drive this", not
    // "does on every sample". Compliance varies run to run at this size; three
    // failures in a row would mean something is actually wrong rather than the
    // model having been unlucky.
    let attempts = 0;
    while (readJobs().length === 0 && attempts < 3) {
      attempts++;
      const res = await turn('Start a new short video in the Media Studio titled "Jonah and the storm".');
      // eslint-disable-next-line no-console
      console.log(`attempt ${attempts}: model=${res.usedModel} jobs=${readJobs().length}`);
    }

    // eslint-disable-next-line no-console
    console.log('jobs after the turn:', readJobs().map(j => `${j.title} [${j.state}]`));
    // The assertion is on the OUTCOME — a job exists — never on which tool
    // name the model chose to get there.
    expect(readJobs().length).toBeGreaterThan(0);
  });

  /**
   * The whole pipeline, driven by sentences rather than by calling tools.
   *
   * Each stage is proven individually and the first turn is proven above. What
   * is NOT proven is the chain: whether the model, offered one media tool per
   * turn out of sixteen slots, picks the right one at each step — and whether
   * a tool that refuses ("run media_write_script first") actually steers it.
   *
   * Assertions are on the JOB, never on which tool name the model chose. A
   * different phrasing that reaches the same state is not a failure.
   */
  it('is driven through the pipeline by ordinary sentences', async () => {
    setUncensoredMode(true);
    __resetMediaJobsForTests();
    const conversation = `chain-${Date.now()}`;

    const say = async (message: string) => {
      const r = await turnIn(conversation, message);
      const job = readJobs()[0];
      // eslint-disable-next-line no-console
      console.log(`  "${message}" -> ${job ? `${job.title} [${job.state}]` : 'no job'}`);
      return r;
    };

    await say('Make me a short video about Jonah and the storm.');
    expect(readJobs().length).toBeGreaterThan(0);

    // From here the hard assertion is on REACHABILITY, and compliance is only
    // reported.
    //
    // Whether a 7B calls the tool it was handed varies run to run: one run
    // chained create and write_script in a single turn, the next created the
    // job and then talked about the script instead of writing it. That is the
    // model's behaviour, and asserting it would make this test fail for a
    // reason outside the code — the thing it exists to catch is the tool not
    // being on the table at all, which is ours and which silently broke.
    for (const [message, expected] of [
      ['Write the script for it.', 'media_write_script'],
      ['Now record the narration.', 'media_narrate'],
      ['Render it into a video.', 'media_render'],
    ] as const) {
      const offered = getSmallModelTools({
        categories: detectToolCategories(message), query: message,
      }).map((t: any) => t.function?.name ?? t.name);
      expect(offered).toContain(expected);
    }

    await say('Write the script for it.');
    const scripted = readJobs()[0];
    // eslint-disable-next-line no-console
    console.log(`  script: ${(scripted.script || '').length} chars`);
    if (!scripted.script) return; // the model stopped here this run

    await say('Now record the narration.');
    const narrated = readJobs()[0];
    // eslint-disable-next-line no-console
    console.log(`  narration: ${narrated.narrationPath ? 'recorded' : 'not called this run'}`);
    if (!narrated.narrationPath) return;
    expect(fs.existsSync(narrated.narrationPath)).toBe(true);

    const { findFfmpeg } = await import('../media-render');
    if (!(await findFfmpeg())) return;

    await say('Render it into a video.');
    const rendered = readJobs()[0];
    // eslint-disable-next-line no-console
    console.log(`  render: ${rendered.renderPath ? 'produced' : 'not called this run'}`);
    if (rendered.renderPath) expect(fs.existsSync(rendered.renderPath)).toBe(true);
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
