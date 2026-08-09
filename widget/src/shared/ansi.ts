/**
 * Minimal ANSI SGR parser for rendering terminal output in the renderer.
 *
 * Scope is deliberately narrow: colour and text styling (SGR), which is what
 * build tools, test runners and package managers actually emit. Cursor
 * movement, screen erase and OSC sequences are stripped rather than
 * interpreted — a full terminal emulator is a different job (see xterm.js +
 * node-pty), and this keeps the panel dependency-free.
 *
 * Pure and stream-friendly: styling state can span chunk boundaries, so
 * parseAnsiChunk() takes the previous state and returns the next one.
 */

export interface AnsiStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface AnsiSegment extends AnsiStyle {
  text: string;
}

/** Standard 16 colours as CSS variables so the panel follows the app theme. */
const BASE_COLORS = [
  'var(--ansi-black, #3b4048)',
  'var(--ansi-red, #e06c75)',
  'var(--ansi-green, #98c379)',
  'var(--ansi-yellow, #e5c07b)',
  'var(--ansi-blue, #61afef)',
  'var(--ansi-magenta, #c678dd)',
  'var(--ansi-cyan, #56b6c2)',
  'var(--ansi-white, #abb2bf)',
];
const BRIGHT_COLORS = [
  'var(--ansi-bright-black, #5c6370)',
  'var(--ansi-bright-red, #ff7b86)',
  'var(--ansi-bright-green, #b5e890)',
  'var(--ansi-bright-yellow, #ffd68a)',
  'var(--ansi-bright-blue, #7cc4ff)',
  'var(--ansi-bright-magenta, #e19bf0)',
  'var(--ansi-bright-cyan, #6fd6e2)',
  'var(--ansi-bright-white, #ffffff)',
];

/** xterm 256-colour cube → hex. */
function color256(n: number): string {
  if (n < 8) return BASE_COLORS[n];
  if (n < 16) return BRIGHT_COLORS[n - 8];
  if (n < 232) {
    const i = n - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const r = levels[Math.floor(i / 36) % 6];
    const g = levels[Math.floor(i / 6) % 6];
    const b = levels[i % 6];
    return `rgb(${r},${g},${b})`;
  }
  const grey = 8 + (n - 232) * 10;
  return `rgb(${grey},${grey},${grey})`;
}

/** Apply one SGR sequence's parameters to a style, returning the new style. */
function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  const next: AnsiStyle = { ...style };

  for (let i = 0; i < params.length; i++) {
    const p = params[i];

    // Extended colour: 38/48 followed by 5;N (256) or 2;R;G;B (truecolor).
    if (p === 38 || p === 48) {
      const mode = params[i + 1];
      if (mode === 5) {
        const c = color256(params[i + 2] ?? 0);
        if (p === 38) next.fg = c; else next.bg = c;
        i += 2;
        continue;
      }
      if (mode === 2) {
        const c = `rgb(${params[i + 2] ?? 0},${params[i + 3] ?? 0},${params[i + 4] ?? 0})`;
        if (p === 38) next.fg = c; else next.bg = c;
        i += 4;
        continue;
      }
      continue;
    }

    if (p === 0) { for (const k of Object.keys(next)) delete (next as any)[k]; continue; }
    if (p === 1) { next.bold = true; continue; }
    if (p === 2) { next.dim = true; continue; }
    if (p === 3) { next.italic = true; continue; }
    if (p === 4) { next.underline = true; continue; }
    if (p === 7) { next.inverse = true; continue; }
    if (p === 22) { delete next.bold; delete next.dim; continue; }
    if (p === 23) { delete next.italic; continue; }
    if (p === 24) { delete next.underline; continue; }
    if (p === 27) { delete next.inverse; continue; }
    if (p >= 30 && p <= 37) { next.fg = BASE_COLORS[p - 30]; continue; }
    if (p === 39) { delete next.fg; continue; }
    if (p >= 40 && p <= 47) { next.bg = BASE_COLORS[p - 40]; continue; }
    if (p === 49) { delete next.bg; continue; }
    if (p >= 90 && p <= 97) { next.fg = BRIGHT_COLORS[p - 90]; continue; }
    if (p >= 100 && p <= 107) { next.bg = BRIGHT_COLORS[p - 100]; continue; }
  }

  return next;
}

