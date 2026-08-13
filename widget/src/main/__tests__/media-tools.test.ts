/**
 * The Media Studio, end to end from a chat request.
 *
 * The state machine is tested separately and exhaustively. This asks the
 * question that keeps catching this codebase out: is the capability actually
 * REACHABLE? A perfect pipeline nothing can route to is the same defect as the
 * CRM tools, the dead logger and the automation intent — the feature exists
 * and the user cannot get to it.
 *
 * So it covers three links in one chain:
 *   1. a plausible request routes to the media category
 *   2. a small model is actually offered the media tools
 *   3. the tools drive the pipeline, and the approval gate still holds
 */

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
}));

import { detectToolCategories } from '../message-router';
import { getSmallModelTools, initializeTools } from '../tools';
import {
  mediaToolHandlers,
  readJobs,
  __resetMediaJobsForTests,
} from '../tools/media';

beforeAll(() => { initializeTools(); });
beforeEach(() => { __resetMediaJobsForTests(); });
afterAll(() => { __resetMediaJobsForTests(); });

const call = (name: string, args: any = {}) =>
  mediaToolHandlers[name](args, { executionId: 'test' } as any);

describe('a video request reaches the Media Studio', () => {
  it.each([
    'make a short video about Jonah',
    'what videos are waiting for approval',
    'write a script for the next episode',
    'upload that to youtube',
  ])('"%s" routes to the media category', (prompt) => {
    expect(detectToolCategories(prompt)).toContain('media');
  });

  it.each([
    'enable web research for the media studio',
    'open the media studio',
    'add captions to that',
    'redo the voiceover',
  ])('"%s" routes to media too', (prompt) => {
    // Naming the panel is the most direct way to ask for it, and it used to
    // route on "research" to 'web' — offering no media tool at all.
    expect(detectToolCategories(prompt)).toContain('media');
  });

  it.each([
    'write a social media post about the launch',
    'schedule a social media update',
  ])('"%s" does not', (prompt) => {
    // The reason "media studio" is matched as a phrase and bare "media" is not.
    expect(detectToolCategories(prompt)).not.toContain('media');
  });

  it('a small model is offered a media tool for a video request', () => {
    const prompt = 'what videos are waiting for approval';
    const offered = getSmallModelTools({
      categories: detectToolCategories(prompt), query: prompt,
    }).map((t: any) => t.function?.name ?? t.name);
    expect(offered.some((n: string) => n.startsWith('media_'))).toBe(true);
  });
});

describe('driving the pipeline from chat', () => {
  it('creates a job at the idea stage', async () => {
    const res: any = await call('media_create_job', { title: 'One-Minute Bible: Jonah', format: 'short' });
    expect(res.success).toBe(true);
    const jobs = readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state).toBe('idea');
  });

  it('lists jobs, and filters by stage', async () => {
    await call('media_create_job', { title: 'A' });
    await call('media_create_job', { title: 'B' });
    const all: any = await call('media_list_jobs', {});
    expect(String(all.result)).toContain('A');
    expect(String(all.result)).toContain('B');

    const filtered: any = await call('media_list_jobs', { state: 'published' });
    expect(String(filtered.result)).toMatch(/no videos/i);
  });

  it('advances a job and refuses an illegal jump', async () => {
    await call('media_create_job', { title: 'Jonah' });
    const good: any = await call('media_advance_job', { job: 'Jonah', to: 'researching' });
    expect(good.success).toBe(true);

    const bad: any = await call('media_advance_job', { job: 'Jonah', to: 'published' });
    expect(bad.success).toBe(false);
    // The refusal has to say what IS possible, or it just looks broken.
    expect(String(bad.error)).toMatch(/script_draft|allowed/i);
  });

  it('accepts a stage written with spaces or hyphens', async () => {
    await call('media_create_job', { title: 'Jonah' });
    const res: any = await call('media_advance_job', { job: 'Jonah', to: 'Researching' });
    expect(res.success).toBe(true);
  });

  it('reports a job it cannot find rather than failing silently', async () => {
    const res: any = await call('media_advance_job', { job: 'nothing like this', to: 'researching' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/no media job/i);
  });
});

