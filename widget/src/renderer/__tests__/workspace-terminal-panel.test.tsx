/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
const emulators: any[] = [];
jest.mock('@xterm/xterm', () => ({ Terminal: class {
  textarea?: HTMLTextAreaElement;
  write = jest.fn(); open = jest.fn((host: HTMLElement) => { this.textarea = document.createElement('textarea'); this.textarea.className = 'xterm-helper-textarea'; host.append(this.textarea); });
  loadAddon = jest.fn(); focus = jest.fn(() => this.textarea?.focus()); dispose = jest.fn(); input!: (data: string) => void;
  constructor() { emulators.push(this); }
  onData(fn: (data: string) => void) { this.input = fn; return { dispose: jest.fn() }; }
  resize!: (size: { cols: number; rows: number }) => void;
  onResize(fn: (size: { cols: number; rows: number }) => void) { this.resize = fn; return { dispose: jest.fn() }; }
} }));
jest.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = jest.fn(); } }));
import WorkspaceTerminalPanel from '../components/workspace/WorkspaceTerminalPanel';
beforeEach(() => { emulators.length = 0; (global as any).ResizeObserver = class { observe() {} disconnect() {} }; });
test('interactive tabs route stdin/interrupt, avoid replaying startup output, and close all owned sessions', async () => {
  let listener!: (event: any) => void; let serial = 0;
  const write = jest.fn(async () => ({ success: true })); const close = jest.fn(async () => ({ success: true })); const interrupt = jest.fn(async () => ({ success: true }));
  (window as any).electron = {
    workspaceTerminalProfiles: async () => ({ success: true, profiles: [{ id: 'cmd', label: 'Command Prompt', executable: 'cmd.exe' }] }),
    workspaceTerminalCreate: async () => { const id = `s${++serial}`; listener({ sessionId: id, seq: 1, type: 'data', data: 'old startup' }); return { success: true, session: { sessionId: id, profileId: 'cmd', cwd: 'C:/project', pid: 42, seq: 1, output: 'startup' } }; },
    workspaceTerminalWrite: write, workspaceTerminalClose: close, workspaceTerminalInterrupt: interrupt,
    workspaceTerminalResize: async () => ({ success: true }), onWorkspaceTerminalEvent: (fn: any) => { listener = fn; return jest.fn(); },
  };
  const view = render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  await screen.findByRole('tab', { name: '1: cmd' }); await waitFor(() => expect(emulators).toHaveLength(1));
  expect(emulators[0].write.mock.calls).toEqual([['startup']]);
  expect(emulators[0].focus).not.toHaveBeenCalled();
  act(() => emulators[0].input('answer\r'));
  expect(write).toHaveBeenCalledWith({ sessionId: 's1', data: 'answer\r' });
  fireEvent.click(screen.getByText('Interrupt (Ctrl+C)')); expect(interrupt).toHaveBeenCalledWith({ sessionId: 's1' });
  fireEvent.click(screen.getByText('New terminal')); await screen.findByRole('tab', { name: '2: cmd' });
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(emulators[1].focus).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(emulators[1].textarea);
  fireEvent.click(screen.getByRole('tab', { name: '1: cmd' }));
  expect(document.activeElement).toBe(emulators[0].textarea);
  fireEvent.click(screen.getByRole('tab', { name: '1: cmd' }));
  expect(emulators[0].focus).toHaveBeenCalledTimes(2);
  view.unmount(); expect(close).toHaveBeenCalledWith({ sessionId: 's1' }); expect(close).toHaveBeenCalledWith({ sessionId: 's2' });
});

