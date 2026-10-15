/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from 'codemirror';
import WorkspaceShell from '../components/workspace/WorkspaceShell';
jest.mock('../components/workspace/FileTree', () => ({ __esModule: true, default: ({ onOpenFile }: any) => <button onClick={() => onOpenFile('/project/example.ts')}>Open example</button> }));
jest.mock('../components/TerminalPanel', () => ({ __esModule: true, default: () => null }));
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  (Range.prototype as any).getClientRects = () => [];
  (Range.prototype as any).getBoundingClientRect = () => rect;
});
afterEach(() => localStorage.clear());
async function openEditor() {
  const original = 'const x=1;'; let disk = original, finish!: (value: any) => void;
  const workspaceSave = jest.fn(async (_path: string, content: string) => { disk = content; return { success: true, version: 'v2' }; });
  const workspaceLanguage = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  (window as any).electron = {
    workspaceRoot: async () => ({ path: '/project' }),
    workspaceRead: async () => ({ success: true, content: disk, language: 'typescript', version: 'v1' }),
    workspaceSave, workspaceLanguage, onAssistantToolActivity: () => () => {},
  };
  localStorage.setItem('homebot.code.editor.preferences.v1', JSON.stringify({ formatOnSave: true, tabSize: 2, fontSize: 13 }));
  const rendered = render(<WorkspaceShell open onClose={jest.fn()} />);
  fireEvent.click(await screen.findByText('Open example'));
  // The real shell is a body portal, outside React Testing Library's container.
  await waitFor(() => expect(rendered.baseElement.querySelector('.cm-content')).not.toBeNull());
  const view = EditorView.findFromDOM(rendered.baseElement.querySelector('.cm-editor') as HTMLElement)!;
  return { view, workspaceSave, workspaceLanguage, disk: () => disk, finish: () => finish({ success: true, edits: [{ path: '/project/example.ts', expectedContent: original, changes: [{ start: 7, length: 1, text: ' = ' }] }] }) };
}
function save(view: EditorView) {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
}
test('one bubbling CtrlS through actual CodeMirror and shell saves only the formatted snapshot after the formatter resolves', async () => {
  const f = await openEditor();
  act(() => save(f.view));
  expect(f.workspaceLanguage).toHaveBeenCalledTimes(1);
  expect(f.workspaceSave).not.toHaveBeenCalled(); expect(f.disk()).toBe('const x=1;');
  await act(async () => f.finish());
  expect(f.workspaceSave).toHaveBeenCalledTimes(1);
  expect(f.workspaceSave).toHaveBeenCalledWith('/project/example.ts', 'const x = 1;', expect.objectContaining({ expectedVersion: 'v1' }));
  expect(f.disk()).toBe('const x = 1;'); expect(f.view.state.doc.toString()).toBe('const x = 1;');
  expect(screen.queryByLabelText('Unsaved changes')).not.toBeInTheDocument();
});
test('typing during the actual shell formatter keeps all newer draft bytes and makes no disk write', async () => {
  const f = await openEditor();
  act(() => save(f.view));
  act(() => f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: '\n// newer draft' } }));
  const newer = f.view.state.doc.toString();
  await act(async () => f.finish());
  expect(f.workspaceSave).not.toHaveBeenCalled(); expect(f.disk()).toBe('const x=1;');
  expect(f.view.state.doc.toString()).toBe(newer); expect(screen.getByRole('alert')).toHaveTextContent('You typed while formatting');
  expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
});
test('a consumed CtrlS on another workspace field is ignored while an unclaimed workspace CtrlS still saves', async () => {
  const f = await openEditor();
  act(() => f.view.dispatch({ changes: { from: 0, insert: '// changed\n' } }));
  const consumed = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }); consumed.preventDefault();
  act(() => screen.getByText('Open example').dispatchEvent(consumed)); expect(f.workspaceSave).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByText('Open example'), { key: 's', ctrlKey: true });
  await waitFor(() => expect(f.workspaceSave).toHaveBeenCalledTimes(1));
});
