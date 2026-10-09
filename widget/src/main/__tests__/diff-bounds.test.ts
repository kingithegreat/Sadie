jest.mock('electron', () => ({ app: { getPath: jest.fn() }, dialog: {} }));
jest.mock('../window-manager', () => ({ getMainWindow: () => null }));
jest.mock('child_process', () => ({ spawn: jest.fn(() => { throw new Error('Text diffs must not spawn a helper'); }) }));
import { diffTextHandler, DIFF_LIMITS } from '../tools/diff';

test('ordinary unequal source produces a real line diff', async () => {
  const result = await diffTextHandler({ original: 'const x = 1;\nreturn x;\n', modified: 'const x = 2;\nreturn x;\n' }, {} as any);
  expect(result).toMatchObject({ success: true, result: { added_lines: 1, removed_lines: 1, unchanged_lines: 2 } });
  expect(result.result.unified_diff).toContain('+const x = 2;');
});

test('byte, line and matrix budgets reject generated input before split or LCS allocation', async () => {
  const examples = [
    { original: 'a'.repeat(DIFF_LIMITS.bytes + 1), modified: 'small', reason: /byte limit/ },
    { original: 'é'.repeat(DIFF_LIMITS.bytes / 2 + 1), modified: 'small', reason: /byte limit/ },
    { original: '\n'.repeat(DIFF_LIMITS.lines), modified: 'small', reason: /line limit/ },
    { original: 'a\n'.repeat(1000), modified: 'b\n'.repeat(1000), reason: /comparison budget/ },
  ];
  const split = jest.spyOn(String.prototype, 'split'), table = jest.spyOn(Array, 'from');
  try {
    for (const { original, modified, reason } of examples) {
      split.mockClear(); table.mockClear();
      const result = await diffTextHandler({ original, modified }, {} as any);
      const splitCalls = split.mock.calls.length, tableCalls = table.mock.calls.length;
      expect(result.success).toBe(false); expect(result.error).toMatch(reason);
      expect(splitCalls).toBe(0); expect(tableCalls).toBe(0);
    }
  } finally { split.mockRestore(); table.mockRestore(); }
});
