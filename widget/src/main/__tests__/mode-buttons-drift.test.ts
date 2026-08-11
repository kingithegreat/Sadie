/**
 * The e2e suite went red for months because one locator outlived its button.
 *
 * mode-switching.e2e.spec.ts clicked a "Web" mode button. Web mode was removed
 * with the Web Services panel, so the locator could never resolve — Playwright
 * spent 30s timing out, three retries deep, across a 9-way OS/shard matrix.
 * Nothing else was wrong. Because e2e is not a required check, nobody was
 * blocked, so the red simply became the background.
 *
 * A Playwright timeout is an expensive and slow way to discover that a string
 * in a spec no longer matches the UI. This is the cheap version: it reads both
 * files and fails in milliseconds if the e2e spec references a mode the app
 * does not render.
 *
 * It deliberately does NOT require every mode to be exercised — that would make
 * adding a mode a two-file chore. It only catches the failure that actually
 * happened: a spec pointing at something that no longer exists.
 */

import * as fs from 'fs';
import * as path from 'path';

const renderer = path.resolve(__dirname, '..', '..', 'renderer');
const statusSrc = fs.readFileSync(
  path.join(renderer, 'components', 'StatusIndicator.tsx'), 'utf-8');
const specSrc = fs.readFileSync(
  path.join(renderer, 'e2e', 'mode-switching.e2e.spec.ts'), 'utf-8');

/** Visible labels of the real mode buttons, e.g. "Home", "Chat", "Docs". */
function renderedModeLabels(): string[] {
  const labels: string[] = [];
  // Take the whole element first — the tag carries onClick and title
  // attributes between the className and the visible text, so a single
  // greedy capture picks those up as if they were the label.
  const buttons = statusSrc.match(/<button className=\{`mode-btn[\s\S]*?<\/button>/g) || [];
  for (const btn of buttons) {
    // Exclude '>' from the capture. The onClick arrow (`() =>`) contains one,
    // so a capture that allows '>' starts matching there and swallows the
    // handler and title as if they were the label.
    const text = />([^<>]*)<\/button>/.exec(btn)?.[1] ?? '';
    // Drop the leading emoji, keep the word: "📊 Home" → "Home".
    const label = text.replace(/[^\x20-\x7E]/g, '').trim();
    if (label) labels.push(label);
  }
  return labels;
}

/** Mode names the e2e spec clicks, from its hasText locators. */
function specModeTargets(): string[] {
  const targets: string[] = [];
  const re = /button\.mode-btn'\s*,\s*\{\s*hasText:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(specSrc))) targets.push(m[1]);
  return targets;
}

describe('e2e mode locators match the rendered buttons', () => {
  it('finds the real mode buttons', () => {
    const labels = renderedModeLabels();
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(labels).toContain('Chat');
  });

  it('finds the locators the e2e spec uses', () => {
    expect(specModeTargets().length).toBeGreaterThanOrEqual(3);
  });

  it('every mode the spec clicks still exists in the UI', () => {
    const labels = renderedModeLabels();
    const missing = specModeTargets().filter(
      t => !labels.some(l => l.includes(t)),
    );
    // Name the offender: "Web" is what this would have said for months.
    expect(missing).toEqual([]);
  });
});
