/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import ChangesPanel from '../components/workspace/ChangesPanel';
describe('Changes project refresh lifecycle', () => {
  afterEach(() => { jest.useRealTimers(); delete (window as any).electron; });
  test('a deferred previous-root result cannot replace the new project, and polling does not overlap', async () => {
    jest.useFakeTimers(); let release!: (value: any) => void;
    const deferred = new Promise(resolve => { release = resolve; });
    const api = {
      changesList: jest.fn().mockReturnValueOnce(deferred).mockResolvedValue({ success: true, changes: [{ id: 'b', path: 'C:/b/current.ts', tool: 'edit_file', at: 1 }] }),
      workspaceProposals: jest.fn(async () => ({ success: true, proposals: [] })),
      workspaceCheckpointList: jest.fn(async () => ({ success: true, checkpoints: [], runs: [] })),
    }; (window as any).electron = api;
    const view = render(<ChangesPanel root="C:/a" />);
    await act(async () => { jest.advanceTimersByTime(12_000); }); expect(api.changesList).toHaveBeenCalledTimes(1);
    await act(async () => { view.rerender(<ChangesPanel root="C:/b" />); });
    expect(screen.getByRole('list', { name: 'Changed files' })).toHaveTextContent('current.ts');
    await act(async () => { release({ success: true, changes: [{ id: 'a', path: 'C:/a/stale.ts', tool: 'edit_file', at: 1 }] }); });
    expect(screen.getByRole('list', { name: 'Changed files' })).not.toHaveTextContent('stale.ts');
    expect(api.workspaceProposals).toHaveBeenCalledWith('C:/b'); expect(api.workspaceProposals).not.toHaveBeenCalledWith('C:/a');
  });
});