test('late automatic startup preserves header focus and passive tab changes do not reclaim focus', async () => {
  let complete!: (result: any) => void;
  const create = jest.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
    .mockResolvedValue({ success: true, session: { sessionId: 's2', profileId: 'cmd', cwd: 'C:/project', pid: 43, seq: 0, output: '' } });
  (window as any).electron = {
    workspaceTerminalProfiles: async () => ({ success: true, profiles: [{ id: 'cmd', label: 'Command Prompt' }] }),
    workspaceTerminalCreate: create, workspaceTerminalClose: async () => ({ success: true }),
  };
  render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const header = screen.getByLabelText('Close terminal panel'); header.focus();
  await act(async () => complete({ success: true, session: { sessionId: 's1', profileId: 'cmd', cwd: 'C:/project', pid: 42, seq: 0, output: '' } }));
  expect(document.activeElement).toBe(header);
  expect(emulators[0].focus).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: '1: cmd' }));
  expect(document.activeElement).toBe(emulators[0].textarea);
  fireEvent.click(screen.getByText('New terminal')); await screen.findByRole('tab', { name: '2: cmd' });
  header.focus();
  fireEvent.click(screen.getByLabelText('Close terminal 2'));
  await waitFor(() => expect(screen.queryByRole('tab', { name: '2: cmd' })).not.toBeInTheDocument());
  expect(document.activeElement).toBe(header);
  expect(emulators[0].focus).toHaveBeenCalledTimes(1);
});

test('profile bootstrap transport rejection is visible and never creates a session', async () => {
  const create = jest.fn();
  (window as any).electron = { workspaceTerminalProfiles: jest.fn().mockRejectedValue(new Error('profiles disconnected')), workspaceTerminalCreate: create };
  render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('profiles disconnected');
  expect(create).not.toHaveBeenCalled();
});

test('input, resize, interrupt and close transport errors remain retryable', async () => {
  (window as any).electron = {
    workspaceTerminalProfiles: async () => ({ success: true, profiles: [{ id: 'cmd', label: 'Command Prompt', executable: 'cmd.exe' }] }),
    workspaceTerminalCreate: async () => ({ success: true, session: { sessionId: 's1', profileId: 'cmd', cwd: 'C:/project', pid: 42, seq: 0, output: '' } }),
    workspaceTerminalWrite: jest.fn().mockRejectedValue(new Error('input disconnected')),
    workspaceTerminalResize: jest.fn().mockRejectedValue(new Error('resize disconnected')),
    workspaceTerminalInterrupt: jest.fn().mockRejectedValue(new Error('interrupt disconnected')),
    workspaceTerminalClose: jest.fn().mockRejectedValue(new Error('close disconnected')),
  };
  const view = render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  await screen.findByRole('tab', { name: '1: cmd' });
  act(() => emulators[0].input('x')); expect(await screen.findByRole('alert')).toHaveTextContent('input disconnected');
  act(() => emulators[0].resize({ cols: 100, rows: 30 })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('resize disconnected'));
  fireEvent.click(screen.getByText('Interrupt (Ctrl+C)')); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('interrupt disconnected'));
  fireEvent.click(screen.getByLabelText('Close terminal 1')); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('close disconnected'));
  expect(screen.getByRole('tab', { name: '1: cmd' })).toBeInTheDocument();
  view.unmount(); await act(async () => {});
});

