/**
 * "Not set up yet" and "broken" must not look the same.
 *
 * HomeBot's Google Calendar integration calls an n8n webhook that was never
 * imported. n8n answers 404, the calendar falls back to local events, and the
 * only trace is a console line — in a console that installConsoleGate silences
 * in packaged builds. On the dev machine it printed on every single startup:
 *
 *   [Calendar] Google Calendar (n8n) unavailable: Request failed with status code 404
 *
 * Nothing was broken. The workflow was simply never installed, and no user was
 * ever told the integration exists and could be switched on.
 *
 * This matters more ahead than behind: the Media Studio plan adds five
 * workflows, and five silent 404s would be indistinguishable from five broken
 * features.
 */

jest.mock('axios');
jest.mock('../config-manager', () => ({
  ...jest.requireActual('../config-manager'),
  getSettings: jest.fn(() => ({ n8nUrl: 'http://localhost:5678' })),
}));

import axios from 'axios';
import {
  checkWebhook,
  checkKnownWebhooks,
  describeWebhookStatus,
  KNOWN_WEBHOOKS,
} from '../n8n-webhook-check';

const post = axios.post as jest.Mock;
beforeEach(() => post.mockReset());

describe('classifying what a webhook probe means', () => {
  it('404 means not deployed, not failed', () => {
    post.mockResolvedValue({ status: 404 });
    return checkWebhook('homebot/calendar', 'calendar events').then(res => {
      expect(res.status).toBe('not_deployed');
      // The wording must not accuse the feature of failing.
      expect(describeWebhookStatus(res)).toMatch(/not set up/i);
      expect(describeWebhookStatus(res)).not.toMatch(/fail/i);
    });
  });

  it('a 2xx means the workflow is there', async () => {
    post.mockResolvedValue({ status: 200 });
    const res = await checkWebhook('homebot/calendar', 'calendar events');
    expect(res.status).toBe('available');
    expect(describeWebhookStatus(res)).toMatch(/ready/i);
  });

  it('a 5xx means deployed and misbehaving — a different problem', async () => {
    post.mockResolvedValue({ status: 500 });
    const res = await checkWebhook('homebot/calendar', 'calendar events');
    expect(res.status).toBe('error');
    expect(describeWebhookStatus(res)).toMatch(/error/i);
  });

  it('a connection failure does not claim the workflow is missing', async () => {
    // n8n being down says nothing about whether the workflow exists, and
    // guessing "not deployed" would send someone to import a workflow they
    // already have.
    post.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const res = await checkWebhook('homebot/calendar', 'calendar events');
    expect(res.status).toBe('n8n_unreachable');
    expect(describeWebhookStatus(res)).toMatch(/not reachable/i);
    expect(describeWebhookStatus(res)).not.toMatch(/not set up/i);
  });

  it('never throws — a probe failure must not take diagnostics down', async () => {
    post.mockRejectedValue(new Error('anything at all'));
    await expect(checkWebhook('homebot/calendar')).resolves.toBeDefined();
  });
});

describe('the registry', () => {
  it('covers the calendar webhook that prompted this', () => {
    expect(KNOWN_WEBHOOKS.map(w => w.path)).toContain('homebot/calendar');
  });

  it('describes each webhook by what it powers, in a user\'s terms', () => {
    for (const w of KNOWN_WEBHOOKS) {
      expect(w.powers.length).toBeGreaterThan(10);
      // "powers" is read by a person deciding whether they care; a path
      // repeated back as its own description helps nobody.
      expect(w.powers).not.toContain('webhook/');
    }
  });

  it('checks every registered webhook', async () => {
    post.mockResolvedValue({ status: 404 });
    const all = await checkKnownWebhooks();
    expect(all).toHaveLength(KNOWN_WEBHOOKS.length);
    expect(all.every(c => c.status === 'not_deployed')).toBe(true);
  });
});
