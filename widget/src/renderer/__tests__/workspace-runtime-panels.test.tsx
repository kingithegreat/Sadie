/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import SourceControlPanel from '../components/workspace/SourceControlPanel';
import DebuggerPanel from '../components/workspace/DebuggerPanel';
import WorkspaceTestsPanel from '../components/workspace/WorkspaceTestsPanel';
test('Git diff and hunk controls send exact reviewed diff; failed action remains visible after refresh', async () => {
  const workspaceGitAction = jest.fn().mockResolvedValueOnce({ success: true, diff: 'reviewed patch', hunks: [{ index: 0, header: '@@ one @@', patch: 'reviewed patch' }] }).mockResolvedValueOnce({ success: false, error: 'The diff changed.' });
  (window as any).electron = { workspaceGitStatus: jest.fn().mockResolvedValue({ success: true, isRepo: true, root: '/project', branch: 'main', staged: [], unstaged: [{ path: 'main.js', kind: 'modified' }] }), workspaceGitBranches: jest.fn().mockResolvedValue({ success: true, branches: ['main'] }), workspaceGitAction };
  await act(async () => render(<SourceControlPanel folder="/project" onOpenFile={jest.fn()} />));
  await act(async () => fireEvent.click(screen.getByLabelText('Diff main.js')));
  expect(screen.getByText('reviewed patch')).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByText('Stage this hunk')));
  expect(workspaceGitAction).toHaveBeenLastCalledWith({ folder: '/project', action: 'stage-hunk', file: 'main.js', hunk: 0, expectedDiff: 'reviewed patch' });
  expect(screen.getByRole('alert')).toHaveTextContent('The diff changed.');
});
test('Git branch, network and conflict controls route actual explicit actions and reconciliation callback', async () => {
  const workspaceGitAction = jest.fn().mockResolvedValue({ success: true }); const changed = jest.fn();
  (window as any).electron = { workspaceGitStatus: jest.fn().mockResolvedValue({ success: true, isRepo: true, root: '/project', branch: 'main', staged: [], unstaged: [] }), workspaceGitBranches: jest.fn().mockResolvedValue({ success: true, branches: ['main'] }), workspaceGitAction };
  await act(async () => render(<SourceControlPanel folder="/project" onOpenFile={jest.fn()} onFilesChanged={changed} />));
  fireEvent.change(screen.getByLabelText('New branch name'), { target: { value: 'feature/new' } });
  await act(async () => fireEvent.click(screen.getByText('Create branch')));
  expect(workspaceGitAction).toHaveBeenCalledWith({ folder: '/project', action: 'create-branch', branch: 'feature/new' }); expect(changed).toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByText('push'))); expect(workspaceGitAction).toHaveBeenLastCalledWith({ folder: '/project', action: 'push' });
});
test('debug toolbar, breakpoints, call frames, variables and watch expressions reach the backend', async () => {
  const result = { success: true, running: true, paused: true, frames: [{ id: 'frame', name: 'main', path: '/project/main.js', line: 3, column: 1 }], breakpoints: [] };
  const workspaceDebug = jest.fn().mockResolvedValue(result); const open = jest.fn();
  (window as any).electron = { workspaceDebug };
  await act(async () => render(<DebuggerPanel root="/project" activePath="/project/main.js" onOpenFile={open} />));
  await act(async () => fireEvent.click(screen.getByText('step over'))); expect(workspaceDebug).toHaveBeenCalledWith({ root: '/project', action: 'step-over' });
  await act(async () => fireEvent.click(screen.getByText('Add breakpoint'))); expect(workspaceDebug).toHaveBeenCalledWith({ root: '/project', action: 'breakpoint', file: '/project/main.js', line: 1 });
  fireEvent.click(screen.getByText('main — /project/main.js:3')); expect(open).toHaveBeenCalledWith('/project/main.js', 3);
  fireEvent.change(screen.getByLabelText('Watch expression'), { target: { value: 'count' } });
  await act(async () => fireEvent.click(screen.getByText('Evaluate watch'))); expect(workspaceDebug).toHaveBeenCalledWith({ root: '/project', action: 'evaluate', frameId: 'frame', expression: 'count' });
});
test('test discovery rows open source and run one named test with coverage, with a real Stop route', async () => {
  const workspaceTests = jest.fn().mockImplementation(async ({ action }: { action: string }) => action === 'list' ? { success: true, tests: [{ path: '/project/math.test.js', name: 'adds', line: 8, runner: 'node' }] } : { success: true, running: true, output: 'actual output' });
  const open = jest.fn(); (window as any).electron = { workspaceTests };
  await act(async () => render(<WorkspaceTestsPanel root="/project" onOpenFile={open} />));
  fireEvent.click(screen.getByText('adds')); expect(open).toHaveBeenCalledWith('/project/math.test.js', 8);
  fireEvent.click(screen.getByLabelText(/Collect coverage/));
  await act(async () => fireEvent.click(screen.getByText('Run test'))); expect(workspaceTests).toHaveBeenCalledWith({ root: '/project', action: 'run', file: '/project/math.test.js', testName: 'adds', coverage: true });
  await act(async () => fireEvent.click(screen.getByText('Stop tests'))); expect(workspaceTests).toHaveBeenCalledWith({ root: '/project', action: 'stop' });
});
test('a late watch result from the previous project never appears in the new debugger', async () => {
  let finish: (value: any) => void = () => {};
  (window as any).electron = { workspaceDebug: jest.fn(({ action }: { action: string }) => action === 'evaluate' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ success: true, running: true, paused: true, frames: [], breakpoints: [] })) };
  const page = render(<DebuggerPanel root="/project-a" onOpenFile={jest.fn()} />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Watch expression'), { target: { value: 'privateA' } });
  fireEvent.click(screen.getByText('Evaluate watch'));
  await act(async () => page.rerender(<DebuggerPanel root="/project-b" onOpenFile={jest.fn()} />));
  await act(async () => finish({ success: true, running: true, paused: true, value: 'OLD PROJECT RESULT' }));
  expect(screen.queryByText('OLD PROJECT RESULT')).not.toBeInTheDocument();
});
test('test runner transport rejection is visible and controls recover', async () => {
  (window as any).electron = { workspaceTests: jest.fn().mockRejectedValue(new Error('Test service disconnected')) };
  await act(async () => render(<WorkspaceTestsPanel root="/project" onOpenFile={jest.fn()} />));
  expect(screen.getByRole('alert')).toHaveTextContent('Test service disconnected'); expect(screen.getByText('Refresh tests')).not.toBeDisabled();
});
test('Debug test file starts the actual Node debugger and opens its panel after approval succeeds', async () => {
  const workspaceDebug = jest.fn().mockResolvedValue({ success: true, running: true, paused: true }); const openDebugger = jest.fn();
  (window as any).electron = { workspaceDebug, workspaceTests: jest.fn().mockResolvedValue({ success: true, tests: [{ path: '/project/math.test.js', name: 'adds', line: 1, runner: 'node' }] }) };
  await act(async () => render(<WorkspaceTestsPanel root="/project" onOpenFile={jest.fn()} onDebugFile={openDebugger} />));
  await act(async () => fireEvent.click(screen.getByText('Debug JS test file')));
  expect(workspaceDebug).toHaveBeenCalledWith({ root: '/project', action: 'start', file: '/project/math.test.js' }); expect(openDebugger).toHaveBeenCalledWith('/project/math.test.js');
});
