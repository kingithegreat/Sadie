/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WorkspaceShell from '../components/workspace/WorkspaceShell';
jest.mock('../components/workspace/FileTree', () => ({ __esModule: true, default: ({ onOpenFile }: any) => <><button onClick={() => onOpenFile('C:/project/a.ts')}>Open a</button><button onClick={() => onOpenFile('C:/project/b.ts')}>Open b</button></> }));
jest.mock('../components/workspace/CodeEditor', () => ({ __esModule: true, default: ({ value, onChange, onApplyEdits, filePath, root }: any) => <><textarea className="cm-content" aria-label={`Editor ${filePath}`} value={value} onChange={e => onChange(e.target.value)} /><button onClick={() => { void onApplyEdits([{ path: 'C:/project/a.ts', expectedContent: 'foo', changes: [{ start: 0, length: 3, text: 'bar' }] }, { path: 'C:/project/b.ts', expectedContent: 'foo', changes: [{ start: 0, length: 3, text: 'bar' }] }]); }}>Stage refactor</button><span data-testid="editor-project">{root}</span></> }));
jest.mock('../components/TerminalPanel', () => ({ __esModule: true, default: () => <textarea className="xterm-helper-textarea" aria-label="Interactive terminal input" /> }));
jest.mock('../components/workspace/WorkspaceNavigator', () => ({ __esModule: true, default: ({ mode, commands, onOpen, onClose }: any) => <div role="dialog" aria-label={mode}><button onClick={() => { commands.find((c: any) => c.id === 'search').run(); onClose(); }}>Run search command</button><button onClick={() => { onClose(); void onOpen('C:/project/b.ts'); }}>Open picker file</button><button onClick={onClose}>Close picker</button></div> }), { virtual: true });
function setup(onClose = jest.fn()) {
  const texts: Record<string, string> = { 'C:/project/a.ts': 'foo', 'C:/project/b.ts': 'foo' };
  const workspaceSave = jest.fn(async (path: string, content: string) => { texts[path] = content; return { success: true, version: 'saved' }; });
  (window as any).electron = { workspaceRoot: async () => ({ path: 'C:/project' }), workspaceRead: async (path: string) => ({ success: true, content: texts[path], language: 'typescript', version: 'opened' }), workspaceSave, onAssistantToolActivity: () => () => undefined };
  render(<WorkspaceShell open onClose={onClose} />);
  return { workspaceSave, texts };
}
test('deliberately focused terminal owns Escape; header Escape still returns to chat', async () => {
  const onClose = jest.fn(); setup(onClose);
  const terminal = await screen.findByLabelText('Interactive terminal input');
  terminal.focus(); fireEvent.keyDown(terminal, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled(); expect(terminal).toHaveFocus();
  const header = screen.getByRole('button', { name: 'Back to HomeBot' });
  header.focus(); fireEvent.keyDown(header, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});
test('Quick Open, command palette and symbols hotkeys mount the navigator and run a real shell command', async () => {
  setup(); await screen.findByText('Open a');
  fireEvent.keyDown(window, { ctrlKey: true, key: 'p' }); await screen.findByRole('dialog', { name: 'files' }); fireEvent.click(screen.getByText('Close picker'));
  fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: 'p' }); await screen.findByRole('dialog', { name: 'commands' }); fireEvent.click(screen.getByText('Run search command'));
  expect(screen.getByRole('complementary', { name: 'Search' })).toBeInTheDocument();
  fireEvent.keyDown(window, { ctrlKey: true, key: 't' }); expect(await screen.findByRole('dialog', { name: 'symbols' })).toBeInTheDocument();
});
test('multi-file refactors load unopened targets and stage all drafts without writing disk', async () => {
  const app = setup(); fireEvent.click(await screen.findByText('Open a')); await screen.findByLabelText('Editor C:/project/a.ts');
  expect(screen.getByTestId('editor-project')).toHaveTextContent('C:/project');
  fireEvent.click(screen.getByText('Stage refactor'));
  await waitFor(() => expect(screen.getAllByLabelText('Unsaved changes')).toHaveLength(2));
  expect(screen.getByLabelText('Editor C:/project/a.ts')).toHaveValue('bar');
  fireEvent.click(screen.getByRole('tab', { name: /b.ts/ })); expect(screen.getByLabelText('Editor C:/project/b.ts')).toHaveValue('bar');
  expect(app.texts).toEqual({ 'C:/project/a.ts': 'foo', 'C:/project/b.ts': 'foo' }); expect(app.workspaceSave).not.toHaveBeenCalled();
});

test('Quick Open focuses the newly active editor after the picker closes', async () => {
  setup(); fireEvent.click(await screen.findByText('Open a')); await screen.findByLabelText('Editor C:/project/a.ts');
  fireEvent.click(screen.getByText('Quick Open')); await screen.findByRole('dialog', { name: 'files' });
  fireEvent.click(screen.getByText('Open picker file'));
  const editor = await screen.findByLabelText('Editor C:/project/b.ts');
  await waitFor(() => expect(editor).toHaveFocus());
});
test('split keeps a second target and focused Ctrl+S writes that pane; layout sliders change real sizes', async () => {
  const app = setup(); fireEvent.click(await screen.findByText('Open a')); await screen.findByLabelText('Editor C:/project/a.ts');
  fireEvent.click(screen.getByText('Open b')); await screen.findByLabelText('Editor C:/project/b.ts');
  fireEvent.click(screen.getByText('Split editor'));
  const pane = screen.getByRole('region', { name: 'Second editor' });
  fireEvent.change(within(pane).getByRole('textbox'), { target: { value: 'secondary draft' } });
  within(pane).getByRole('textbox').focus(); fireEvent.keyDown(window, { ctrlKey: true, key: 's' });
  await waitFor(() => expect(app.workspaceSave).toHaveBeenCalledWith('C:/project/a.ts', 'secondary draft', expect.objectContaining({ expectedVersion: 'opened' })));
  fireEvent.click(screen.getByText('Layout'));
  fireEvent.change(screen.getByLabelText('Sidebar width'), { target: { value: '420' } });
  expect(screen.getByRole('complementary', { name: 'Explorer' })).toHaveStyle({ width: '420px' });
});