// CSI sequences: ESC [ params letter. OSC: ESC ] ... (BEL | ESC \).
const CSI = /\x1b\[([0-9;]*)([A-Za-z])/;
// eslint-disable-next-line no-control-regex
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/;

/**
 * Parse one chunk of terminal output into styled segments.
 * Pass the returned `state` back in for the next chunk so styling that spans
 * a chunk boundary is preserved.
 */
export function parseAnsiChunk(
  input: string,
  initial: AnsiStyle = {},
): { segments: AnsiSegment[]; state: AnsiStyle } {
  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = { ...initial };
  let rest = input;
  let plain = '';

  const flush = () => {
    if (plain) {
      segments.push({ ...style, text: plain });
      plain = '';
    }
  };

  while (rest.length > 0) {
    const esc = rest.indexOf('\x1b');
    if (esc === -1) { plain += rest; break; }

    plain += rest.slice(0, esc);
    rest = rest.slice(esc);

    const osc = OSC.exec(rest);
    if (osc && osc.index === 0) { rest = rest.slice(osc[0].length); continue; }

    const csi = CSI.exec(rest);
    if (csi && csi.index === 0) {
      if (csi[2] === 'm') {
        flush();
        const params = csi[1] === '' ? [0] : csi[1].split(';').map(n => parseInt(n, 10) || 0);
        style = applySgr(style, params);
      }
      // Every other CSI (cursor move, erase, scroll) is dropped, not rendered.
      rest = rest.slice(csi[0].length);
      continue;
    }

    // A lone ESC or an incomplete sequence at the end of a chunk: drop the ESC
    // so it never renders as a glyph.
    rest = rest.slice(1);
  }

  flush();
  return { segments, state: style };
}

/** Strip every escape sequence, leaving readable text. */
export function stripAnsi(input: string): string {
  return parseAnsiChunk(input).segments.map(s => s.text).join('');
}

/**
 * Bounded, plain-text excerpt of terminal output, for sending to the model.
 *
 * HomeBot's default runtime is a small local model (7B-class), which copes
 * badly with a full build log pasted into context. Keep the tail — errors and
 * summaries land at the end — strip ANSI, and cap both lines and characters.
 */
export function excerptForModel(
  output: string,
  { maxLines = 60, maxChars = 4000 }: { maxLines?: number; maxChars?: number } = {},
): string {
  const plain = stripAnsi(output).replace(/\r\n?/g, '\n').trimEnd();
  if (!plain) return '';

  const lines = plain.split('\n');
  let kept = lines.slice(-maxLines);
  let droppedLines = lines.length - kept.length;

  let text = kept.join('\n');
  while (text.length > maxChars && kept.length > 1) {
    kept = kept.slice(1);
    droppedLines++;
    text = kept.join('\n');
  }
  if (text.length > maxChars) text = text.slice(-maxChars);

  return droppedLines > 0
    ? `… ${droppedLines} earlier line${droppedLines === 1 ? '' : 's'} omitted …\n${text}`
    : text;
}

/**
 * Apply carriage returns within each line the way a terminal does: text after
 * a \r overwrites the start of the current line. This is what keeps progress
 * bars (npm, pip, docker) from stacking up as hundreds of near-identical rows.
 */
export function applyCarriageReturns(line: string): string {
  if (!line.includes('\r')) return line;
  let out = '';
  for (const part of line.split('\r')) {
    out = part.length >= out.length ? part : part + out.slice(part.length);
  }
  return out;
}
