import { lineColumnToOffset, toEditorDiagnostics, setLiveProblems, getLiveProblems, subscribeLiveProblems } from '../components/workspace/projectTools';

test('ESLint line/column pairs map onto editor offsets and stay in range', () => {
  const text = 'const a = 1;\nvar b = 2;\n';
  expect(lineColumnToOffset(text, 2, 1)).toBe(13);
  expect(lineColumnToOffset(text, 2, 99)).toBe(text.indexOf('\n', 13));
  expect(lineColumnToOffset(text, 50, 1)).toBe(text.length);
  const [diagnostic] = toEditorDiagnostics(text, [{ line: 2, column: 1, endLine: 2, endColumn: 4, severity: 'error', message: 'Unexpected var', ruleId: 'no-var' }]);
  expect(diagnostic).toEqual({ from: 13, to: 16, severity: 'error', source: 'eslint', message: 'Unexpected var (no-var)' });
});

test('live problems are shared per file, scoped by project, and notify listeners', () => {
  const seen = jest.fn(); const off = subscribeLiveProblems(seen);
  setLiveProblems('/p/a.ts', [{ path: '/p/a.ts', line: 1, column: 1, severity: 'warning', message: 'w' }]);
  setLiveProblems('/q/b.ts', [{ path: '/q/b.ts', line: 2, column: 1, severity: 'error', message: 'e' }]);
  expect(getLiveProblems('/p')).toHaveLength(1);
  setLiveProblems('/p/a.ts', []);
  expect(getLiveProblems('/p')).toHaveLength(0);
  expect(seen).toHaveBeenCalledTimes(3);
  off(); setLiveProblems('/q/b.ts', []); expect(seen).toHaveBeenCalledTimes(3);
});
