import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

// These are browser DOM controls for the shared readiness helper, not native
// HomeBot acceptance. No Electron, IPC replacement, filesystem or network use.
const shell = '<main data-testid="homebot-app-root" data-hydrated="true"></main>';
const composer = '<textarea aria-label="Message HomeBot">Keep this draft.</textarea>';
const wizard = '<div class="first-run-overlay"><section class="first-run-modal" role="dialog"><h1>Welcome to HomeBot</h1><button onclick="this.closest(\'.first-run-overlay\').remove()">Skip setup</button></section></div>';

test('visible onboarding is ready without dismissing it or requiring an enabled composer', async ({ page }) => {
  await page.setContent(`${shell}<textarea aria-label="Message HomeBot" disabled></textarea>${wizard}`);
  await waitForAppReady(page, { timeout: 5000 });
  await expect(page.getByRole('heading', { name: 'Welcome to HomeBot' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message HomeBot' })).toBeDisabled();
  expect(await dismissFirstRun(page)).toBe(true);
  await expect(page.locator('.first-run-overlay')).toHaveCount(0);
});

test('an editable composer is ready and its contents are preserved', async ({ page }) => {
  await page.setContent(`${shell}${composer}<div role="dialog" style="display:none">Hidden dialog</div>`);
  await waitForAppReady(page, { timeout: 5000 });
  await expect(page.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue('Keep this draft.');
});

test('an unhydrated shell cannot borrow readiness from existing reply or input anchors', async ({ page }) => {
  await page.setContent(`<main data-testid="homebot-app-root"></main><div data-role="assistant-message">Old reply</div>${composer}${wizard}`);
  await expect(waitForAppReady(page, { timeout: 750 })).rejects.toThrow(/Timeout|timed out/);
  await page.locator('[data-testid="homebot-app-root"]').evaluate(element => element.setAttribute('data-hydrated', 'true'));
  await waitForAppReady(page, { timeout: 5000 });
});

test('a visible unrelated fixed dialog blocks readiness even when onboarding is ready', async ({ page }) => {
  await page.setContent(`${shell}${composer}${wizard}<section role="dialog" aria-label="Unrelated blocker" style="position:fixed;inset:10px">Must be handled separately</section>`);
  await expect(page.getByRole('dialog', { name: 'Unrelated blocker' })).toBeVisible();
  await expect(waitForAppReady(page, { timeout: 750 })).rejects.toThrow(/Timeout|timed out/);
  await page.getByRole('dialog', { name: 'Unrelated blocker' }).evaluate(element => element.remove());
  await waitForAppReady(page, { timeout: 5000 });
  await expect(page.getByRole('heading', { name: 'Welcome to HomeBot' })).toBeVisible();
});

test('hidden onboarding and disabled or readonly inputs are not a ready surface', async ({ page }) => {
  await page.setContent(`${shell}<div style="display:none">${wizard}</div><textarea aria-label="Message HomeBot" disabled></textarea><input type="text" readonly><input type="text" style="visibility:hidden">`);
  await expect(waitForAppReady(page, { timeout: 750 })).rejects.toThrow(/Timeout|timed out/);
  await page.getByRole('textbox', { name: 'Message HomeBot' }).evaluate(element => (element as HTMLTextAreaElement).disabled = false);
  await waitForAppReady(page, { timeout: 5000 });
});

test('partial startup progress cannot restart the shared readiness deadline', async ({ page }) => {
  await page.setContent(`<main data-testid="homebot-app-root"></main>${composer}<section role="dialog" aria-label="Startup blocker">Still starting</section>`);
  await page.evaluate(() => {
    setTimeout(() => document.querySelector('[data-testid="homebot-app-root"]')!.setAttribute('data-hydrated', 'true'), 1500);
  });
  // Failure must arrive within the whole budget plus a generous host scheduling
  // allowance, rather than a fresh budget after hydration. No successful elapsed
  // threshold is asserted, and the blocker remains until this test removes it.
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      waitForAppReady(page, { timeout: 3000 }).then(() => 'ready', error => {
        expect(String(error)).toMatch(/Timeout|timed out/);
        return 'timeout';
      }),
      new Promise<string>(resolve => { watchdog = setTimeout(() => resolve('budget restarted'), 4000); }),
    ]);
    expect(outcome).toBe('timeout');
    await expect(page.locator('[data-testid="homebot-app-root"]')).toHaveAttribute('data-hydrated', 'true');
    await expect(page.getByRole('dialog', { name: 'Startup blocker' })).toBeVisible();
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
  await page.getByRole('dialog', { name: 'Startup blocker' }).evaluate(element => element.remove());
  await waitForAppReady(page, { timeout: 5000 });
});
