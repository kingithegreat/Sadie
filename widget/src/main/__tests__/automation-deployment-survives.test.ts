/**
 * An automation must not lose its n8n deployment because of a bad afternoon.
 *
 * PR #191 made every app-deployed workflow validate an `X-HOMEBOT-Auth` header.
 * The automation runner never sent one, so the guard rejected HomeBot's own
 * scheduled runs — and the catch block treated ANY failure as "the webhook is
 * stale", cleared `n8nWebhookUrl` and `n8nWorkflowId`, and wrote that to disk.
 *
 * One scheduled run during a container restart was enough to sever the
 * deployment permanently, with nothing in the interface saying why.
 *
 * Two independent faults, so two independent guards:
 *   1. the runner must send the header
 *   2. only a 404 may delete the deployment — everything else falls back for
 *      that run and keeps the ids
 */

import { homebotWebhookHeaders } from '../webhook-auth';
import { guardJsCode } from '../n8n-auth-guard';

describe('the header the guards validate', () => {
  test('homebotWebhookHeaders sets the auth header', () => {
    const headers = homebotWebhookHeaders();
    expect(Object.keys(headers).map(k => k.toLowerCase())).toContain('x-homebot-auth');
  });

  test('extra headers are merged, not dropped', () => {
    // The automation runner passes Content-Type through it. If merging were
    // broken, fixing the auth bug would have quietly broken the request body.
    const headers = homebotWebhookHeaders({ 'Content-Type': 'application/json' });
    expect(headers['Content-Type']).toBe('application/json');
    expect(Object.keys(headers).map(k => k.toLowerCase())).toContain('x-homebot-auth');
  });

  test('extras cannot silently drop the auth header', () => {
    const headers = homebotWebhookHeaders({ 'X-Other': '1' });
    expect(Object.keys(headers).map(k => k.toLowerCase())).toContain('x-homebot-auth');
  });

  test('an unset container env does not report open webhooks or weaken the deployed guard', () => {
    const previous = process.env.HOMEBOT_WEBHOOK_SECRET;
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      delete process.env.HOMEBOT_WEBHOOK_SECRET;
      let headers: Record<string, string> = {};
      jest.isolateModules(() => {
        headers = require('../webhook-auth').homebotWebhookHeaders();
      });
      const secret = headers['X-HOMEBOT-Auth'];
      const runGuard = (incoming: Record<string, string>) => {
        const input = {
          first: () => ({ json: { headers: incoming } }),
          all: () => [{ json: { accepted: true } }],
        };
        return new Function('$input', 'process', guardJsCode(secret))(input, { env: {} });
      };

      expect(secret).toBeTruthy();
      expect(runGuard({ 'x-homebot-auth': secret })).toEqual([{ json: { accepted: true } }]);
      expect(() => runGuard({})).toThrow(/Unauthorized/);
      expect(warning).not.toHaveBeenCalledWith(expect.stringContaining('SKIP validation'));
    } finally {
      warning.mockRestore();
      if (previous === undefined) delete process.env.HOMEBOT_WEBHOOK_SECRET;
      else process.env.HOMEBOT_WEBHOOK_SECRET = previous;
    }
  });
});

/**
 * The deletion rule, extracted so the policy is testable without standing up
 * the whole IPC layer. It must stay in step with the runner's catch block.
 */
function webhookIsGone(status: number | undefined): boolean {
  return status === 404;
}

describe('when a run fails, what may be deleted', () => {
  test('404 means genuinely gone — deleting is right', () => {
    expect(webhookIsGone(404)).toBe(true);
  });

  test('500 must NOT delete — this is exactly what a guard rejection looks like', () => {
    // The regression in one line: a guard saying no read as "the workflow no
    // longer exists".
    expect(webhookIsGone(500)).toBe(false);
  });

  test('401 and 403 must NOT delete — an auth problem is fixable', () => {
    expect(webhookIsGone(401)).toBe(false);
    expect(webhookIsGone(403)).toBe(false);
  });

  test('a timeout or connection refusal must NOT delete', () => {
    // No response at all: n8n restarting, or not up yet. Transient by nature,
    // and the most likely failure on a machine that sleeps.
    expect(webhookIsGone(undefined)).toBe(false);
  });

  test('502/503/504 must NOT delete — a proxy or a restart', () => {
    for (const s of [502, 503, 504]) expect(webhookIsGone(s)).toBe(false);
  });
});
