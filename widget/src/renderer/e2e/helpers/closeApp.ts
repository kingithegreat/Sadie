import type { ElectronApplication } from '@playwright/test';

/**
 * Close the app under test without letting a slow shutdown fail the test.
 *
 * `overlay.e2e`'s right-click test failed the required `widget` check on four
 * unrelated PRs (#263, #303, #343, #362). The trace from #362 shows every
 * assertion in it PASSING at 5.7s, then `app.close()` never returning: the
 * 60s timeout was spent in teardown, after the test had already proved its
 * point. The test name blamed the context menu; the menu was fine.
 *
 * So teardown gets a budget of its own. A close that overruns is killed and
 * reported on stdout rather than failing a test that passed — and shutdown is
 * covered directly by "the app shuts down when it is asked to" in
 * overlay.e2e.spec.ts, so a genuine regression has one honest place to fail
 * instead of landing on whichever test happened to run.
 */
export const CLOSE_BUDGET_MS = 20_000;

export async function closeElectronApp(app: ElectronApplication, label = 'app'): Promise<number> {
  const started = Date.now();
  // Take the handle first: after close(), app.process() throws on the freed object.
  const child = app.process();
  let timer: NodeJS.Timeout | undefined;
  const overran = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), CLOSE_BUDGET_MS); });
  try {
    const outcome = await Promise.race([app.close().then(() => 'closed' as const), overran]);
    const elapsed = Date.now() - started;
    if (outcome === 'timeout') {
      console.warn(`[E2E-CLOSE] ${label} did not exit within ${CLOSE_BUDGET_MS}ms — killing it. See helpers/closeApp.ts.`);
      try { child.kill(); } catch { /* already gone */ }
    }
    return elapsed;
  } finally {
    clearTimeout(timer);
  }
}
