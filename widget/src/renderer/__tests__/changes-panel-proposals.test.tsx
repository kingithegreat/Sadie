/** @jest-environment jsdom */
/**
 * IDE-3 in the panel: an edit the assistant proposed is shown hunk by hunk and
 * goes nowhere until the reviewer decides. Asserts the decisions that actually
 * reach the main process, not that buttons exist.
 */

import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import ChangesPanel from '../components/workspace/ChangesPanel';

const hunk = (afterStart: number, removed: string, added: string) => ({
  beforeStart: afterStart,
  afterStart,
  lines: [
    { type: 'equal' as const, before: afterStart - 1, after: afterStart - 1, text: 'context' },
    { type: 'remove' as const, before: afterStart, after: null, text: removed },
    { type: 'add' as const, before: null, after: afterStart, text: added },
  ],
});

const proposal = {
  id: 'p1',
  path: 'C:/work/app.ts',
  tool: 'write_file',
  at: Date.now(),
  created: false,
  stats: { added: 2, removed: 2, approximate: false },
  hunks: [hunk(2, 'const a = 1;', 'const a = 99;'), hunk(14, 'const z = 0;', 'const z = 42;')],
};

function setup(overrides: Record<string, any> = {}) {
  const workspaceProposalAccept = jest.fn().mockResolvedValue({ success: true, applied: 1, path: proposal.path });
  const workspaceProposalReject = jest.fn().mockResolvedValue({ success: true });
  const workspaceProposals = jest.fn().mockResolvedValue({ success: true, proposals: [proposal] });
  (window as any).electron = {
    changesList: jest.fn().mockResolvedValue({ success: true, changes: [] }),
    changesDiff: jest.fn(),
    workspaceProposals, workspaceProposalAccept, workspaceProposalReject,
    ...overrides,
  };
  return { workspaceProposals, workspaceProposalAccept, workspaceProposalReject };
}

afterEach(() => { delete (window as any).electron; });

const mount = async () => { await act(async () => { render(<ChangesPanel />); }); };

test('a proposed edit is shown as hunks, with nothing written yet', async () => {
  setup();
  await mount();

  expect(screen.getByText(/Waiting for you — nothing is written yet/)).toBeInTheDocument();
  expect(screen.getByText('app.ts')).toBeInTheDocument();
  expect(screen.getByText('proposed')).toBeInTheDocument();
  expect(screen.getByText('const a = 99;')).toBeInTheDocument();
  expect(screen.getByText('const z = 42;')).toBeInTheDocument();
  // Everything starts accepted, so the reviewer drops what they do not want.
  expect(screen.getByRole('button', { name: 'Apply all' })).toBeEnabled();
});

test('unticking a hunk applies only the rest, and the button says how many', async () => {
  const { workspaceProposalAccept } = setup();
  await mount();

  await act(async () => {
    fireEvent.click(screen.getByLabelText('Accept change at line 2 in app.ts'));
  });
  expect(screen.getByRole('button', { name: 'Apply 1 of 2' })).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply 1 of 2' })); });
  expect(workspaceProposalAccept).toHaveBeenCalledWith('p1', [1]);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Applied 1 change\(s\) to app\.ts/));
});

test('unticking everything leaves nothing to apply', async () => {
  const { workspaceProposalAccept } = setup();
  await mount();

  for (const line of [2, 14]) {
    await act(async () => { fireEvent.click(screen.getByLabelText(`Accept change at line ${line} in app.ts`)); });
  }
  const apply = screen.getByRole('button', { name: 'Apply 0 of 2' });
  expect(apply).toBeDisabled();
  await act(async () => { fireEvent.click(apply); });
  expect(workspaceProposalAccept).not.toHaveBeenCalled();
});

test('discarding sends a reject and says the file was left alone', async () => {
  const { workspaceProposalReject, workspaceProposalAccept } = setup();
  await mount();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard' })); });
  expect(workspaceProposalReject).toHaveBeenCalledWith('p1');
  expect(workspaceProposalAccept).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/The file is untouched/));
});

test('a refusal from the main process is shown rather than swallowed', async () => {
  setup({ workspaceProposalAccept: jest.fn().mockResolvedValue({ success: false, error: 'This file changed since the edit was proposed, so it was not applied.' }) });
  await mount();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply all' })); });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/changed since the edit was proposed/));
});

test('with nothing waiting, the panel is just the change log', async () => {
  setup({ workspaceProposals: jest.fn().mockResolvedValue({ success: true, proposals: [] }) });
  await mount();

  expect(screen.queryByText(/Waiting for you/)).toBeNull();
  const list = screen.getByRole('list', { name: 'Changed files' });
  expect(within(list).getByText(/Nothing changed yet/)).toBeInTheDocument();
});
