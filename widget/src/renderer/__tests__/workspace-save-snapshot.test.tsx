/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import WorkspaceShell from '../components/workspace/WorkspaceShell';

jest.mock('../components/workspace/FileTree', () => ({
  __esModule: true,
  default: ({ onOpenFile }: { onOpenFile: (path: string) => void }) => (
    <button onClick={() => onOpenFile('C:/project/example.ts')}>Open example</button>
  ),
}));
jest.mock('../components/workspace/CodeEditor', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (text: string) => void }) => (
    <textarea aria-label="Code editor" value={value} onChange={event => onChange(event.target.value)} />
  ),
}));
jest.mock('../components/TerminalPanel', () => ({ __esModule: true, default: () => null }));

async function openWorkspace() {
  let finishSave!: (result: { success: boolean; error?: string }) => void;
  let disk = 'original';
  const workspaceSave = jest.fn((_path: string, content: string) => new Promise(resolve => {
    finishSave = result => { if (result.success) disk = content; resolve(result); };
  }));
  (window as any).electron = {
    workspaceRoot: async () => ({ path: 'C:/project' }),
    workspaceRead: async () => ({ success: true, content: disk, language: 'typescript' }),
    workspaceSave,
    onAssistantToolActivity: () => () => undefined,
  };
  render(<WorkspaceShell open onClose={jest.fn()} />);
  fireEvent.click(await screen.findByText('Open example'));
  await screen.findByRole('textbox', { name: 'Code editor' });
  return { workspaceSave, finishSave: (result: { success: boolean; error?: string }) => finishSave(result), disk: () => disk };
}

const edit = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Code editor' }), { target: { value: text } });
const save = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

test('typing while Save is pending keeps newer text unsaved until a second save', async () => {
  const pending = await openWorkspace();
  edit('saved snapshot');
  save();
  expect(pending.workspaceSave).toHaveBeenCalledWith('C:/project/example.ts', 'saved snapshot');
  edit('newer unsaved text');
  await act(async () => pending.finishSave({ success: true }));
  expect(pending.disk()).toBe('saved snapshot');
  expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue('newer unsaved text');
  expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close example.ts' }));
  expect(screen.getByRole('button', { name: 'Close without saving' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  save();
  await act(async () => pending.finishSave({ success: true }));
  expect(pending.disk()).toBe('newer unsaved text');
  expect(screen.queryByLabelText('Unsaved changes')).not.toBeInTheDocument();
});

test('successful save without intervening edits clears the dirty marker', async () => {
  const pending = await openWorkspace();
  edit('saved text');
  save();
  await act(async () => pending.finishSave({ success: true }));
  expect(pending.disk()).toBe('saved text');
  expect(screen.queryByLabelText('Unsaved changes')).not.toBeInTheDocument();
});

test('failed save preserves the old disk text and newer unsaved edit', async () => {
  const pending = await openWorkspace();
  edit('snapshot');
  save();
  edit('newer text');
  await act(async () => pending.finishSave({ success: false, error: 'Disk write failed.' }));
  expect(pending.disk()).toBe('original');
  expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
  expect(screen.getByText('Disk write failed.')).toBeInTheDocument();
});
