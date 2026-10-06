/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceShell from '../components/workspace/WorkspaceShell';
jest.mock('../components/workspace/FileTree', () => ({ __esModule: true, default: ({ onOpenFile }: any) => <button onClick={() => onOpenFile('C:/project/example.ts')}>Open example</button> }));
jest.mock('../components/workspace/CodeEditor', () => ({ __esModule: true, default: ({ value, onChange }: any) => <textarea aria-label="Code editor" value={value} onChange={e => onChange(e.target.value)} /> }));
jest.mock('../components/TerminalPanel', () => ({ __esModule: true, default: ({ projectPath }: any) => <div data-testid="terminal-root">{projectPath}</div> }));

function setup(recovery: any = null) {
  let disk = 'original';
  let version = 'v1';
  const workspaceSave = jest.fn(async (_file, content, options) => {
    if (options.expectedVersion !== version) return { success: false, conflict: true, disk: { content: disk, version, eol: 'lf', bom: false }, error: 'File changed on disk.' };
    disk = content; version = 'saved'; return { success: true, version, eol: 'lf', bom: false };
  });
  const workspaceRecoverySave = jest.fn(async () => ({ success: true }));
  const workspaceFileAction = jest.fn(async () => ({ success: true }));
  (window as any).electron = {
    workspaceRoot: async () => ({ success: true, path: 'C:/project' }),
    workspaceList: async (path: string) => ({ success: true, path, entries: [] }),
    workspaceRead: async () => ({ success: true, content: disk, version, eol: 'lf', bom: false, language: 'typescript' }),
    workspaceSave, workspaceRecoverySave, workspaceFileAction,
    workspaceRecoveryLoad: async () => ({ success: true, state: recovery }),
    workspaceRecentProjects: async () => ({ success: true, paths: ['C:/project', 'C:/other'] }),
    onAssistantToolActivity: () => () => undefined,
  };
  render(<WorkspaceShell open onClose={jest.fn()} />);
  return { workspaceSave, workspaceRecoverySave, workspaceFileAction, external: (text: string) => { disk = text; version = text; }, disk: () => disk };
}
const edit = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Code editor' }), { target: { value: text } });
async function openFile() { fireEvent.click(await screen.findByText('Open example')); await screen.findByRole('textbox', { name: 'Code editor' }); }

test('Save preserves newer disk bytes and draft, Compare shows both, reviewed replacement is explicit', async () => {
  const app = setup(); await openFile(); edit('my draft'); app.external('external edit');
  fireEvent.keyDown(window, { ctrlKey: true, key: 's' });
  await screen.findByText('This file changed on disk. Your draft is preserved.');
  expect(app.disk()).toBe('external edit'); expect(screen.getByLabelText('Code editor')).toHaveValue('my draft');
  fireEvent.click(screen.getByText('Compare'));
  expect(screen.getByLabelText('Current disk version')).toHaveValue('external edit');
  expect(screen.getByLabelText('Unsaved draft')).toHaveValue('my draft');
  fireEvent.click(screen.getByText('Keep draft and close'));
  fireEvent.click(screen.getByText('Replace disk')); expect(app.disk()).toBe('external edit');
  fireEvent.click(screen.getByText('Replace reviewed disk version'));
  await waitFor(() => expect(app.disk()).toBe('my draft'));
  expect(app.workspaceSave).toHaveBeenLastCalledWith('C:/project/example.ts', 'my draft', { expectedVersion: 'external edit', eol: 'lf', bom: false });
});

test('refresh updates a clean buffer while a dirty buffer keeps both versions', async () => {
  const app = setup(); await openFile(); app.external('clean external'); fireEvent.click(screen.getByText('Refresh'));
  await waitFor(() => expect(screen.getByLabelText('Code editor')).toHaveValue('clean external'));
  edit('dirty buffer'); app.external('another external'); fireEvent.click(screen.getByText('Refresh'));
  await screen.findByText('This file changed on disk. Your draft is preserved.');
  expect(screen.getByLabelText('Code editor')).toHaveValue('dirty buffer'); expect(app.disk()).toBe('another external');
});

test('restart recovery restores drafts and marks an external disk conflict', async () => {
  setup({ schema: 1, activePath: 'C:/project/example.ts', files: [{ path: 'C:/project/example.ts', content: 'recovered draft', original: 'earlier disk', version: 'older', language: 'typescript' }] });
  expect(await screen.findByLabelText('Code editor')).toHaveValue('recovered draft');
  expect(screen.getByText('This file changed on disk. Your draft is preserved.')).toBeInTheDocument();
  expect(screen.getByTestId('terminal-root')).toHaveTextContent('C:/project');
});

test('switching projects explicitly preserves dirty drafts before clearing tabs', async () => {
  const app = setup(); await openFile(); edit('keep across projects');
  await waitFor(() => expect(screen.getByRole('option', { name: 'C:/other' })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Recent projects'), { target: { value: 'C:/other' } });
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(screen.getByLabelText('Code editor')).toHaveValue('keep across projects');
  fireEvent.click(screen.getByText('Keep drafts and switch'));
  await waitFor(() => expect(screen.getByTestId('terminal-root')).toHaveTextContent('C:/other'));
  expect(app.workspaceRecoverySave).toHaveBeenCalledWith('C:/project', expect.objectContaining({ files: expect.arrayContaining([expect.objectContaining({ content: 'keep across projects' })]) }));
});
