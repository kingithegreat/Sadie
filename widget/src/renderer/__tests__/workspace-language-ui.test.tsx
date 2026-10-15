/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from 'codemirror';
import CodeEditor from '../components/workspace/CodeEditor';
import WorkspaceNavigator from '../components/workspace/WorkspaceNavigator';
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  (Range.prototype as any).getClientRects = () => [];
  (Range.prototype as any).getBoundingClientRect = () => rect;
});
afterEach(() => localStorage.clear());
const viewOf = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
const ROOT = '/project'; const FILE = '/project/main.ts';
test('reachable definition query carries project and unsaved source and opens returned location', async () => {
  const workspaceLanguage = jest.fn().mockResolvedValue({ success: true, locations: [{ path: '/project/lib.ts', line: 7, column: 1, start: 10, length: 2 }] });
  (window as any).electron = { workspaceLanguage };
  const onNavigate = jest.fn();
  render(<CodeEditor root={ROOT} filePath={FILE} value="const x = 1" language="typescript" onChange={jest.fn()} onSave={jest.fn()} onNavigate={onNavigate} />);
  await act(async () => fireEvent.click(screen.getByText('Definition (F12)')));
  expect(workspaceLanguage).toHaveBeenCalledWith(expect.objectContaining({ root: ROOT, path: FILE, content: 'const x = 1', action: 'definition' }));
  fireEvent.click(screen.getByText(/lib.ts —/)); expect(onNavigate).toHaveBeenCalledWith('/project/lib.ts', 7);
});
test('format requires review, applies only the original snapshot, and reports changed source', async () => {
  const original = 'const x=1;';
  (window as any).electron = { workspaceLanguage: jest.fn().mockResolvedValue({ success: true, edits: [{ path: FILE, expectedContent: original, changes: [{ start: 7, length: 1, text: ' = ' }] }] }) };
  const { container } = render(<CodeEditor root={ROOT} filePath={FILE} value={original} language="typescript" onChange={jest.fn()} onSave={jest.fn()} />);
  const view = viewOf(container);
  await act(async () => fireEvent.click(screen.getByText('Format')));
  expect(view.state.doc.toString()).toBe(original);
  act(() => view.dispatch({ changes: { from: 0, insert: '// new draft\n' } }));
  await act(async () => fireEvent.click(screen.getByText('Apply reviewed edits')));
  expect(view.state.doc.toString()).toBe('// new draft\n' + original);
  expect(screen.getByRole('status')).toHaveTextContent('Nothing was applied');
});
test('on-save formatting gives save the formatted snapshot and retains typing while service responds', async () => {
  const original = 'const x=1;';
  let finish: (result: any) => void = () => {};
  (window as any).electron = { workspaceLanguage: jest.fn(() => new Promise(resolve => { finish = resolve; })) };
  localStorage.setItem('homebot.code.editor.preferences.v1', JSON.stringify({ formatOnSave: true, tabSize: 4, fontSize: 16 }));
  const save = jest.fn();
  const { container } = render(<CodeEditor root={ROOT} filePath={FILE} value={original} language="typescript" onChange={jest.fn()} onSave={save} />);
  const view = viewOf(container);
  act(() => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
  await act(async () => finish({ success: true, edits: [{ path: FILE, expectedContent: original, changes: [{ start: 7, length: 1, text: ' = ' }] }] }));
  expect(save).toHaveBeenCalledWith('const x = 1;');
  save.mockClear();
  act(() => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '\n// typed during format' } }));
  const expected = view.state.doc.toString();
  await act(async () => finish({ success: true, edits: [] }));
  expect(save).not.toHaveBeenCalled(); expect(view.state.doc.toString()).toBe(expected);
  expect(screen.getByRole('alert')).toHaveTextContent('You typed while formatting');
});
test('unsupported semantic requests explain the available language support', async () => {
  (window as any).electron = { workspaceLanguage: jest.fn().mockResolvedValue({ success: false, error: 'Semantic tools currently support JavaScript and TypeScript.' }) };
  render(<CodeEditor root={ROOT} filePath="/project/main.py" value="print(1)" language="python" onChange={jest.fn()} onSave={jest.fn()} />);
  await act(async () => fireEvent.click(screen.getByText('Definition (F12)')));
  expect(screen.getByRole('alert')).toHaveTextContent('JavaScript and TypeScript');
});
test('late semantic results are discarded after a project switch or source edit', async () => {
  let finish: (result: any) => void = () => {};
  (window as any).electron = { workspaceLanguage: jest.fn(() => new Promise(resolve => { finish = resolve; })) };
  const props = { filePath: FILE, value: 'const x = 1', language: 'typescript', onChange: jest.fn(), onSave: jest.fn() };
  const editor = render(<CodeEditor {...props} root={ROOT} />);
  fireEvent.click(screen.getByText('Definition (F12)'));
  await act(async () => editor.rerender(<CodeEditor {...props} root="/different-project" />));
  await act(async () => finish({ success: true, locations: [{ path: '/project/OLD_RESULT.ts', line: 1, column: 1, start: 0, length: 1 }] }));
  expect(screen.queryByText(/OLD_RESULT/)).not.toBeInTheDocument(); expect(screen.getByText('Definition (F12)')).not.toBeDisabled();
  fireEvent.click(screen.getByText('Definition (F12)'));
  act(() => viewOf(editor.container).dispatch({ changes: { from: 0, insert: '// typed\n' } }));
  await act(async () => finish({ success: true, locations: [{ path: '/different-project/STALE_RESULT.ts', line: 1, column: 1, start: 0, length: 1 }] }));
  expect(screen.queryByText(/STALE_RESULT/)).not.toBeInTheDocument(); expect(screen.getByRole('status')).toHaveTextContent('source changed');
});
test('Quick Open filters project files and keyboard Enter opens the selected actual path', async () => {
  (window as any).electron = { workspaceLanguage: jest.fn().mockResolvedValue({ success: true, files: ['/project/.gitignore', '/project/src/app.ts'] }) };
  const onOpen = jest.fn(); const onClose = jest.fn();
  await act(async () => render(<WorkspaceNavigator root={ROOT} onOpen={onOpen} onClose={onClose} commands={[]} mode="files" />));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'app' } });
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledWith('/project/src/app.ts'); expect(onClose).toHaveBeenCalled();
});
test('command palette invokes actual provided command and Escape closes symbols', async () => {
  const run = jest.fn(); const onClose = jest.fn();
  render(<WorkspaceNavigator root={ROOT} onOpen={jest.fn()} onClose={onClose} commands={[{ id: 'test', label: 'Run project tests', run }]} mode="commands" />);
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }); expect(run).toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' }); expect(onClose).toHaveBeenCalledTimes(2);
});
test('AI ghost suggestions are opt-in and Tab accepts only the captured document and cursor', async () => {
  let finish: (result: any) => void = () => {};
  const workspaceCodeComplete = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  (window as any).electron = { workspaceCodeComplete };
  const { container } = render(<CodeEditor root={ROOT} filePath={FILE} value="const x = " language="typescript" onChange={jest.fn()} onSave={jest.fn()} />);
  const view = viewOf(container);
  expect(screen.getByText('Suggest code')).toBeDisabled(); expect(workspaceCodeComplete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Editor settings'));
  fireEvent.click(screen.getByLabelText(/Local AI suggestions/));
  act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
  fireEvent.click(screen.getByText('Suggest code'));
  await act(async () => finish({ success: true, text: '42;' }));
  expect(workspaceCodeComplete).toHaveBeenCalledWith(ROOT, 'const x = ', '');
  expect(container.querySelector('.code-ghost-completion')).toHaveTextContent('42;');
  act(() => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true })));
  expect(view.state.doc.toString()).toBe('const x = 42;');
  fireEvent.click(screen.getByText('Suggest code'));
  act(() => view.dispatch({ changes: { from: 0, insert: '// typed\n' } }));
  const expected = view.state.doc.toString();
  await act(async () => finish({ success: true, text: 'unrelated' }));
  expect(container.querySelector('.code-ghost-completion')).toBeNull(); expect(view.state.doc.toString()).toBe(expected);
});
