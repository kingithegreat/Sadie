/**
 * The Auth Guard must refuse when it has no secret.
 *
 * The guard shipped as:
 *
 *     const secret = process.env.HOMEBOT_WEBHOOK_SECRET;
 *     if (secret) { ...compare header... }
 *     return $input.all();
 *
 * and n8n 1.122.5 gives Code nodes an EMPTY `process.env` regardless of
 * `N8N_BLOCK_ENV_ACCESS_IN_NODE` — verified 2026-08-22. So the comparison was
 * skipped and every guarded webhook accepted anything, across thirteen shipped
 * workflow files. The code read as though it were protecting them.
 *
 * `if (secret)` is the whole bug: an absent secret meant "skip the check"
 * where it has to mean "refuse". These run the generated guard body to prove
 * the new one refuses, rather than asserting on the string.
 */

import { guardJsCode, placeholderGuardJsCode } from '../n8n-auth-guard';

/**
 * Execute a guard body the way an n8n Code node would.
 *
 * Running it is the point. A test that greps the generated source for
 * "throw new Error" would have passed against the broken version too, since
 * the throw was there — just unreachable.
 */
function runGuard(js: string, headers: Record<string, string>, env: Record<string, string> = {}) {
  const $input = {
    first: () => ({ json: { headers } }),
    all: () => [{ json: { ok: true } }],
  };
  const fn = new Function('$input', 'process', `${js}`);
  return fn($input, { env });
}

const SECRET = 'per-install-secret-abc123';

describe('a deployed guard, with the secret embedded', () => {
  test('accepts the correct header', () => {
    const result = runGuard(guardJsCode(SECRET), { 'x-homebot-auth': SECRET });
    expect(result).toEqual([{ json: { ok: true } }]);
  });

  test('accepts the capitalised header spelling too', () => {
    // n8n has handed through both spellings depending on the proxy in front.
    const result = runGuard(guardJsCode(SECRET), { 'X-HOMEBOT-Auth': SECRET });
    expect(result).toEqual([{ json: { ok: true } }]);
  });

  test('refuses a wrong secret', () => {
    expect(() => runGuard(guardJsCode(SECRET), { 'x-homebot-auth': 'wrong' })).toThrow(/Unauthorized/);
  });

  test('refuses a missing header', () => {
    expect(() => runGuard(guardJsCode(SECRET), {})).toThrow(/Unauthorized/);
  });
});

describe('the shipped placeholder guard', () => {
  test('REFUSES when no secret was ever injected — the whole point', () => {
    // Previously this returned $input.all() and the webhook ran. A hand-imported
    // workflow was an open endpoint running file and browser automation.
    expect(() => runGuard(placeholderGuardJsCode(), { 'x-homebot-auth': 'anything' }))
      .toThrow(/no HomeBot secret/i);
  });

  test('refuses even with no header at all', () => {
    expect(() => runGuard(placeholderGuardJsCode(), {})).toThrow(/Unauthorized/);
  });

  test('the message says what to do about it', () => {
    // "Unauthorized" alone would send someone hunting for a header to add.
    // The fix is to deploy from HomeBot, so the error says that.
    expect(() => runGuard(placeholderGuardJsCode(), {})).toThrow(/Deploy it from HomeBot/i);
  });

  test('an empty environment cannot rescue it — that was the old bug', () => {
    expect(() => runGuard(placeholderGuardJsCode(), { 'x-homebot-auth': 'x' }, {}))
      .toThrow(/Unauthorized/);
  });
});

describe('the marker that lets HomeBot upgrade an existing guard', () => {
  test('both variants carry it, so injection replaces rather than duplicates', () => {
    // injectAuthGuards finds guards by this marker. Without it, deploying over
    // a hand-imported workflow would add a SECOND guard node.
    expect(guardJsCode(SECRET)).toContain("hdrs['x-homebot-auth']");
    expect(placeholderGuardJsCode()).toContain("hdrs['x-homebot-auth']");
  });
});
