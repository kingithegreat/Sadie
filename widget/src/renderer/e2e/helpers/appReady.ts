import type { Page } from '@playwright/test';

export async function waitForAppReady(page: Page, opts?: { timeout?: number }) {
  const timeout = opts?.timeout ?? 45000;

  // Wait for initial DOM load
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});

  // Wait for a known visible app anchor or a body readiness attribute.
  await page.waitForFunction(() => {
    try {
      if (document.body && document.body.hasAttribute && document.body.hasAttribute('data-app-ready')) return true;
      const anchors = ['[data-testid="sadie-app-root"]', '[data-testid="main-app-root"]', '[data-role="assistant-message"]'];
      return anchors.some(s => Boolean(document.querySelector(s)));
    } catch (e) {
      return false;
    }
  }, null, { timeout }).catch(() => {});

  // Ensure no blocking overlay/dialog is visible
  await page.waitForFunction(() => {
    try {
      const blockers = document.querySelectorAll('.overlay, .modal, [role="dialog"], [data-testid="blocking-overlay"]');
      return Array.from(blockers).every((e) => {
        // offsetParent is null for display:none or not rendered elements
        // getClientRects length is 0 if not visible
        try { return e.offsetParent === null || e.getClientRects().length === 0; } catch (err) { return true; }
      });
    } catch (e) {
      return true;
    }
  }, null, { timeout }).catch(() => {});

  // Ensure there is an editable input field available
  await page.waitForFunction(() => {
    try {
      const selectors = [
        'textarea[aria-label="Message SADIE"]',
        'textarea.input-field',
        'textarea',
        'input[type="text"]',
        '[contenteditable="true"]'
      ];
      for (const s of selectors) {
        const el = document.querySelector(s) as HTMLInputElement | HTMLElement | null;
        if (!el) continue;
        const disabled = (el as any).disabled === true;
        const readOnly = (el as any).readOnly === true;
        const rects = (el as any).getClientRects ? (el as any).getClientRects().length : 1;
        if (!disabled && !readOnly && rects > 0) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }, null, { timeout }).catch(() => {});
}

export default waitForAppReady;
