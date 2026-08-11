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
];

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
