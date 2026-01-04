import { Page } from '@playwright/test';

export async function waitForAppReady(page: Page, timeout = 45_000) {
  // DOM loaded
  await page.waitForLoadState('domcontentloaded', { timeout });

  // Prefer explicit app-ready marker if the app sets it
  try {
    await page.waitForFunction(() => (window as any).__SADIE_APP_READY__ === true, { timeout });
    return;
  } catch (e) {
    // fall through to DOM checks
  }

  // Wait for main app root
  await page.waitForSelector('[data-testid="sadie-app-root"]', { state: 'visible', timeout });

  // Ensure no blocking overlay exists
  await page.waitForFunction(() => {
    const blockers = Array.from(document.querySelectorAll('.overlay, .modal, [role="dialog"]'));
    return blockers.every((e: Element) => (e as HTMLElement).offsetParent === null);
  }, { timeout });

  // Ensure chat input is interactive (attempt common selectors)
  await page.waitForFunction(() => {
    const candidates = [
      'textarea.input-field',
      'input[data-testid="chat-input"]',
      'textarea[data-testid="chat-input"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) return !el.disabled && !el.readOnly;
    }
    return false;
  }, { timeout });
}