test.each(['live', 'before-create'])('a %s exit cleanup refusal is displayed immediately and retains exact Close retry', async timing => {
  let listener!: (event: any) => void; let complete!: (result: any) => void;
  const close = jest.fn().mockResolvedValueOnce({ success: false, error: 'Job still unverified' }).mockResolvedValueOnce({ success: true });
  (window as any).electron = {
    workspaceTerminalProfiles: async () => ({ success: true, profiles: [{ id: 'cmd', label: 'Command Prompt' }] }),
    workspaceTerminalCreate: () => new Promise(resolve => { complete = resolve; }),
    workspaceTerminalClose: close,
    onWorkspaceTerminalEvent: (fn: any) => { listener = fn; return jest.fn(); },
  };
  render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  await waitFor(() => expect(complete).toBeDefined());
  const ended = { sessionId: 's1', seq: 2, type: 'exit', exitCode: 0, closeError: 'Owned background programs remain. Select Close.' };
  if (timing === 'before-create') act(() => listener(ended));
  await act(async () => complete({ success: true, session: { sessionId: 's1', profileId: 'cmd', cwd: 'C:/project', pid: 42, seq: 0, output: '' } }));
  if (timing === 'live') act(() => listener(ended));
  expect(await screen.findByRole('alert')).toHaveTextContent('Owned background programs remain');
  expect(screen.getByRole('tab', { name: '1: cmd (exited)' })).toBeInTheDocument();
  expect(screen.getByText('Interrupt (Ctrl+C)')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Close terminal 1'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Job still unverified'));
  fireEvent.click(screen.getByLabelText('Close terminal 1'));
  await waitFor(() => expect(screen.queryByRole('tab')).not.toBeInTheDocument());
  expect(close.mock.calls).toEqual([[{ sessionId: 's1' }], [{ sessionId: 's1' }]]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test.each(['refused', 'rejected'])('panel reopen recovers a %s Close with its transcript and retry control', async mode => {
  const retained = { sessionId: 's1', profileId: 'cmd', cwd: 'C:/project', pid: 42, seq: 3, output: 'important output\r\n', closeError: 'Process-tree exit remains unconfirmed' };
  let exists = false;
  const create = jest.fn(async () => { exists = true; return { success: true, session: { ...retained, closeError: undefined } }; });
  const close = jest.fn().mockImplementationOnce(() => mode === 'rejected' ? Promise.reject(Error(retained.closeError)) : Promise.resolve({ success: false, error: retained.closeError }))
    .mockImplementation(async () => { exists = false; return { success: true }; });
  (window as any).electron = {
    workspaceTerminalProfiles: async () => ({ success: true, profiles: [{ id: 'cmd', label: 'Command Prompt' }] }),
    workspaceTerminalList: async ({ projectDir }: any) => ({ success: true, sessions: exists && projectDir === retained.cwd ? [{ ...retained }] : [] }),
    workspaceTerminalCreate: create, workspaceTerminalClose: close,
  };
  const first = render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  await screen.findByRole('tab', { name: '1: cmd' }); first.unmount(); await act(async () => {});
  render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  await screen.findByRole('tab', { name: '1: cmd' });
  expect(create).toHaveBeenCalledTimes(1);
  expect(emulators[1].write).toHaveBeenCalledWith('important output\r\n');
  expect(screen.getByRole('alert')).toHaveTextContent(retained.closeError);
  fireEvent.click(screen.getByLabelText('Close terminal 1'));
  await waitFor(() => expect(screen.queryByRole('tab', { name: '1: cmd' })).not.toBeInTheDocument());
  expect(close).toHaveBeenCalledTimes(2); expect(close).toHaveBeenLastCalledWith({ sessionId: 's1' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a project switch joins a late create before bootstrapping the new project', async () => {
  let complete!: (result: any) => void;
  const create = jest.fn().mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
    .mockResolvedValue({ success: true, session: { sessionId: 's2', profileId: 'cmd', cwd: 'C:/other', pid: 43, seq: 0, output: 'new project' } });
  const list = jest.fn(async () => ({ success: true, sessions: [] }));
  const close = jest.fn(async () => ({ success: true }));
  (window as any).electron = {
    workspaceTerminalProfiles: async () => ({ success: true, profiles: [{ id: 'cmd', label: 'Command Prompt' }] }),
    workspaceTerminalList: list, workspaceTerminalCreate: create, workspaceTerminalClose: close,
  };
  const view = render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  view.rerender(<WorkspaceTerminalPanel projectPath="C:/other" onClose={jest.fn()} />);
  expect(screen.getByText('New terminal')).toBeDisabled(); expect(list).toHaveBeenCalledTimes(1);
  await act(async () => complete({ success: true, session: { sessionId: 's1', profileId: 'cmd', cwd: 'C:/project', pid: 42, seq: 0, output: 'old project' } }));
  await screen.findByRole('tab', { name: '1: cmd' });
  expect(close).toHaveBeenCalledWith({ sessionId: 's1' });
  expect(create).toHaveBeenCalledTimes(2); expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ projectDir: 'C:/other' }));
  expect(emulators).toHaveLength(1); expect(emulators[0].write).toHaveBeenCalledWith('new project');
  expect(emulators[0].write).not.toHaveBeenCalledWith('old project');
});

test('retrying shell profiles preserves an already recovered terminal and its close controls', async () => {
  const retained = { sessionId: 's1', profileId: 'cmd', cwd: 'C:/project', pid: 42, seq: 1, output: 'retained output' };
  const profiles = jest.fn().mockRejectedValueOnce(Error('profiles disconnected')).mockResolvedValue({ success: true, profiles: [{ id: 'cmd', label: 'Command Prompt' }] });
  const close = jest.fn(async () => ({ success: true })); const create = jest.fn();
  (window as any).electron = { workspaceTerminalProfiles: profiles, workspaceTerminalList: async () => ({ success: true, sessions: [retained] }), workspaceTerminalCreate: create, workspaceTerminalClose: close };
  render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  await screen.findByRole('tab', { name: '1: cmd' }); expect(await screen.findByRole('alert')).toHaveTextContent('profiles disconnected');
  expect(screen.queryByText('Retry terminal recovery')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Retry shell profiles'));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(close).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(emulators).toHaveLength(1);
  fireEvent.click(screen.getByLabelText('Close terminal 1'));
  await waitFor(() => expect(screen.queryByRole('tab', { name: '1: cmd' })).not.toBeInTheDocument());
  expect(close).toHaveBeenCalledWith({ sessionId: 's1' });
});

test('a fresh panel instance waits for old startup cleanup before recovering the same project', async () => {
  let complete!: (result: any) => void;
  const old = { sessionId: 'old', profileId: 'cmd', cwd: 'C:/project', pid: 42, seq: 1, output: 'retained startup' };
  let exists = false;
  const create = jest.fn().mockImplementationOnce(() => { exists = true; return new Promise(resolve => { complete = resolve; }); });
  const list = jest.fn(async () => ({ success: true, sessions: exists ? [old] : [] }));
  const close = jest.fn(async () => ({ success: false, error: 'Native exit remains unconfirmed' }));
  (window as any).electron = {
    workspaceTerminalProfiles: async () => ({ success: true, profiles: [{ id: 'cmd', label: 'Command Prompt' }] }),
    workspaceTerminalList: list, workspaceTerminalCreate: create, workspaceTerminalClose: close,
  };
  const first = render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1)); first.unmount();
  render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  expect(screen.getByText('New terminal')).toBeDisabled(); expect(list).toHaveBeenCalledTimes(1);
  await act(async () => complete({ success: true, session: old }));
  await screen.findByRole('tab', { name: '1: cmd' });
  expect(close).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledWith({ sessionId: 'old' });
  expect(create).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledTimes(2);
  expect(emulators).toHaveLength(1); expect(emulators[0].write).toHaveBeenCalledWith('retained startup');
  await act(async () => {}); expect(close).toHaveBeenCalledTimes(1);
});

