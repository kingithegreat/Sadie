import { diffText, toHunks, splitLines } from '../diff/line-diff';

describe('splitLines', () => {
  it('does not invent a trailing empty line', () => {
    expect(splitLines('a\n')).toEqual(['a']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
  });

  it('treats empty text as no lines, not one blank line', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('normalises CRLF — a Windows file must not read as entirely changed', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
  });
});

describe('diffText', () => {
  it('reports no changes for identical text', () => {
    const d = diffText('a\nb\nc', 'a\nb\nc');
    expect(d.stats).toEqual({ added: 0, removed: 0, approximate: false });
    expect(d.lines.every(l => l.type === 'equal')).toBe(true);
  });

  it('finds a single changed line and leaves the rest equal', () => {
    const d = diffText('a\nb\nc', 'a\nB\nc');
    expect(d.stats.added).toBe(1);
    expect(d.stats.removed).toBe(1);
    expect(d.lines.filter(l => l.type === 'equal')).toHaveLength(2);
  });

  it('numbers lines against the correct side', () => {
    const d = diffText('a\nc', 'a\nb\nc');
    const added = d.lines.find(l => l.type === 'add')!;
    expect(added.text).toBe('b');
    expect(added.before).toBeNull();   // did not exist before
    expect(added.after).toBe(2);
    const last = d.lines[d.lines.length - 1];
    expect(last).toMatchObject({ type: 'equal', before: 2, after: 3, text: 'c' });
  });

  it('handles a file created from nothing', () => {
    const d = diffText('', 'hello\nworld');
    expect(d.stats).toMatchObject({ added: 2, removed: 0 });
  });

  it('handles a file emptied', () => {
    const d = diffText('hello\nworld', '');
    expect(d.stats).toMatchObject({ added: 0, removed: 2 });
  });

  it('CRLF -> LF alone is not a change', () => {
    // Windows editors rewrite line endings constantly. Reporting that as a
    // whole-file rewrite would make the review panel useless here.
    const d = diffText('a\r\nb\r\n', 'a\nb\n');
    expect(d.stats).toMatchObject({ added: 0, removed: 0 });
  });

  it('a small edit in a large file stays precise (prefix/suffix trimming)', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const after = [...big];
    after[2500] = 'CHANGED';
    const d = diffText(big.join('\n'), after.join('\n'));
    expect(d.stats).toMatchObject({ added: 1, removed: 1, approximate: false });
  });

  it('degrades to a block replace rather than hanging on a huge rewrite', () => {
    // Two totally different 3,000-line files: the LCS table would be ~9M
    // cells. The panel must still render something instead of freezing.
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n');
    const d = diffText(a, b);
    expect(d.stats.approximate).toBe(true);
    expect(d.stats.removed).toBe(3000);
    expect(d.stats.added).toBe(3000);
  });

  it('preserves every before-line exactly once across the output', () => {
    const before = 'one\ntwo\nthree\nfour';
    const d = diffText(before, 'one\nTWO\nthree\nfour\nfive');
    const fromBefore = d.lines.filter(l => l.before !== null).map(l => l.text);
    expect(fromBefore).toEqual(['one', 'two', 'three', 'four']);
  });
});

describe('toHunks', () => {
  const many = (n: number, p = 'x') => Array.from({ length: n }, (_, i) => `${p}${i}`);

  it('returns nothing when there are no changes', () => {
    expect(toHunks(diffText('a\nb', 'a\nb'))).toEqual([]);
  });

  it('collapses a one-line change in a long file to a single small hunk', () => {
    const a = many(200);
    const b = [...a];
    b[100] = 'CHANGED';
    const hunks = toHunks(diffText(a.join('\n'), b.join('\n')), 3);
    expect(hunks).toHaveLength(1);
    // 3 lines context either side + the add and the remove
    expect(hunks[0].lines.length).toBeLessThanOrEqual(8);
  });

  it('merges changes whose context windows overlap', () => {
    const a = many(50);
    const b = [...a];
    b[10] = 'A';
    b[12] = 'B'; // within 3 lines of the first — one hunk, not two
    expect(toHunks(diffText(a.join('\n'), b.join('\n')), 3)).toHaveLength(1);
  });

  it('keeps distant changes as separate hunks', () => {
    const a = many(50);
    const b = [...a];
    b[5] = 'A';
    b[40] = 'B';
    expect(toHunks(diffText(a.join('\n'), b.join('\n')), 3)).toHaveLength(2);
  });

  it('reports line numbers a reviewer can map back to the file', () => {
    const a = many(20);
    const b = [...a];
    b[10] = 'CHANGED';
    const [hunk] = toHunks(diffText(a.join('\n'), b.join('\n')), 2);
    // change at index 10 => line 11; two lines of context => starts at 9
    expect(hunk.beforeStart).toBe(9);
    expect(hunk.afterStart).toBe(9);
  });
});
