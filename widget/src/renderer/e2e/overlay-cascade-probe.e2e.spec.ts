/**
 * Which rule actually wins for out-of-flow children of .app-container?
 *
 * .app-container is a grid. Any real child consumes a row, so overlays have to
 * be taken out of flow or they shift every row below them (see 848f519 —
 * toasts pushed the header into the 1fr track and it measured 451px).
 *
 * The blanket rule at chatgpt-theme.css:175
 *
 *   .app-container > *:not(.app-header):not(.widget-titlebar)... { position: relative }
 *
 * carries nine :not() clauses. Each contributes the specificity of its
 * argument, so the selector is (0,10,0) — far above a plain
 * `.app-container > .toast-container` at (0,2,0). Reasoning says the blanket
 * rule wins and any such fix is inert; reasoning about the cascade is exactly
 * what put the bug there. So measure it.
 *
 * Diagnostic, not an assertion.
 */

import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `homebot-cascade-${Date.now()}`);
  fs.mkdirSync(path.join(base, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(base, 'config', 'user-settings.json'),
    JSON.stringify({ firstRun: false, telemetryEnabled: false, theme: 'dark' }, null, 2),
    'utf-8',
  );
  return base;
}

/**
 * Probe the cascade by inserting a bare element of each class into
 * .app-container and reading what the stylesheet resolves it to. This asks the
 * engine rather than the author which rule won.
 */
const PROBE = `(() => {
  const app = document.querySelector('.app-container');
  if (!app) return 'no .app-container';
  const out = [];

  const probe = (cls) => {
    const existing = document.querySelector('.' + cls);
    const el = existing || document.createElement('div');
    if (!existing) { el.className = cls; app.appendChild(el); }
    const cs = getComputedStyle(el);
    out.push(
      ('.' + cls).padEnd(28) +
      ' position=' + cs.position.padEnd(9) +
      ' display=' + cs.display.padEnd(7) +
      ' zIndex=' + String(cs.zIndex).padEnd(5) +
      (existing ? '  (real element)' : '  (synthetic)')
    );
    if (!existing) el.remove();
  };

  probe('toast-container');
  probe('floating-feature-buttons');

  // Geometry, to place the floating buttons from data rather than by guessing
  // an offset that happens to clear the composer at one window size.
  out.push('');
  for (const sel of ['.chat-interface', '.input-container', '.floating-feature-buttons', '.fab-voice', '.fab-capture']) {
    const el = document.querySelector(sel);
    if (!el) { out.push(sel.padEnd(28) + ' (absent)'); continue; }
    const r = el.getBoundingClientRect();
    out.push(
      sel.padEnd(28) +
      ' top=' + String(Math.round(r.top)).padStart(4) +
      ' bottom=' + String(Math.round(r.bottom)).padStart(4) +
      ' h=' + String(Math.round(r.height)).padStart(4) +
      ' right=' + String(Math.round(r.right)).padStart(4)
    );
  }
  out.push('viewport h=' + window.innerHeight + ' w=' + window.innerWidth);

  // How many rows does the grid template define, and how many children are in flow?
  const cs = getComputedStyle(app);
  out.push('');
  out.push('grid-template-rows: ' + cs.gridTemplateRows);
  out.push('children in flow: ' + Array.from(app.children).filter((c) => {
    const p = getComputedStyle(c).position;
    return p !== 'absolute' && p !== 'fixed';
  }).map((c) => (c.className || c.tagName).toString().split(' ')[0]).join(', '));

  return out.join('\\n');
})()`;

test('what the cascade resolves for out-of-flow app-container children', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchElectronApp(
    { HOMEBOT_E2E: '1', NODE_ENV: 'test' }, makeTempProfile(),
  );
  await waitForAppReady(page);

  const result = await page.evaluate(PROBE);
  // eslint-disable-next-line no-console
  console.log('\n===== CASCADE =====\n' + result + '\n===================\n');

  await app.close();
});
