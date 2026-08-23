/**
 * n8n-webhook-check.ts — is the workflow a feature depends on actually there?
 *
 * HomeBot calls n8n webhooks for several features. When a workflow has never
 * been imported, n8n answers 404 and the calling feature quietly falls through
 * to a lesser path. That is what happens today with Google Calendar: every
 * startup logs
 *
 *   [Calendar] Google Calendar (n8n) unavailable: Request failed with status code 404
 *
 * and no user is ever told that the integration exists, is unconfigured, and
 * could be turned on. The feature is not broken — it is undeployed — but those
 * look identical from the outside, which is the actual problem.
 *
 * This matters more going forward than it did looking back: the Media Studio
 * plan adds five workflows. Five silent 404s would be indistinguishable from
 * five broken features.
 *
 * `listWorkflows()` cannot answer this — the n8n API returns id and name, not
 * webhook paths — so the check probes the endpoint itself, which is also
 * exactly what the calling feature does.
 */

import axios from 'axios';
import { getSettings } from './config-manager';
import { homebotWebhookHeaders } from './webhook-auth';

export type WebhookStatus =
  /** The workflow is registered and answered. */
  | 'available'
  /** n8n is up but has no workflow on that path — not imported, or inactive. */
  | 'not_deployed'
  /** n8n itself is unreachable, so nothing can be said about the workflow. */
  | 'n8n_unreachable'
  /** It answered, but with an error of its own — deployed and misbehaving. */
  | 'error';

export interface WebhookCheck {
  path: string;
  /** What stops working without it, in the user's terms. */
  powers: string;
  status: WebhookStatus;
  detail?: string;
}

/**
 * Webhooks HomeBot calls. `powers` is written for a person deciding whether
 * they care, not as an internal description.
 */
export const KNOWN_WEBHOOKS: Array<{ path: string; powers: string }> = [
  { path: 'homebot/calendar', powers: 'Google Calendar events in chat and the morning briefing' },
  { path: 'homebot/chat', powers: 'routing chat through an n8n workflow' },
  { path: 'homebot/media-research', powers: 'real sources for Media Studio scripts, instead of the model recalling facts' },
];

const PROBE_TIMEOUT_MS = 4000;

function baseUrl(): string {
  const { n8nUrl } = getSettings();
  return (n8nUrl || 'http://localhost:5678').replace(/\/$/, '');
}

/**
 * Probe one webhook.
 *
 * A 404 is the signal that matters and is treated as information rather than
 * failure. Any other answer — including a 500 — means something IS registered
 * on that path, which is a different problem with a different fix.
 */
export async function checkWebhook(path: string, powers = ''): Promise<WebhookCheck> {
  const url = `${baseUrl()}/webhook/${path.replace(/^\//, '')}`;
  try {
    const res = await axios.post(url, { action: 'ping' }, {
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
      // Without this the guard rejects the probe and a correctly-deployed
      // workflow is reported as broken.
      headers: homebotWebhookHeaders(),
    });
    if (res.status === 404) {
      return {
        path, powers, status: 'not_deployed',
        detail: 'No workflow is registered on this path in n8n. Import and activate it to enable this feature.',
      };
    }
    if (res.status >= 500) {
      return { path, powers, status: 'error', detail: `The workflow answered with HTTP ${res.status}.` };
    }
    return { path, powers, status: 'available' };
  } catch (e: any) {
    // Connection-level failure: n8n is down, so the workflow's own state is
    // unknown. Saying "not deployed" here would be a guess.
    return {
      path, powers, status: 'n8n_unreachable',
      detail: `Could not reach n8n at ${baseUrl()} (${e?.code || e?.message || 'no response'}).`,
    };
  }
}

export async function checkKnownWebhooks(): Promise<WebhookCheck[]> {
  return Promise.all(KNOWN_WEBHOOKS.map(w => checkWebhook(w.path, w.powers)));
}

/**
 * One line a person can act on, for chat replies and tool errors.
 * Deliberately never says "failed" for an undeployed workflow — it has not
 * failed, it was never installed.
 */
export function describeWebhookStatus(check: WebhookCheck): string {
  switch (check.status) {
    case 'available':
      return `Ready — ${check.powers}.`;
    case 'not_deployed':
      return `Not set up yet: ${check.powers} needs an n8n workflow on /webhook/${check.path}. Import and activate it in n8n to switch this on.`;
    case 'n8n_unreachable':
      return `n8n is not reachable, so ${check.powers} is unavailable. ${check.detail ?? ''}`.trim();
    case 'error':
      return `The n8n workflow for ${check.powers} is returning an error. ${check.detail ?? ''}`.trim();
  }
}
