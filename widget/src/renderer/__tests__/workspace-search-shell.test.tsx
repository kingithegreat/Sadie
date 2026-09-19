/** @jest-environment jsdom */
/**
 * WorkspaceShell ↔ SearchPanel wiring (IDE-9).
 *
 * CodeEditor is stubbed because the shared node_modules store on this machine
 * does not carry the CodeMirror packages — that absence is pre-existing on main
 * and is not related to this change. Stubbing the editor is what lets the SHELL
 * wiring be verified here: the activity-bar button, the Ctrl+Shift+F hotkey, and
 * the replace summary reaching the status bar.
 */

const React = require('react');
jest.mock('../components/workspace/CodeEditor', () => ({
  __esModule: true,
  default: (props: any) =>
    React.createElement('div', { 'data-testid': 'code-editor-stub' }, String(props.value || '')),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceShell from '../components/workspace/WorkspaceShell';

const ROOT = 'C:/proj';

beforeEach(() => {
  (window as any).electron = {
    workspaceRoot: jest.fn(async () => ({ success: true, path: ROOT })),
    workspaceList: jest.fn(async () => ({ success: true, path: ROOT, entries: [] })),
    workspaceRead: jest.fn(async () => ({ success: true, content: 'x', language: 'plaintext' })),
    workspaceSave: jest.fn(async () => ({ success: true })),
    onAssistantToolActivity: jest.fn(() => () => {}),
  };
});
afterEach(() => {
  delete (window as any).electron;
  // WorkspaceShell portals into document.body, which testing-library's own
  // cleanup does not reach — a stale shell from the previous test doubles every
  // query and reads as a wiring bug that is not one.
  document.body.innerHTML = '';
});

const renderShell = () =>
  render(<WorkspaceShell open onClose={jest.fn()} onHome={jest.fn()} />);

const searchButton = () => screen.getByRole('button', { name: 'Search across files' });

/** The sidebar renders nothing until the async workspace root resolves. */
const ready = async () => {
  await waitFor(() => expect((window as any).electron.workspaceRoot).toHaveBeenCalled());
};

const matches = [
  { file: 'src/one.ts', path: 'C:/proj/src/one.ts', line: 4, text: '  return "hello world";' },
  { file: 'readme.md', path: 'C:/proj/readme.md', line: 1, text: '# Hello heading' },
];

describe('WorkspaceShell search wiring', () => {
  test('the activity-bar button opens the Search sidebar', async () => {
    renderShell();
    await ready();

    expect(screen.queryByTestId('ws-search-query')).not.toBeInTheDocument();
    fireEvent.click(searchButton());
    // SearchPanel is lazy: the first open resolves its module on a later tick.
    await waitFor(() => expect(screen.getByTestId('ws-search-query')).toBeInTheDocument());
    expect(searchButton()).toHaveAttribute('aria-pressed', 'true');
  });

  test('Ctrl+Shift+F opens Search and puts the cursor in the query box', async () => {
    renderShell();
    await ready();

    expect(screen.queryByTestId('ws-search-query')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });

    const input = screen.getByTestId('ws-search-query');
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  test('a replace summary reaches the workspace status bar', async () => {
    const search = (window as any).electron.workspaceSearch = jest.fn(async () => ({
      success: true, match_count: matches.length, matches,
    }));
    (window as any).electron.workspaceReplace = jest.fn(async (_p: string, edits: any[]) => ({
      success: true, applied: edits.length, skipped: [],
    }));

    renderShell();
    await ready();
    fireEvent.click(searchButton());

    fireEvent.change(screen.getByTestId('ws-search-query'), { target: { value: 'hello' } });
    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-run')); });
    await waitFor(() => expect(search).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('ws-search-replace-toggle'));
    fireEvent.change(screen.getByTestId('ws-search-replacement'), { target: { value: 'goodbye' } });
    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-replace-all')); });

    await waitFor(() =>
      expect(screen.getByLabelText('Status bar')).toHaveTextContent('replacements written'),
    );
  });

  test('a match click opens the file in the editor area', async () => {
    (window as any).electron.workspaceSearch = jest.fn(async () => ({
      success: true, match_count: matches.length, matches,
    }));
    renderShell();
    await ready();
    fireEvent.click(searchButton());

    fireEvent.change(screen.getByTestId('ws-search-query'), { target: { value: 'hello' } });
    await act(async () => { fireEvent.click(screen.getByTestId('ws-search-run')); });

    fireEvent.click(screen.getByTestId('ws-search-match-src/one.ts-4'));
    await waitFor(() => expect(screen.getByTestId('code-editor-stub')).toBeInTheDocument());
    expect((window as any).electron.workspaceRead).toHaveBeenCalledWith('C:/proj/src/one.ts');
  });
});
