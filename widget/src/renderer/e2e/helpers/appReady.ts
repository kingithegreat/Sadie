import type { Page } from '@playwright/test';

export async function waitForAppReady(page: Page, opts?: { timeout?: number }) {
  const timeout = opts?.timeout ?? 45000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('App readiness timeout must be positive.');
  const deadline = Date.now() + timeout;
  const remaining = () => {
    const milliseconds = deadline - Date.now();
    if (milliseconds <= 0) throw new Error('HomeBot app readiness timed out.');
    return milliseconds;
  };

  await page.waitForLoadState('domcontentloaded', { timeout: remaining() });

  // Readiness includes the wizard a fresh-profile caller will inspect or dismiss.
  // Completing onboarding is a separate user action, not a startup prerequisite.
  // Require hydration and a usable surface together, within one startup budget.
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('[data-testid="homebot-app-root"]');
    const hydrated = appRoot
      ? appRoot.getAttribute('data-hydrated') === 'true'
      : document.body?.hasAttribute('data-app-ready');
    if (!hydrated) return false;

    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && style.visibility !== 'collapse';
    };
    const blockers = document.querySelectorAll('.overlay, .modal, [role="dialog"], [data-testid="blocking-overlay"]');
    if (Array.from(blockers).some(element => !element.closest('.first-run-overlay') && visible(element))) return false;

    const wizard = document.querySelector('.first-run-overlay .first-run-modal');
    if (wizard && visible(wizard)) return true;

    const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLElement>(
      'textarea[aria-label="Message HomeBot"], textarea.input-field, textarea, input[type="text"], [contenteditable="true"]',
    );
    return Array.from(inputs).some(element => {
      const input = element as HTMLInputElement;
      return !input.disabled && !input.readOnly && visible(element);
    });
  }, null, { timeout: remaining() });
}

export default waitForAppReady;
