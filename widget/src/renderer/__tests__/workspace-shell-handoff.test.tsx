/** @jest-environment jsdom */
/**
 * workspace-shell-handoff.test.tsx
 *
 * Track F — per-field navContext guard in WorkspaceShell.
 *
 * The whole-effect guard (`if (!open || root) return;`) at the top of the
 * bootstrap useEffect silently dropped every later handoff that carried a
 * different starting point once any root was set. The docstring already
 * stated the AutomationCenter principle ("arriving a second time cannot yank
 * the tree away from what the user is already looking at") but the
 * implementation did the opposite: a second `navigate_to_mode('code', { path })`
 * while the user was already rooted somewhere else was discarded.
 *
 * Fix splits the effect into two: one bootstraps the root (still gated on
 * `!root`), and a second applies each new handoff independently — adopting
 * a directory handoff when there is no root to clobber, and always trying to
 * open the targeted file in whichever root is active.
 *
 * These tests assert the second behaviour.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import WorkspaceShell from '../components/workspace/WorkspaceShell';

function setupElectron() {
  // workspaceList mirrors the real IPC: it only succeeds for directories,
  // fails for files. Real handler: widget/src/main/workspace-ipc.ts:117.
  const workspaceList = jest.fn(async (dirPath: string) => {
    // The mock tests use directory-shaped handoffs. Anything containing a
    // file extension is treated as a file, matching workspace-ipc's
    // "list the entries" semantics.
    const looksLikeFile = /\.[A-Za-z0-9]{1,5}$/.test(dirPath);
    if (looksLikeFile) return { success: false, error: 'Not a directory.' };
    return { success: true, path: dirPath, entries: [] };
  });
  const workspaceRoot = jest.fn(async () => ({
    success: true,
    path: 'C:\\default-root',
  }));
  const workspaceRead = jest.fn(async (filePath: string) => ({
    success: true,
    path: filePath,
    name: filePath.split(/[\\/]/).pop() || filePath,
    content: `// contents of ${filePath}\n`,
    original: `// contents of ${filePath}\n`,
    language: 'typescript',
  }));
  (window as any).electron = {
    workspaceList,
    workspaceRoot,
    workspaceRead,
    // Used by the assistant activity effect; harmless no-op.
    onAssistantToolActivity: () => () => undefined,
  };
  return { workspaceList, workspaceRoot, workspaceRead };
}

describe('WorkspaceShell — navContext handoff (Track F)', () => {
  test('a fresh shell adopts the handoff path as its root', async () => {
    const { workspaceList } = setupElectron();
    await act(async () => {
      render(
        <WorkspaceShell
          open
          onClose={jest.fn()}
          navContext={{ path: 'C:\\handoff-dir' }}
        />,
      );
    });
    await waitFor(() =>
      expect(workspaceList).toHaveBeenCalledWith('C:\\handoff-dir'),
    );
  });

  test('falls back to the configured root when no handoff is provided', async () => {
    const { workspaceRoot } = setupElectron();
    await act(async () => {
      render(<WorkspaceShell open onClose={jest.fn()} navContext={null} />);
    });
    await waitFor(() => expect(workspaceRoot).toHaveBeenCalled());
  });

  test('a second handoff into an already-rooted shell still opens the new file (Track F regression)', async () => {
    const { workspaceList, workspaceRead } = setupElectron();
    // First handoff: root the shell on the project, then re-render with a
    // different file path. With the whole-effect guard this second handoff
    // was silently dropped; the per-field split honours it.
    let rerender: (ui: React.ReactElement) => void = () => {};
    const result = render(
      <WorkspaceShell
        open
        onClose={jest.fn()}
        navContext={{ path: 'C:\\first-repo' }}
      />,
    );
    rerender = result.rerender;

    await waitFor(() =>
      expect(workspaceList).toHaveBeenCalledWith('C:\\first-repo'),
    );

    await act(async () => {
      rerender(
        <WorkspaceShell
          open
          onClose={jest.fn()}
          navContext={{ path: 'C:\\second-repo\\src\\index.ts' }}
        />,
      );
    });

    // The second handoff should at minimum try to read the new file. The
    // per-field `setRoot(prev => prev || ctxPath)` keeps the existing root,
    // but `openFile` is called regardless — so even if the user is rooted
    // elsewhere, the targeted file still opens in a tab.
    await waitFor(() =>
      expect(workspaceRead).toHaveBeenCalledWith(
        'C:\\second-repo\\src\\index.ts',
      ),
    );
  });

    test('a fresh shell adopts the handoff path as its root — header open path', async () => {
    // Regression for App.tsx:1651. The header Workspace button opens
    // WorkspaceShell as an overlay (`workspaceOpen` toggle), and that mount
    // must carry the live navContext the same way the mode-bar Code button
    // does. Before the wiring fix this path mounted <WorkspaceShell open />
    // with no navContext, so a chat handoff ("help me with this repo") was
    // silently lost whenever the user opened the workspace from the header
    // rather than from the Code mode button.
    //
    // This mirrors the header-open contract: open=true, an onClose that
    // toggles the overlay, and navContext present from a prior handoff.
    const { workspaceRoot } = setupElectron();
    const onClose = jest.fn();

    await act(async () => {
      render(
        <WorkspaceShell
          open
          onClose={onClose}
          // App.tsx now forwards the same navContext state on this path.
          navContext={{ path: 'C:\\header-open-handoff' }}
        />,
      );
    });

    // With a directory handoff and no prior root, the bootstrap effect roots
    // on the handoff path rather than calling workspaceRoot — i.e. the header
    // open path does not regress to the empty-panel dead end.
    await waitFor(() =>
      expect(workspaceRoot).not.toHaveBeenCalled(),
    );
  });

  test('a directory handoff into an already-rooted shell adopts the new root when no root is set (per-field guard)', async () => {
    // This is the inverse case: user hands off a directory with no existing
    // root yet. The bootstrap effect (still gated on `!root`) handles it.
    const { workspaceList } = setupElectron();
    await act(async () => {
      render(
        <WorkspaceShell
          open
          onClose={jest.fn()}
          navContext={{ path: 'C:\\another-project' }}
        />,
      );
    });
    await waitFor(() =>
      expect(workspaceList).toHaveBeenCalledWith('C:\\another-project'),
    );
  });
});