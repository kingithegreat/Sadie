/**
 * For a realistic request, is the tool that request NEEDS actually offered to a
 * small model?
 *
 * "automation" had no routing pattern at all, so the Automation Center's
 * headline feature was unreachable on local models unless the user happened to
 * say "schedule". That was found by hand. This is the same question asked
 * across the whole surface at once, so the next gap fails a test instead of
 * looking like a weak model.
 *
 * The chain under test is the real one:
 *   user text -> detectToolCategories -> getSmallModelTools -> offered set
 *
 * A failure here means the model is being asked to do something with no tool
 * for it — which reads to a user as the model being stupid, not as routing
 * being wrong. That misattribution is the reason this file exists.
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

beforeAll(() => { initializeTools(); });

// Mirrors the production call in message-router: the message text is passed
// as `query` so category tools are ranked by relevance rather than taken in
// registration order.
const offeredFor = (prompt: string): string[] =>
  getSmallModelTools({ categories: detectToolCategories(prompt), query: prompt })
    .map((t: any) => t.function?.name ?? t.name);

/**
 * Each case: a request a user would plausibly type, and a tool that MUST be
 * among those offered for it to be answerable at all. Where several tools
 * would do, any one of them counts.
 */
const CASES: Array<{ prompt: string; needsOneOf: string[] }> = [
  // The gap found by hand today.
  { prompt: 'create an automation that summarises my email every morning',
    needsOneOf: ['create_automation'] },
  { prompt: 'automate my morning routine',
    needsOneOf: ['create_automation'] },

  // CRM — was unreachable until the cap was fixed.
  { prompt: 'add Acme Roofing as a company in my CRM',
    needsOneOf: ['crm_create_company'] },
  { prompt: 'show me my deals that have gone stale',
    needsOneOf: ['crm_find_stale_deals', 'crm_search_deals'] },

  // Memory.
  { prompt: 'remember that I prefer dark mode',
    needsOneOf: ['remember'] },

  // Vision / screen.
  { prompt: 'what does this page say',
    needsOneOf: ['look_at_browser', 'vision_query', 'vision_describe'] },

  // Documents.
  { prompt: 'summarise the PDF on my desktop',
    needsOneOf: ['parse_document_from_path', 'parse_document'] },

  // Calendar.
  { prompt: 'what meetings do I have tomorrow',
    needsOneOf: ['list_calendar_events'] },

  // Voice.
  { prompt: 'read that back to me out loud',
    needsOneOf: ['speak'] },

  // Email.
  { prompt: 'draft an email to Sam about the invoice',
    needsOneOf: ['email_draft', 'email_send'] },

  // Media. Added after the whole category turned out to be unreachable from
  // chat for the life of the feature — the gate below covered seven of the
  // eleven categories detectToolCategories can emit, and this was one of the
  // four it missed.
  { prompt: 'make me a short video about Jonah and the storm',
    needsOneOf: ['media_create_job'] },
  { prompt: 'what videos are waiting for approval',
    needsOneOf: ['media_list_jobs'] },

  // Filesystem.
  { prompt: 'create a file on my desktop called notes.txt',
    needsOneOf: ['write_file'] },

  // System. ("what is using all my memory" reads as system to a human and
  // routes to `memory` — the completeness check below caught that.)
  { prompt: 'which processes are using the most cpu',
    needsOneOf: ['list_processes', 'get_system_info'] },

  // The three below are all category 'system', which the completeness check
  // already counted as covered by the case above — so a whole category could
  // be "covered" while the tools inside it stayed unreachable. Coverage is per
  // category; reachability is per tool.
  //
  // "screenshot" is the single most specific word a user can type for the
  // screenshot tool, and it routed to 'vision' alone: the request offered the
  // three vision tools and never the one that takes a screenshot.
  { prompt: 'take a screenshot and tell me what is on my screen',
    needsOneOf: ['screenshot'] },
  // Arithmetic matched no pattern at all, so the turn went out with no
  // categories and the model answered from its own head.
  { prompt: 'what is 15% of 240',
    needsOneOf: ['calculate'] },
  // "open" routes to 'filesystem', so asking to open an application offered
  // file tools and never launch_app.
  { prompt: 'open spotify for me',
    needsOneOf: ['launch_app'] },

  // The custom-LLM path (OpenRouter etc.) gates tools on the phrase gate
  // alone, and these three live requests all died at it — the model answered
  // "I don't have a Media Studio tool" from inside an app whose Media Studio
  // is the headline feature. detectToolCategories must fire for each so the
  // `|| intentCategories.length > 0` escape in the router opens the gate.
  { prompt: 'Search my project for all TODO comments',
    needsOneOf: ['grep_code', 'search_files', 'list_files'] },
  { prompt: 'create me a short video about mash potatoes dancing',
    needsOneOf: ['media_create_job'] },
  { prompt: 'make it in the media studio',
    needsOneOf: ['media_create_job', 'media_list_jobs'] },

  // Web.
  { prompt: 'search the web for the latest on the election',
    needsOneOf: ['web_search'] },
];

/**
 * Every category the router can name must have a case above.
 *
 * The list of cases was hand-written and drifted behind the router: media,
 * filesystem, system and web had no coverage, and media was unreachable from
 * chat for the entire life of the Media Studio without a single test failing.
 * A gate that covers seven of eleven categories reports on the seven.
 */
const CATEGORIES_WITH_A_CASE = new Set<string>();
for (const c of CASES) {
  for (const cat of require('../message-router').detectToolCategories(c.prompt)) {
    CATEGORIES_WITH_A_CASE.add(cat);
  }
}

describe('the ranking is actually wired into production', () => {
  it('message-router passes the message as the ranking query', () => {
    // Ranking that nothing calls is the defect this codebase keeps producing:
    // a capability that exists, is tested, and is never reached. Without
    // `query`, category tools fall back to registration order and every case
    // below passes here while failing in the app.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'message-router.ts'), 'utf-8');
    expect(src).toMatch(/getSmallModelTools\(\{[^}]*query:\s*message/);
  });
});

describe('the gate covers every category the router can produce', () => {
  it('has at least one case for each', () => {
    // Read the categories out of the router rather than keeping a second list
    // here: a list that must agree with the source and is never compared is
    // how this drifted in the first place.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'message-router.ts'), 'utf-8');
    const emitted = [...new Set(
      [...src.matchAll(/cats\.add\('([a-z]+)'\)/g)].map(m => m[1]),
    )].sort();

    // If this finds nothing the assertion below is checking nothing.
    expect(emitted.length).toBeGreaterThan(5);

    const uncovered = emitted.filter(c => !CATEGORIES_WITH_A_CASE.has(c));
    if (uncovered.length) {
      throw new Error(
        `No reachability case exercises: ${uncovered.join(', ')}.
` +
        `  A category with no case can be unreachable from chat and still pass this suite —
` +
        `  which is exactly what happened to 'media'. Add a plausible request for each.`,
      );
    }
  });
});

describe('a realistic request reaches a tool that can serve it', () => {
  it.each(CASES)('$prompt', ({ prompt, needsOneOf }) => {
    const offered = offeredFor(prompt);
    const hit = needsOneOf.filter(n => offered.includes(n));
    if (hit.length === 0) {
      // Name what WAS offered — the useful half of the failure message.
      throw new Error(
        `No tool from [${needsOneOf.join(', ')}] was offered.\n` +
        `  categories: ${JSON.stringify(detectToolCategories(prompt))}\n` +
        `  offered:    ${offered.join(', ')}`,
      );
    }
    expect(hit.length).toBeGreaterThan(0);
  });
});
