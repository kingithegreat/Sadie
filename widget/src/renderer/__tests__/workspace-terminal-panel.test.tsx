/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
const emulators: any[] = [];
jest.mock('@xterm/xterm', () => ({ Terminal: class {
  write = jest.fn(); open = jest.fn(); loadAddon = jest.fn(); focus = jest.fn(); dispose = jest.fn(); input!: (data: string) => void;
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
  act(() => emulators[0].input('answer\r'));
  expect(write).toHaveBeenCalledWith({ sessionId: 's1', data: 'answer\r' });
  fireEvent.click(screen.getByText('Interrupt (Ctrl+C)')); expect(interrupt).toHaveBeenCalledWith({ sessionId: 's1' });
  fireEvent.click(screen.getByText('New terminal')); await screen.findByRole('tab', { name: '2: cmd' });
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  view.unmount(); expect(close).toHaveBeenCalledWith({ sessionId: 's1' }); expect(close).toHaveBeenCalledWith({ sessionId: 's2' });
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