test('project switches recover only that project and a failed recovery cannot start another shell', async () => {
  const retained = { sessionId: 's1', profileId: 'cmd', cwd: 'C:/project', pid: 42, seq: 1, output: 'old project output' };
  const create = jest.fn();
  const list = jest.fn().mockRejectedValueOnce(Error('recovery disconnected'))
    .mockImplementation(async ({ projectDir }: any) => ({ success: true, sessions: projectDir === retained.cwd ? [retained] : [{ ...retained, sessionId: 's2', cwd: projectDir, output: 'other project output' }] }));
  (window as any).electron = {
    workspaceTerminalProfiles: async () => ({ success: true, profiles: [{ id: 'cmd', label: 'Command Prompt' }] }),
    workspaceTerminalList: list, workspaceTerminalCreate: create, workspaceTerminalClose: async () => ({ success: false, error: 'retained' }),
  };
  const view = render(<WorkspaceTerminalPanel projectPath="C:/project" onClose={jest.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('recovery disconnected');
  expect(screen.getByText('New terminal')).toBeDisabled(); expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Retry terminal recovery'));
  await screen.findByRole('tab', { name: '1: cmd' });
  expect(emulators[0].write).toHaveBeenCalledWith('old project output');
  view.rerender(<WorkspaceTerminalPanel projectPath="C:/other" onClose={jest.fn()} />);
  await waitFor(() => expect(emulators).toHaveLength(2));
  expect(emulators[1].write).toHaveBeenCalledWith('other project output');
  expect(emulators[1].write).not.toHaveBeenCalledWith('old project output');
  expect(list).toHaveBeenLastCalledWith({ projectDir: 'C:/other' }); expect(create).not.toHaveBeenCalled();
});
