/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceShell from '../components/workspace/WorkspaceShell';
jest.mock('../components/workspace/FileTree', () => ({ __esModule: true, default: ({ root, onOpenFile }: any) => <div data-testid="explorer-root">{root}{root.includes('/folders/') && <button onClick={() => onOpenFile(`${root}/draft.ts`)}>Open draft.ts</button>}</div> }));
jest.mock('../components/workspace/CodeEditor', () => ({ __esModule: true, default: ({ value, onChange, onSave }: any) => <div><textarea aria-label="Code editor" value={value} onChange={event => onChange(event.target.value)} /><button onClick={() => onSave()}>Save editor</button></div> }));
jest.mock('../components/TerminalPanel', () => ({ __esModule: true, default: ({ projectPath }: any) => <div data-testid="terminal-root">{projectPath}</div> }));

function setup() {
  const workspaceList = jest.fn(async (input: string): Promise<any> => /\.ts$/.test(input) ? { success: false, error: 'Not a directory.' } : { success: true, path: input, entries: [] });
  const workspaceRead = jest.fn(async (input: string): Promise<any> => ({ success: true, path: input, content: `disk:${input}`, version: `version:${input}`, language: 'typescript', eol: 'lf', bom: false }));
  const workspaceSave = jest.fn(async (_input: string, _content: string, _options: any) => ({ success: true, version: 'saved', eol: 'lf', bom: false }));
  const workspaceRecoveryLoad = jest.fn(async (_root: string): Promise<any> => ({ success: true, state: null }));
  const workspaceRecoverySave = jest.fn(async (_root: string, _state: any) => ({ success: true }));
  (window as any).electron = {
    workspaceList, workspaceRead, workspaceSave, workspaceRecoveryLoad, workspaceRecoverySave,
    workspaceRoot: jest.fn(async () => ({ success: true, path: 'C:/default' })),
    workspaceRecentProjects: async () => ({ success: true, paths: ['C:/first', 'C:/second'] }),
    onAssistantToolActivity: () => () => undefined,
  };
  return { workspaceList, workspaceRead, workspaceSave, workspaceRecoveryLoad, workspaceRecoverySave };
}

