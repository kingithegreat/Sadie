/**
 * The research workflow, against a real n8n.
 *
 * OPT-IN. Skipped unless HOMEBOT_LIVE=1 and n8n is running:
 *
 *   docker compose up -d n8n
 *   cd widget && npx cross-env HOMEBOT_LIVE=1 npx jest n8n-media-research.live
 *
 * Everything else about this feature is tested with the webhook mocked, which
 * proves the fallback logic and nothing about whether the workflow actually
 * works. n8n Code nodes are strings inside a JSON document: nothing
 * type-checks them, and nothing runs them until they are deployed. The first
 * live run of this pipeline found that every citation came back as a
 * DuckDuckGo redirect wrapper rather than the page it pointed at — a defect no
 * mock could have surfaced, because the mock returned what we expected.
 *
 * So this covers the one link the unit tests cannot: deploy -> webhook
 * registered -> real search -> usable sources.
 */

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

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

import axios from 'axios';
import { ensureMediaResearchWorkflow } from '../n8n-api';
import { checkWebhook } from '../n8n-webhook-check';
import { MEDIA_RESEARCH_PATH } from '../n8n-media-workflows';

jest.setTimeout(180_000);

maybe('the research workflow, deployed for real', () => {
  let available = false;

  it('never claims to have deployed something that does not answer', async () => {
    // The invariant that matters, and the one that was broken: deploy used to
    // return deployed:true after an import whose activation had failed, so the
    // feature looked installed and silently never ran. Whatever the outcome,
    // "deployed" and "the webhook answers" must agree.
    const res = await ensureMediaResearchWorkflow();
    const check = await checkWebhook(MEDIA_RESEARCH_PATH, 'research');
    available = check.status === 'available';

    expect(res.deployed).toBe(available);

    if (!res.deployed) {
      // A refusal has to tell the user what would fix it, or it reads as a
      // broken feature rather than an unfinished setup.
      expect(res.reason && res.reason.length).toBeGreaterThan(20);
      expect(res.reason).toMatch(/api key|active|reach/i);
      console.log('[live] not deployed —', res.reason);
    }
  });

  it('returns sources that are real, openable pages', async () => {
    if (!available) {
      // Not a pass disguised as a skip: the check above already asserted that
      // this state is reported honestly. n8n cannot activate a workflow from
      // the CLI, so serving requires an API key or a manual toggle.
      console.log('[live] webhook not active — skipping the search assertions');
      return;
    }
    const res = await axios.post(
      `http://localhost:5678/webhook/${MEDIA_RESEARCH_PATH}`,
      { topic: 'Book of Jonah Hebrew Bible' },
      { timeout: 60_000, validateStatus: () => true },
    );
    expect(res.status).toBe(200);

    const data: any = Array.isArray(res.data) ? res.data[0] : res.data;
    expect(String(data?.text || '').length).toBeGreaterThan(100);
    expect(Array.isArray(data?.sources) && data.sources.length).toBeTruthy();

    // The point of collecting sources is that a human approving a script can
    // follow one. A redirect wrapper is not followable.
    for (const s of data.sources) {
      expect(s.url).toMatch(/^https?:\/\//);
      expect(s.url).not.toContain('duckduckgo.com/l/');
    }
  });

  it('falls back to the model rather than blocking a video', async () => {
    // The consequence that actually matters for the user: with the workflow
    // unavailable, research must still produce something.
    const { generateResearch } = await import('../media-generate');
    const { createJob } = await import('../media-studio');
    const job = createJob({ title: 'One-Minute Bible: Jonah', brief: 'the storm' });
    const out = await generateResearch(job).catch((e) => ({ text: '', via: `error: ${e.message}` }));
    // Either path is acceptable; silence is not.
    expect(out.via).not.toMatch(/^error:/);
    expect(out.text.trim().length).toBeGreaterThan(0);
  });
});