describe('the approval gate holds through the tool layer', () => {
  async function toAwaitingApproval(title: string) {
    await call('media_create_job', { title });
    for (const to of ['researching', 'script_draft', 'script_qa', 'media_production', 'render_qa', 'awaiting_approval']) {
      await call('media_advance_job', { job: title, to });
    }
  }

  it('media_advance_job cannot approve a video', async () => {
    await toAwaitingApproval('Jonah');
    // The legal transition exists, but only a human decision may take it —
    // and advance_job never claims to be one.
    const res: any = await call('media_advance_job', { job: 'Jonah', to: 'approved' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/human decision/i);
    expect(readJobs()[0].state).toBe('awaiting_approval');
  });

  it('media_approve_job does, and records who decided', async () => {
    await toAwaitingApproval('Jonah');
    const res: any = await call('media_approve_job', { job: 'Jonah', note: 'looks good' });
    expect(res.success).toBe(true);
    const job = readJobs()[0];
    expect(job.state).toBe('approved');
    expect(job.history.at(-1)).toMatchObject({ to: 'approved', by: 'human', note: 'looks good' });
  });

  it('refuses to approve something not awaiting approval', async () => {
    await call('media_create_job', { title: 'Jonah' });
    const res: any = await call('media_approve_job', { job: 'Jonah' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/not waiting for approval/i);
  });

  it('can send a video back for revision instead of killing it', async () => {
    await toAwaitingApproval('Jonah');
    const res: any = await call('media_reject_job', { job: 'Jonah', reason: 'revise', note: 'hook is weak' });
    expect(res.success).toBe(true);
    expect(readJobs()[0].state).toBe('needs_revision');
  });

  it('both approval tools require confirmation, and the routine ones do not', () => {
    // These are publishing decisions; they must not run unattended. The
    // fail-closed change to executeTool means a run with no way to ask now
    // refuses outright.
    //
    // Asserted as two invariants rather than an exact list: the previous
    // version pinned the gated set to exactly the two approval tools, so
    // adding any other gated tool (media_setup_research, which writes a
    // workflow into the user's n8n) failed a test about APPROVAL. A test
    // should break when its own subject changes, not when a neighbour does.
    const { mediaToolDefs } = require('../tools/media');
    const gated = new Set(
      mediaToolDefs.filter((d: any) => d.requiresConfirmation).map((d: any) => d.name),
    );
    expect(gated.has('media_approve_job')).toBe(true);
    expect(gated.has('media_reject_job')).toBe(true);

    // Creating, listing and advancing must stay ungated — prompting on the
    // routine ones is how a confirmation stops meaning anything.
    for (const name of ['media_create_job', 'media_list_jobs', 'media_advance_job']) {
      expect(gated.has(name)).toBe(false);
    }
  });
});

describe('the narration stage', () => {
  it('refuses a job with no script rather than narrating nothing', async () => {
    await call('media_create_job', { title: 'Jonah' });
    const res: any = await call('media_narrate', { job: 'Jonah' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/no script yet/i);
  });

  it('refuses at a stage where narration makes no sense', async () => {
    await call('media_create_job', { title: 'Jonah' });
    // Give it a script but leave it at idea.
    const jobs = readJobs();
    jobs[0].script = 'Some narration.';
    require('../tools/media').writeJobs(jobs);

    const res: any = await call('media_narrate', { job: 'Jonah' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/script_draft|script_qa/);
  });

  it('is offered for a narration request', () => {
    const prompt = 'record the narration for that video';
    const offered = getSmallModelTools({
      categories: detectToolCategories(prompt), query: prompt,
    }).map((t: any) => t.function?.name ?? t.name);
    // "narration" is in the media routing pattern; without it this stage would
    // exist and be unreachable.
    expect(offered).toContain('media_narrate');
  });
});

/**
 * Every category the request matched gets a seat at the table.
 *
 * Ranking alone was not enough. Scoring is lexical, so one word can dominate
 * it: "make the video file for Jonah" matches media, filesystem and utility,
 * and "file" is a NAME match for the filesystem tools (+10 each) while the
 * media tools only match "video" in their descriptions (+1). All four category
 * slots went to filesystem, and a request plainly about a video was offered no
 * media tool at all — the same starvation the earlier ranking change was meant
 * to fix, with a different winner.
 */
describe('category slots are shared, not won outright', () => {
  const offeredFor = (query: string) =>
    getSmallModelTools({ categories: detectToolCategories(query), query })
      .map((t: any) => t.function?.name ?? t.name);

  it('offers a media tool for a video request that also mentions a file', () => {
    const query = 'make the video file for Jonah';
    // The premise: this really does match several categories.
    expect(detectToolCategories(query).length).toBeGreaterThan(1);
    expect(offeredFor(query).some((n: string) => n.startsWith('media_'))).toBe(true);
  });

  it('still offers the filesystem tools the same request asked about', () => {
    // Sharing must not just move the starvation onto another category.
    const offered = offeredFor('make the video file for Jonah');
    expect(offered.some((n: string) => ['write_file', 'read_file', 'list_directory'].includes(n))).toBe(true);
  });

  it('gives a single-category request its pick, as before', () => {
    const offered = offeredFor('what videos are waiting for approval');
    expect(offered.filter((n: string) => n.startsWith('media_')).length).toBeGreaterThan(1);
  });
});

/**
 * "it" has to resolve, or the pipeline cannot be driven by conversation.
 *
 * Turn two of a real chat is "Write the script for it." The model passes that
 * word through verbatim; nothing matched; the chain stopped at the first stage
 * with a job sitting right there.
 */
describe('referring to a job the way a person does', () => {
  it.each(['it', 'that', 'the video', ''])('resolves %j to the only job', async (ref) => {
    await call('media_create_job', { title: 'One-Minute Bible: Jonah' });
    const res: any = await call('media_advance_job', { job: ref, to: 'researching' });
    expect(res.success).toBe(true);
    expect(readJobs()[0].state).toBe('researching');
  });

  it('picks the most recently worked-on job when several are open', async () => {
    await call('media_create_job', { title: 'First' });
    await call('media_create_job', { title: 'Second' });
    // Touch the first one so it becomes the one under discussion.
    await call('media_advance_job', { job: 'First', to: 'researching' });

    const res: any = await call('media_advance_job', { job: 'it', to: 'script_draft' });
    expect(res.success).toBe(true);
    expect(readJobs().find(j => j.title === 'First')!.state).toBe('script_draft');
    expect(readJobs().find(j => j.title === 'Second')!.state).toBe('idea');
  });

  it('still reports a genuinely unknown title rather than guessing', async () => {
    await call('media_create_job', { title: 'Jonah' });
    const res: any = await call('media_advance_job', { job: 'a video about penguins', to: 'researching' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/no media job/i);
  });
});
