/** @jest-environment jsdom */
/**
 * SearchPanel — IDE-9.
 *
 * The point of these tests is the contract a person relies on: the list shows
 * matches from several files, a click opens the right file at the right line,
 * and the replace preview is what actually gets written — with everything the
 * user did not check left alone.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SearchPanel from '../components/workspace/SearchPanel';

const ROOT = 'C:/proj';

let searchMock: jest.Mock;
let replaceMock: jest.Mock;
let opened: Array<{ path: string; line?: number }>;

beforeEach(() => {
  opened = [];
  searchMock = jest.fn();
  replaceMock = jest.fn();
  (window as any).electron = {
    workspaceSearch: searchMock,
    workspaceReplace: replaceMock,
  };
});
afterEach(() => { delete (window as any).electron; });

const matches = [
  { file: 'src/one.ts', path: 'C:/proj/src/one.ts', line: 4, text: '  return "hello world";' },
  { file: 'src/two.ts', path: 'C:/proj/src/two.ts', line: 2, text: 'export const A = "hello";' },
  { file: 'readme.md', path: 'C:/proj/readme.md', line: 1, text: '# Hello heading' },
];

const runSearch = async (pattern = 'hello') => {
  searchMock.mockResolvedValue({ success: true, match_count: matches.length, matches });
  render(
    <SearchPanel root={ROOT} onOpenFile={(path, line) => opened.push({ path, line })} />,
  );
  fireEvent.change(screen.getByTestId('ws-search-query'), { target: { value: pattern } });
  await act(async () => { fireEvent.click(screen.getByTestId('ws-search-run')); });
  await waitFor(() => expect(searchMock).toHaveBeenCalled());
};

describe('SearchPanel search', () => {
  test('groups matches by file and reports the count', async () => {
    await runSearch();
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ pattern: 'hello', directory: ROOT }));
    expect(screen.getByTestId('ws-search-results')).toHaveTextContent('src/one.ts');
    expect(screen.getByTestId('ws-search-results')).toHaveTextContent('readme.md');
    expect(screen.getByText(/3 results in 3 files/)).toBeInTheDocument();
  });

  test('a match click opens its file at that line', async () => {
    await runSearch();
    fireEvent.click(screen.getByTestId('ws-search-match-src/one.ts-4'));
    expect(opened).toEqual([{ path: 'C:/proj/src/one.ts', line: 4 }]);
  });

  test('the file header opens the file without a line target', async () => {
    await runSearch();
    fireEvent.click(screen.getByText('src/two.ts'));
    expect(opened).toEqual([{ path: 'C:/proj/src/two.ts' }]);
  });

  test('options reach the engine: case sensitivity and include pattern', async () => {
    await runSearch('Hello');
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({
      pattern: 'Hello',
      case_sensitive: false,
      file_pattern: '',
    }));

    fireEvent.click(screen.getByTitle('Match case'));
    fireEvent.change(screen.getByTestId('ws-search-glob'), { target: { value: '*.ts' } });
    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-run')); });
    expect(searchMock).toHaveBeenLastCalledWith(expect.objectContaining({
      case_sensitive: true,
      file_pattern: '*.ts',
    }));
  });

  test('a failed search shows the reason instead of an empty list', async () => {
    searchMock.mockResolvedValue({ success: false, error: 'Search failed: boom' });
    render(<SearchPanel root={ROOT} onOpenFile={jest.fn()} />);
    fireEvent.change(screen.getByTestId('ws-search-query'), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-run')); });
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  test('an empty query does not call the engine', async () => {
    searchMock.mockResolvedValue({ success: true, matches: [] });
    render(<SearchPanel root={ROOT} onOpenFile={jest.fn()} />);
    fireEvent.change(screen.getByTestId('ws-search-query'), { target: { value: '   ' } });
    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-run')); });
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe('SearchPanel replace preview', () => {
  test('the preview shows what each checked match becomes before anything is written', async () => {
    await runSearch();
    fireEvent.click(screen.getByTestId('ws-search-replace-toggle'));
    fireEvent.change(screen.getByTestId('ws-search-replacement'), { target: { value: 'goodbye' } });

    // Only the lines that actually change get a preview arrow — one per row.
    expect(screen.queryAllByText('→')).toHaveLength(3);
  });

  test('replace sends one line-exact edit per checked match, then re-searches', async () => {
    await runSearch();
    fireEvent.click(screen.getByTestId('ws-search-replace-toggle'));
    fireEvent.change(screen.getByTestId('ws-search-replacement'), { target: { value: 'goodbye' } });

    // The main process reports how many lines each file actually wrote.
    replaceMock.mockImplementation(async (_p: string, edits: any[]) => ({ success: true, applied: edits.length, skipped: [] }));
    searchMock.mockClear();
    searchMock.mockResolvedValue({ success: true, match_count: 0, matches: [] });

    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-replace-all')); });

    // Three files, so three writes — each carrying the exact old text.
    expect(replaceMock).toHaveBeenCalledTimes(3);
    expect(replaceMock).toHaveBeenCalledWith('C:/proj/src/one.ts', [
      { line: 4, oldText: '  return "hello world";', newText: '  return "goodbye world";' },
    ]);
    expect(replaceMock).toHaveBeenCalledWith('C:/proj/readme.md', [
      { line: 1, oldText: '# Hello heading', newText: '# goodbye heading' },
    ]);
    // The list refreshes so it describes the files as they now are.
    expect(searchMock).toHaveBeenCalled();
    expect(screen.getByText('No matches.')).toBeInTheDocument();
    expect(screen.getByTestId('ws-search-report')).toHaveTextContent('3 replacements written');
  });

  test('unchecking a match excludes it from the write', async () => {
    await runSearch();
    fireEvent.click(screen.getByTestId('ws-search-replace-toggle'));
    fireEvent.change(screen.getByTestId('ws-search-replacement'), { target: { value: 'goodbye' } });

    // Whole-file checkbox off for readme.md (one match).
    fireEvent.click(screen.getByTestId('ws-search-file-check-readme.md'));
    replaceMock.mockResolvedValue({ success: true, applied: 2, skipped: [] });
    searchMock.mockClear();
    searchMock.mockResolvedValue({ success: true, match_count: 0, matches: [] });

    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-replace-all')); });

    const written: string[] = replaceMock.mock.calls.map(c => c[0]);
    expect(written).not.toContain('C:/proj/readme.md');
    expect(written).toContain('C:/proj/src/one.ts');
  });

  test('a skipped line is reported, not hidden', async () => {
    await runSearch();
    fireEvent.click(screen.getByTestId('ws-search-replace-toggle'));
    fireEvent.change(screen.getByTestId('ws-search-replacement'), { target: { value: 'goodbye' } });

    replaceMock.mockResolvedValue({ success: false, applied: 0, skipped: [{ line: 4, reason: 'line changed since the search' }] });
    searchMock.mockClear();
    searchMock.mockResolvedValue({ success: true, match_count: matches.length, matches });

    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-replace-all')); });

    expect(screen.getByTestId('ws-search-report')).toHaveTextContent('skipped');
  });

  test('a checked match that would not change is not written', async () => {
    // Case-sensitive, so the lowercase query leaves "Hello heading" unmatched
    // and makes every actual match a genuine no-op.
    searchMock.mockResolvedValue({
      success: true,
      match_count: 2,
      matches: [
        { file: 'src/one.ts', path: 'C:/proj/src/one.ts', line: 4, text: '  return "hello world";' },
        { file: 'src/two.ts', path: 'C:/proj/src/two.ts', line: 2, text: 'export const A = "hello";' },
      ],
    });
    render(<SearchPanel root={ROOT} onOpenFile={jest.fn()} />);
    fireEvent.change(screen.getByTestId('ws-search-query'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTitle('Match case'));
    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-run')); });
    await waitFor(() => expect(searchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('ws-search-replace-toggle'));
    // Replace "hello" with "hello" — nothing changes.
    fireEvent.change(screen.getByTestId('ws-search-replacement'), { target: { value: 'hello' } });

    replaceMock.mockResolvedValue({ success: true, applied: 0, skipped: [] });
    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-replace-all')); });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('ws-search-report')).toHaveTextContent('No checked match would change.');
  });

  test('regex replacement and highlighting honour the regex toggle', async () => {
    await runSearch('hello (\\w+)');
    fireEvent.click(screen.getByTestId('ws-search-replace-toggle'));
    fireEvent.click(screen.getByTitle('Use regular expressions'));
    fireEvent.change(screen.getByTestId('ws-search-replacement'), { target: { value: 'greetings $1' } });

    expect(screen.getByTestId('ws-search-match-src/one.ts-4')).toHaveTextContent('greetings world');
  });
});
