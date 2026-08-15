import type { Page } from '@playwright/test';

/**
 * Get past the first-run modal, deterministically.
 *
 * Every spec that drives the app on a fresh profile has to do this, and getting
 * it subtly wrong is how the e2e gate ended up red for 28 consecutive runs.
 *
 * Two failure modes, both seen in CI:
 *
 *   1. Not handling it at all. document-summary.e2e.spec.ts filled the composer
 *      and clicked Send with the overlay still up, so the click waited for an
 *      element it could never reach and died at 30s. It passed on a developer
 *      machine only because that profile already had firstRun:false saved —
 *      the test was describing one computer, not the product.
 *
 *   2. Handling it with a race:
 *
 *        if (await skip.count()) { await skip.click(); }
 *
 *      `count()` is a single instantaneous poll. On a slower runner the overlay
 *      has not mounted yet, the count is 0, dismissal is skipped — and then it
 *      appears and blocks everything after it. That is why the same commit
 *      passed one CI run and timed out at 60s in another.
 *
 * So: wait for it to appear, and only conclude it is absent after a real
 * timeout. Then wait for it to actually leave, rather than assuming the click
 * took effect.
 */
export async function dismissFirstRun(page: Page, timeoutMs = 8000): Promise<boolean> {
  const skip = page.getByRole('button', { name: /Skip setup/i });
  try {
    await skip.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    // Genuinely absent — a profile that has already been through onboarding.
    return false;
  }

  await skip.click();
  // Confirm it is gone. A click that silently did nothing would otherwise leave
  // the next action to fail somewhere far away from the real cause.
  await page.locator('.first-run-overlay').waitFor({ state: 'detached', timeout: timeoutMs });
  return true;
}
