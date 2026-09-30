/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  expect(window.electron.workspaceTaskRun).toHaveBeenCalledWith({ projectDir: 'C:\\fixture', scriptName: 'check' });
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
