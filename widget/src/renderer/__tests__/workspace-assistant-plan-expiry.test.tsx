/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import WorkspaceAssistantPanel from '../components/workspace/WorkspaceAssistantPanel';

const TTL = 30 * 60_000;
let now: number, api: any, root: string, callbacks: any;
beforeEach(() => {
  jest.useFakeTimers(); now = 1_700_000_000_000; jest.spyOn(Date, 'now').mockImplementation(() => now);
  root = `C:/plan-ttl-${Math.random()}`;
  let sequence = 0;
  api = {
    workspaceAiSession: jest.fn(async () => ({ success: true, turns: [] })), workspaceAiSaveSession: jest.fn(async () => ({ success: true })),
    workspaceAiPreparePlan: jest.fn(async () => ({ success: true, id: `plan-${++sequence}`, text: 'Review current changes.', expires: now + TTL })),
    workspaceAiApprovePlan: jest.fn(async (_root: string, id: string) => ({ success: true, id, expires: now + TTL })),
    subscribeToStream: jest.fn((_id: string, stream: any) => { callbacks = stream; return jest.fn(); }), sendStreamMessage: jest.fn(async () => undefined), cancelStream: jest.fn(),
  };
  (window as any).electron = api;
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); delete (window as any).electron; });
async function open() {
  await act(async () => { render(<WorkspaceAssistantPanel root={root} files={[]} activePath={null} onClose={jest.fn()} />); });
  fireEvent.click(screen.getByText('Plan and project instructions'));
  fireEvent.change(screen.getByLabelText('Plan to approve'), { target: { value: 'Review current changes.' } });
  fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'Continue with reviewed edits.' } });
}
async function review() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review plan', exact: true })); }); }
async function approve() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve plan', exact: true })); }); }
function advance(ms: number) { now += ms; act(() => { jest.advanceTimersByTime(ms); }); }

test('full panel preserves renewed server expires, clears expired approval, and recovers with a fresh Review and Approve', async () => {
  await open(); await review();
  advance(TTL - 1000); await approve();
  // The original review deadline must not expire a renewed approval.
  advance(1001); expect(screen.getByRole('button', { name: 'Approved', exact: true })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true })); });
  expect(api.sendStreamMessage.mock.calls[0][0].workspace).toEqual({ root, planId: 'plan-1' });
  act(() => { callbacks.onStreamEnd(); });
  fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'Continue after expiry.' } });
  advance(TTL - 1001);
  expect(screen.queryByRole('button', { name: 'Approved', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(screen.getByLabelText('Ask the assistant')).toHaveValue('Continue after expiry.');
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Ask the assistant'), { key: 'Enter', ctrlKey: true }); });
  expect(api.sendStreamMessage).toHaveBeenCalledTimes(1);
  await review(); await approve();
  expect(api.workspaceAiApprovePlan).toHaveBeenLastCalledWith(root, 'plan-2');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true })); });
  expect(api.sendStreamMessage.mock.calls[1][0].workspace).toEqual({ root, planId: 'plan-2' });
  act(() => { callbacks.onStreamEnd(); });
});

test('a background clock jump and an awaited context read cannot send an expired captured plan', async () => {
  await open(); await review(); await approve();
  let resolve!: (value: any) => void;
  api.workspaceList = jest.fn(() => new Promise(done => { resolve = done; }));
  fireEvent.change(screen.getByLabelText('Add context'), { target: { value: `folder:${root}` } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true })); });
  now += TTL; // Deliberately do not deliver the UI timer before the IPC read returns.
  await act(async () => { resolve({ success: true, entries: [] }); });
  expect(api.sendStreamMessage).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Ask the assistant')).toHaveValue('Continue with reviewed edits.');
  expect(screen.queryByRole('button', { name: 'Approved', exact: true })).not.toBeInTheDocument();
  await review(); await approve();
  now += TTL; // Also exercise the pre-Send check before a suspended timer runs.
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Ask the assistant'), { key: 'Enter', ctrlKey: true }); });
  expect(api.sendStreamMessage).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Review plan', exact: true })).toBeEnabled();
});

test('the panel uses the returned expiry and recovers from a main-process expiry rejection', async () => {
  await open(); await review();
  api.workspaceAiApprovePlan.mockResolvedValueOnce({ success: true, id: 'plan-1', expires: now + 1234 });
  await approve(); advance(1234);
  expect(screen.queryByRole('button', { name: 'Approved', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await review();
  api.workspaceAiApprovePlan.mockResolvedValueOnce({ success: false, error: 'This plan expired. Prepare it again.' });
  await approve();
  expect(screen.queryByRole('button', { name: 'Approve plan', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review plan', exact: true })).toBeEnabled();
  await review(); await approve();
  expect(screen.getByRole('button', { name: 'Approved', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

test('a fresh approval replaces an earlier plan during context loading without being cleared or sending the earlier ID', async () => {
  await open(); await review(); await approve();
  let resolve!: (value: any) => void;
  api.workspaceList = jest.fn(() => new Promise(done => { resolve = done; }));
  fireEvent.change(screen.getByLabelText('Add context'), { target: { value: `folder:${root}` } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true })); });
  advance(TTL - 1000); await review(); await approve();
  expect(api.workspaceAiApprovePlan).toHaveBeenLastCalledWith(root, 'plan-2');
  advance(1000); // The captured first approval has expired; the new one is valid.
  await act(async () => { resolve({ success: true, entries: [] }); });
  expect(api.sendStreamMessage).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Approved', exact: true })).toBeDisabled();
  expect(screen.getByLabelText('Ask the assistant')).toHaveValue('Continue with reviewed edits.');
  api.workspaceList.mockResolvedValue({ success: true, entries: [] });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true })); });
  expect(api.sendStreamMessage).toHaveBeenCalledTimes(1);
  expect(api.sendStreamMessage.mock.calls[0][0].workspace).toEqual({ root, planId: 'plan-2' });
  act(() => { callbacks.onStreamEnd(); });
});

test('only successful conversation clearing releases the expiry gate and the next chat is read-only', async () => {
  await open(); await review(); await approve(); advance(TTL);
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  api.deleteConversation = jest.fn().mockResolvedValueOnce({ success: false, error: 'Deletion failed.' }).mockResolvedValueOnce({ success: true });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear conversation history', exact: true })); });
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear conversation history', exact: true })); });
  expect(api.deleteConversation).toHaveBeenLastCalledWith(`workspace:${root}`);
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Approved', exact: true })).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true })); });
  expect(api.sendStreamMessage).toHaveBeenCalledTimes(1);
  expect(api.sendStreamMessage.mock.calls[0][0].workspace).toEqual({ root });
  act(() => { callbacks.onStreamEnd(); });
});
