/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProblemsPanel from '../components/workspace/ProblemsPanel';

test('runs the selected script and opens a problem at its exact line', async () => {
  const open = jest.fn();
  (window as any).electron = {
    workspaceTaskList: jest.fn(async () => ({ success: true, tasks: [{ name: 'check', command: 'tsc' }] })),
    workspaceTaskRun: jest.fn(async () => ({ success: true, exitCode: 2, problems: [{ path: 'C:\\fixture\\broken.ts', file: 'broken.ts', line: 7, column: 3, severity: 'error', source: 'typescript', code: 'TS2322', message: 'Wrong type' }] })),
  };
  render(<ProblemsPanel root={'C:\\fixture'} onOpenFile={open} />);
  await screen.findByRole('option', { name: 'check' });
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  fireEvent.click(await screen.findByText('Wrong type'));
  expect(window.electron.workspaceTaskRun).toHaveBeenCalledWith(expect.objectContaining({ projectDir: 'C:\\fixture', scriptName: 'check', taskId: expect.any(String), longRunning: false }));
  expect(open).toHaveBeenCalledWith('C:\\fixture\\broken.ts', 7);
  await waitFor(() => expect(screen.getByText(/broken.ts:7:3/)).toBeInTheDocument());
});

test('shows an IPC failure and allows the selected task to be retried', async () => {
  const run = jest.fn()
    .mockRejectedValueOnce(new Error('Fixture IPC failure'))
    .mockResolvedValueOnce({ success: true, exitCode: 0, problems: [] });
  (window as any).electron = {
    workspaceTaskList: jest.fn(async () => ({ success: true, tasks: [{ name: 'check', command: 'tsc' }] })),
    workspaceTaskRun: run,
  };
  render(<ProblemsPanel root={'C:\\fixture'} onOpenFile={jest.fn()} />);
  await screen.findByRole('option', { name: 'check' });
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not run the package task');
  expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('late restored status cannot replace a newly submitted watch task and Stop rejection is visible', async () => {
  let restore!: (value: any) => void;
  const run = jest.fn((_request: any) => new Promise(() => {}));
  (window as any).electron = {
    workspaceTaskList: async () => ({ success: true, tasks: [{ name: 'dev', command: 'watch' }] }),
    workspaceTaskStatus: () => new Promise(resolve => { restore = resolve; }),
    workspaceTaskRun: run, workspaceTaskStop: jest.fn().mockRejectedValue(new Error('disconnected')),
  };
  render(<ProblemsPanel root="C:/fixture" onOpenFile={jest.fn()} />);
  await screen.findByRole('option', { name: 'dev' }); fireEvent.click(screen.getByText('Run'));
  await act(async () => restore({ task: { projectDir: 'C:/fixture', taskId: 'old', scriptName: 'check', running: false } }));
  expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled();
  fireEvent.click(screen.getByText('Stop'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not stop this task');
  expect((window as any).electron.workspaceTaskStop).toHaveBeenCalledWith({ taskId: run.mock.calls[0][0].taskId });
});

test('live task output is shown before completion and Stop targets its current ID', async () => {
  let listener!: (event: any) => void; let finish!: (value: any) => void;
  const run = jest.fn((_request: any) => new Promise(resolve => { finish = resolve; })); const stop = jest.fn(async () => ({ success: true }));
  (window as any).electron = { workspaceTaskList: async () => ({ success: true, tasks: [{ name: 'dev', command: 'watch' }] }), workspaceTaskRun: run, workspaceTaskStop: stop, onWorkspaceTaskEvent: (fn: any) => { listener = fn; return jest.fn(); } };
  render(<ProblemsPanel root="C:/fixture" onOpenFile={jest.fn()} />);
  await screen.findByRole('option', { name: 'dev' }); fireEvent.click(screen.getByLabelText('Watch or dev server (runs until Stop)')); fireEvent.click(screen.getByText('Run'));
  const request = run.mock.calls[0][0] as any;
  act(() => listener({ projectDir: 'C:/fixture', taskId: request.taskId, scriptName: 'dev', running: true, outputExcerpt: 'server listening', problems: [] }));
  expect(screen.getByLabelText('Task output')).toHaveTextContent('server listening');
  fireEvent.click(screen.getByText('Stop')); expect(stop).toHaveBeenCalledWith({ taskId: request.taskId });
  await act(async () => finish({ success: false, cancelled: true }));
});

test('completed background cleanup restores reachable Stop and refuses Run until the same task retry succeeds', async () => {
  const stop = jest.fn().mockResolvedValueOnce({ success: false, error: 'Job state unknown' }).mockResolvedValueOnce({ success: true });
  (window as any).electron = {
    workspaceTaskList: async () => ({ success: true, tasks: [{ name: 'dev', command: 'watch' }] }),
    workspaceTaskStatus: async () => ({ task: { projectDir: 'C:/fixture', taskId: 'retained-job', scriptName: 'dev', running: false, cleanupPending: true, result: { cleanupPending: true, error: 'Background programs remain' } } }),
    workspaceTaskStop: stop,
  };
  render(<ProblemsPanel root="C:/fixture" onOpenFile={jest.fn()} />);
  await screen.findByRole('button', { name: 'Stop' });
  expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Job state unknown'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument());
  expect(stop.mock.calls).toEqual([[{ taskId: 'retained-job' }], [{ taskId: 'retained-job' }]]);
  expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('late old-project Stop refusal cannot alter the new project or retain its cleanup button', async () => {
  let reject!: (error: Error) => void;
  (window as any).electron = {
    workspaceTaskList: async () => ({ success: true, tasks: [{ name: 'check', command: 'check' }] }),
    workspaceTaskStatus: async ({ projectDir }: { projectDir: string }) => ({ task: projectDir === 'C:/old' ? { projectDir, taskId: 'old-job', scriptName: 'check', running: false, cleanupPending: true } : null }),
    workspaceTaskStop: () => new Promise((_resolve, failure) => { reject = failure; }),
  };
  const view = render(<ProblemsPanel root="C:/old" onOpenFile={jest.fn()} />); await screen.findByRole('button', { name: 'Stop' });
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  view.rerender(<ProblemsPanel root="C:/new" onOpenFile={jest.fn()} />);
  await act(async () => reject(new Error('old refusal')));
  expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
});
