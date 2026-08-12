/**
 * Modals must sit above the app header.
 *
 * A "Safety & Debugging Helpers" block clamped five overlays to
 * `z-index: 200 !important` to keep them below onboarding. But .app-header is
 * 300, so the clamp put every modal UNDER the header instead. The header then
 * covered the top strip of each one:
 *
 *   - the Settings dialog's ✕ could not be clicked at all. It rendered,
 *     reported visible and enabled, and elementFromPoint at its centre
 *     returned .app-header. Escape or a click outside were the only ways out.
 *   - .confirmation-overlay — the dialog that authorises tool calls, designed
 *     at 1000 — was dragged down with it.
 *
 * Two e2e tests had been failing on this the whole time, unseen: the CI job
 * that runs them died in setup before reaching a test.
 *
 * This asserts the ORDER rather than the numbers, so restyling stays free and
 * only the relationship is pinned.
 */

import * as fs from 'fs';
import * as path from 'path';

// Comments are stripped first: a rule is usually preceded by one, and the
// selector capture below would otherwise swallow it and match nothing.
const css = fs
  .readFileSync(path.resolve(__dirname, '..', 'styles', 'chatgpt-theme.css'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every z-index declared for a selector, in source order. Later wins for equal
 * specificity, and `!important` beats anything without it — which is exactly
 * how the clamp defeated the component's own value.
 */
function zIndexesFor(selector: string): Array<{ value: number; important: boolean }> {
  const out: Array<{ value: number; important: boolean }> = [];
  // Match a rule whose selector list contains this selector as a whole token.
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css))) {
    const selectors = m[1].split(',').map(s => s.replace(/\s+/g, ' ').trim());
    if (!selectors.includes(selector)) continue;
    const z = /(?:^|;)\s*z-index\s*:\s*(-?\d+)\s*(!important)?/m.exec(m[2]);
    if (z) out.push({ value: Number(z[1]), important: !!z[2] });
  }
  return out;
}

/** What the browser would actually use: an !important wins, else the last one. */
function effectiveZ(selector: string): number {
  const all = zIndexesFor(selector);
  if (!all.length) throw new Error(`No z-index found for ${selector} — has it been renamed?`);
  const important = all.filter(z => z.important);
  return (important.length ? important : all).slice(-1)[0].value;
}

describe('overlay layering', () => {
  it.each([
    ['.settings-overlay'],
    ['.confirmation-overlay'],
  ])('%s sits above the app header, so its controls can be clicked', (selector) => {
    expect(effectiveZ(selector)).toBeGreaterThan(effectiveZ('.app-header'));
  });

  it('modals stay below onboarding, which is the point of the clamp', () => {
    const onboarding = effectiveZ('.first-run-overlay');
    expect(effectiveZ('.settings-overlay')).toBeLessThan(onboarding);
    expect(effectiveZ('.confirmation-overlay')).toBeLessThan(onboarding);
  });

  it('the header still sits above the ordinary page', () => {
    // The header being high is not itself the bug — modals being lower was.
    expect(effectiveZ('.app-header')).toBeGreaterThan(1);
  });
});
