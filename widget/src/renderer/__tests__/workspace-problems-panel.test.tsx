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