test('a canonical Mac default root opens a tree file and retains its dirty recovery payload', async () => {
  const api = setup(); const canonical = '/private/var/folders/isolated/home';
  (window as any).electron.workspaceRoot = jest.fn(async () => ({ success: true, path: canonical }));
  api.workspaceRead.mockImplementation(async input => ({ success: true, path: input.replace(/^\/var\//, '/private/var/'), content: 'Mac default-root file bytes', original: 'Mac default-root file bytes', version: 'mac-v1', language: 'typescript' }));
  render(<WorkspaceShell open onClose={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open draft.ts' }));
  expect(await screen.findByLabelText('Code editor')).toHaveValue('Mac default-root file bytes');
  expect(screen.getByTestId('explorer-root')).toHaveTextContent(canonical);
  fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'Mac unsaved draft' } });
  await waitFor(() => expect(api.workspaceRecoverySave).toHaveBeenCalledWith(canonical, expect.objectContaining({ activePath: `${canonical}/draft.ts`, files: [expect.objectContaining({ path: `${canonical}/draft.ts`, content: 'Mac unsaved draft' })] })));
});

test('a fresh file handoff establishes the canonical parent and actually opens the requested editor', async () => {
  const api = setup(); const requested = 'C:/alias/project/hello.ts', canonical = 'C:/canonical/project';
  api.workspaceList.mockImplementation(async input => /\.ts$/.test(input) ? { success: false } : { success: true, path: input === 'C:/alias/project' ? canonical : input, entries: [] });
  const reads: Array<{ input: string; complete: (result: any) => void }> = [];
  api.workspaceRead.mockImplementation(input => new Promise(resolve => { reads.push({ input, complete: resolve }); }));
  const context = { path: requested };
  const view = render(<WorkspaceShell open onClose={jest.fn()} navContext={context} />);
  // Complete the disk read only after the parent root has committed. The old
  // bootstrap began this read with an empty root and discarded its result.
  await waitFor(() => expect(screen.getByTestId('explorer-root')).toHaveTextContent(canonical));
  await waitFor(() => expect(api.workspaceRead).toHaveBeenCalledWith(requested));
  await act(async () => { for (const read of reads) read.complete({ success: true, path: read.input === requested ? `${canonical}/hello.ts` : read.input, content: 'requested handoff bytes', version: 'handoff-v1', language: 'typescript' }); });
  expect(await screen.findByLabelText('Code editor')).toHaveValue('requested handoff bytes');
  expect(screen.getByTestId('explorer-root')).toHaveTextContent(canonical);
  expect(screen.getByTestId('terminal-root')).toHaveTextContent(canonical);
  expect(api.workspaceRecoveryLoad).toHaveBeenCalledWith(canonical);
  expect(api.workspaceRead).toHaveBeenCalledWith(requested);
  fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'edited handoff' } });
  fireEvent.click(screen.getByText('Save editor'));
  await waitFor(() => expect(api.workspaceSave).toHaveBeenCalledWith(`${canonical}/hello.ts`, 'edited handoff', expect.objectContaining({ expectedVersion: 'handoff-v1' })));
  const count = api.workspaceRead.mock.calls.length;
  view.rerender(<WorkspaceShell open={false} onClose={jest.fn()} navContext={context} />);
  view.rerender(<WorkspaceShell open onClose={jest.fn()} navContext={context} />);
  expect(await screen.findByLabelText('Code editor')).toHaveValue('edited handoff');
  expect(api.workspaceRead.mock.calls.length).toBe(count);
});
test('an outside-project handoff preserves A then recovers edited B after a restart under B', async () => {
  const api = setup(); const onClose = jest.fn(); const stored = new Map<string, any>();
  api.workspaceRecoverySave.mockImplementation(async (root, state) => { stored.set(root, JSON.parse(JSON.stringify({ ...state, schema: 1 }))); return { success: true }; });
  api.workspaceRecoveryLoad.mockImplementation(async root => ({ success: true, state: stored.get(root) || null }));
  const view = render(<WorkspaceShell open onClose={onClose} navContext={{ path: 'C:/first/a.ts' }} />);
  expect(await screen.findByLabelText('Code editor')).toHaveValue('disk:C:/first/a.ts');
  fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'first project unsaved draft' } });
  view.rerender(<WorkspaceShell open onClose={onClose} navContext={{ path: 'C:/second/b.ts' }} />);
  await screen.findByRole('alertdialog', { name: 'Switch projects and keep drafts?' });
  expect(api.workspaceRead).not.toHaveBeenCalledWith('C:/second/b.ts');
  expect(screen.getByLabelText('Code editor')).toHaveValue('first project unsaved draft');
  fireEvent.click(screen.getByRole('button', { name: 'Keep drafts and switch' }));
  await waitFor(() => expect(screen.getByLabelText('Code editor')).toHaveValue('disk:C:/second/b.ts'));
  expect(screen.getByTestId('explorer-root')).toHaveTextContent('C:/second');
  expect(screen.getByTestId('terminal-root')).toHaveTextContent('C:/second');
  expect(stored.get('C:/first').files[0].content).toBe('first project unsaved draft');
  fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'second project unsaved draft' } });
  await waitFor(() => expect(stored.get('C:/second')?.files.some((f: any) => f.path === 'C:/second/b.ts' && f.content === 'second project unsaved draft')).toBe(true));
  expect(stored.get('C:/second').files.every((f: any) => f.path.startsWith('C:/second/'))).toBe(true);
  view.unmount();
  render(<WorkspaceShell open onClose={onClose} navContext={{ path: 'C:/second/b.ts' }} />);
  expect(await screen.findByLabelText('Code editor')).toHaveValue('second project unsaved draft');
  expect(api.workspaceRecoveryLoad).toHaveBeenCalledWith('C:/second');
  fireEvent.change(screen.getByLabelText('Recent projects'), { target: { value: 'C:/first' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Keep drafts and switch' }));
  await waitFor(() => expect(screen.getByLabelText('Code editor')).toHaveValue('first project unsaved draft'));
  expect(screen.getByTestId('explorer-root')).toHaveTextContent('C:/first');
  expect(api.workspaceSave).not.toHaveBeenCalled();
});
test('cancelled outside-project handoff leaves A draft and never opens B outside its recovery root', async () => {
  const api = setup(); const view = render(<WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:/first/a.ts' }} />);
  await screen.findByLabelText('Code editor');
  fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'keep A dirty' } });
  view.rerender(<WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:/second/b.ts' }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(screen.getByTestId('explorer-root')).toHaveTextContent('C:/first');
  expect(screen.getByLabelText('Code editor')).toHaveValue('keep A dirty');
  expect(api.workspaceRead).not.toHaveBeenCalledWith('C:/second/b.ts');
});
test('an untrusted handoff parent cannot replace the active root or read its file', async () => {
  const api = setup(); const view = render(<WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:/first/a.ts' }} />);
  await screen.findByLabelText('Code editor');
  api.workspaceList.mockImplementation(async input => input.startsWith('C:/denied') ? { success: false, error: 'Folder access denied.' } : { success: true, path: input, entries: [] });
  view.rerender(<WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:/denied/b.ts' }} />);
  await screen.findByText('Folder access denied.');
  expect(screen.getByTestId('explorer-root')).toHaveTextContent('C:/first');
  expect(api.workspaceRead).not.toHaveBeenCalledWith('C:/denied/b.ts');
});
test('late parent validation from an obsolete handoff cannot retarget the newer handoff', async () => {
  const api = setup(); let release!: (result: any) => void;
  const view = render(<WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:/first/a.ts' }} />);
  await screen.findByLabelText('Code editor');
  api.workspaceList.mockImplementation(async input => input === 'C:/second' ? new Promise(resolve => { release = resolve; }) : /\.ts$/.test(input) ? { success: false } : { success: true, path: input, entries: [] });
  view.rerender(<WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:/second/b.ts' }} />);
  await waitFor(() => expect(release).toBeDefined());
  view.rerender(<WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:/first/new.ts' }} />);
  await waitFor(() => expect(screen.getByLabelText('Code editor')).toHaveValue('disk:C:/first/new.ts'));
  await act(async () => release({ success: true, path: 'C:/second', entries: [] }));
  expect(screen.getByTestId('explorer-root')).toHaveTextContent('C:/first');
  expect(api.workspaceRead).not.toHaveBeenCalledWith('C:/second/b.ts');
});
test('a read canonicalized outside the active root cannot create an unrecoverable tab', async () => {
  const api = setup();
  api.workspaceRead.mockResolvedValue({ success: true, path: 'C:/second/b.ts', content: 'outside draft', version: 'b-v1', language: 'typescript' });
  render(<WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:/first/a.ts' }} />);
  await screen.findByText('Open this file’s project first so its drafts can be recovered.');
  expect(screen.queryByLabelText('Code editor')).not.toBeInTheDocument();
  expect(api.workspaceSave).not.toHaveBeenCalled();
});
test('a fresh handoff waits for saved draft recovery before reading the same target', async () => {
  const api = setup(); let finish!: (result: any) => void;
  api.workspaceRecoveryLoad.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:/first/a.ts' }} />);
  await waitFor(() => expect(api.workspaceRecoveryLoad).toHaveBeenCalledWith('C:/first'));
  expect(api.workspaceRead).not.toHaveBeenCalled();
  await act(async () => finish({ success: true, state: { schema: 1, activePath: 'C:/first/a.ts', files: [{ path: 'C:/first/a.ts', content: 'recovered dirty draft', original: 'older disk', version: 'old-v1', language: 'typescript' }] } }));
  expect(await screen.findByLabelText('Code editor')).toHaveValue('recovered dirty draft');
  expect(screen.getByText('This file changed on disk. Your draft is preserved.')).toBeInTheDocument();
  expect(api.workspaceSave).not.toHaveBeenCalled();
});
test('a handoff read completing after an explicit project switch cannot add or save old-root bytes', async () => {
  const api = setup(); let finish!: (result: any) => void;
  api.workspaceRead.mockImplementation(async input => input === 'C:/first/a.ts' ? new Promise(resolve => { finish = resolve; }) : { success: true, path: input, content: 'new project bytes', version: 'new-v1', language: 'typescript' });
  const onClose = jest.fn(); const view = render(<WorkspaceShell open onClose={onClose} navContext={{ path: 'C:/first/a.ts' }} />);
  await waitFor(() => expect(api.workspaceRead).toHaveBeenCalledWith('C:/first/a.ts'));
  await screen.findByRole('option', { name: 'C:/second' });
  fireEvent.change(screen.getByLabelText('Recent projects'), { target: { value: 'C:/second' } });
  await waitFor(() => expect(screen.getByTestId('explorer-root')).toHaveTextContent('C:/second'));
  await act(async () => finish({ success: true, path: 'C:/first/a.ts', content: 'late old-root bytes', version: 'late-v1', language: 'typescript' }));
  expect(screen.queryByRole('tab', { name: /a\.ts/ })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('late old-root bytes')).not.toBeInTheDocument();
  expect(api.workspaceSave).not.toHaveBeenCalled();
  view.rerender(<WorkspaceShell open onClose={onClose} navContext={{ path: 'C:/second/b.ts' }} />);
  expect(await screen.findByLabelText('Code editor')).toHaveValue('new project bytes');
  fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: 'new project draft' } });
  fireEvent.click(screen.getByText('Save editor'));
  await waitFor(() => expect(api.workspaceSave).toHaveBeenCalledWith('C:/second/b.ts', 'new project draft', expect.objectContaining({ expectedVersion: 'new-v1' })));
  expect(api.workspaceSave.mock.calls.some(([input]) => input === 'C:/first/a.ts')).toBe(false);
});
