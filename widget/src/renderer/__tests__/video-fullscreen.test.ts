/**
 * The rendered video has to actually fill the screen when you fullscreen it.
 *
 * `.ms-video` is capped at `max-height: 15rem` so a 1080x1920 short does not
 * push every other job off the Media Studio list. That cap is an AUTHOR rule,
 * and the width/height:100% a browser applies to a fullscreen element comes
 * from its UA stylesheet — author beats UA, so the cap kept winning. Pressing
 * fullscreen left the video a 15rem letterbox floating in a black screen,
 * which reads as "the button does nothing".
 *
 * Reported from real use: "i couldnt make it full screen".
 *
 * Asserted against the stylesheet rather than a rendered browser because jsdom
 * implements neither the Fullscreen API nor the :fullscreen pseudo-class, so a
 * render test here would pass whether or not the rule existed.
 */

import * as fs from 'fs';
import * as path from 'path';

// Comments stripped first — a rule is usually preceded by one, and the
// selector capture would otherwise swallow it and match nothing.
const css = fs
  .readFileSync(path.resolve(__dirname, '..', 'styles', 'chatgpt-theme.css'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block for a rule whose selector list contains `selector`. */
function declarationsFor(selector: string): string | null {
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let found: string | null = null;
  while ((m = ruleRe.exec(css))) {
    const selectors = m[1].split(',').map(s => s.replace(/\s+/g, ' ').trim());
    if (selectors.includes(selector)) found = m[2];   // last one wins, as in CSS
  }
  return found;
}

function valueOf(block: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm');
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

describe('Media Studio video fullscreen', () => {
  // Guards the guard: if .ms-video is ever renamed, every assertion below would
  // silently pass on `null` instead of failing. A filter that matches nothing
  // is indistinguishable from a clean pass.
  test('the preview rule still exists and still caps the height', () => {
    const preview = declarationsFor('.ms-video');
    expect(preview).not.toBeNull();
    expect(valueOf(preview!, 'max-height')).toBe('15rem');
  });

  it.each([
    ['.ms-video:fullscreen'],
    ['.ms-video:-webkit-full-screen'],
  ])('%s lifts the preview caps', (selector) => {
    const block = declarationsFor(selector);
    expect(block).not.toBeNull();

    // Both caps must be released, or the UA's 100% cannot take effect.
    expect(valueOf(block!, 'max-height')).toBe('none');
    expect(valueOf(block!, 'max-width')).toBe('none');
    expect(valueOf(block!, 'width')).toBe('100%');
    expect(valueOf(block!, 'height')).toBe('100%');
  });

  test('the fullscreen rules come AFTER the preview rule, so they win', () => {
    const previewAt = css.indexOf('.ms-video {');
    const fullscreenAt = css.indexOf('.ms-video:fullscreen');
    expect(previewAt).toBeGreaterThan(-1);
    expect(fullscreenAt).toBeGreaterThan(previewAt);
  });

  test('the two fullscreen selectors are separate rules, not one list', () => {
    // A selector list is dropped WHOLE by a browser that does not understand
    // one of its selectors. Combined with a comma, an engine lacking
    // :-webkit-full-screen would discard the standard :fullscreen rule too.
    expect(css).not.toMatch(/\.ms-video:fullscreen\s*,\s*\.ms-video:-webkit-full-screen/);
    expect(css).not.toMatch(/\.ms-video:-webkit-full-screen\s*,\s*\.ms-video:fullscreen/);
  });
});
