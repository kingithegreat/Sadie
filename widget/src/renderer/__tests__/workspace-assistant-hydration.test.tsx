/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceAssistantPanel from '../components/workspace/WorkspaceAssistantPanel';
import { ASSISTANT_HISTORY_LOAD_TIMEOUT_MS, flushAssistantTurns, subscribeAssistantTurns, updateAssistantTurns } from '../components/workspace/workspace-assistant-session';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let api: any, root: string, stream: any;
beforeEach(() => {
  root = `C:/hydration-${Math.random()}`;
  api = {
    workspaceAiSession: jest.fn(async () => ({ success: true, turns: [] })), workspaceAiSaveSession: jest.fn(async () => ({ success: true })),
    sendStreamMessage: jest.fn(async () => undefined), cancelStream: jest.fn(), deleteConversation: jest.fn(async () => ({ success: true })),
    subscribeToStream: jest.fn((_id: string, callbacks: any) => { stream = callbacks; return jest.fn(); }),
  };
  (window as any).electron = api;
});
afterEach(() => { delete (window as any).electron; jest.useRealTimers(); });
const panel = (project = root) => <WorkspaceAssistantPanel root={project} files={[]} activePath={null} onClose={jest.fn()} />;

test('delayed restoration blocks early button/keyboard Send and saves recovered history plus the new turn', async () => {
  const load = deferred<any>(); api.workspaceAiSession.mockReturnValue(load.promise);
  render(panel());
  fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'new question typed early' } });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.keyDown(screen.getByLabelText('Ask the assistant'), { key: 'Enter', ctrlKey: true });
  expect(api.sendStreamMessage).not.toHaveBeenCalled(); expect(api.workspaceAiSaveSession).not.toHaveBeenCalled();
  const old = [{ id: 'old-user', role: 'user', text: 'old question' }, { id: 'old-answer', role: 'assistant', text: 'old answer' }];
  await act(async () => { load.resolve({ success: true, turns: old }); });
  expect(screen.getByLabelText('Ask the assistant')).toHaveValue('new question typed early');
  expect(screen.getByRole('log')).toHaveTextContent('old answer');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  act(() => { stream.onStreamChunk({ chunk: 'new answer' }); stream.onStreamEnd(); });
  await waitFor(() => expect(api.workspaceAiSaveSession).toHaveBeenCalled());
  const payload = api.workspaceAiSaveSession.mock.calls.at(-1);
  expect(payload[0]).toBe(root);
  expect(payload[1].map((turn: any) => turn.text)).toEqual(['old question', 'old answer', 'new question typed early', 'new answer']);
});

test('concurrent subscriptions deduplicate loading and refuse direct updates/flush until it succeeds', async () => {
  const load = deferred<any>(); api.workspaceAiSession.mockReturnValue(load.promise);
  const a = subscribeAssistantTurns(root, jest.fn(), api), b = subscribeAssistantTurns(root, jest.fn(), api);
  await Promise.resolve(); expect(api.workspaceAiSession).toHaveBeenCalledTimes(1);
  expect(updateAssistantTurns(root, () => [{ id: 'early', role: 'user', text: 'must not replace saved data' }], api)).toBe(false);
  await expect(flushAssistantTurns(root, api)).resolves.toBe(false); expect(api.workspaceAiSaveSession).not.toHaveBeenCalled();
  load.resolve({ success: true, turns: [{ id: 'old', role: 'assistant', text: 'durable old' }] });
  await act(async () => { await load.promise; }); a(); b();
});

test.each(['result', 'transport'])('failed %s load preserves typed input and durable history until explicit Retry', async kind => {
  const load = deferred<any>(); api.workspaceAiSession.mockReturnValueOnce(load.promise).mockResolvedValueOnce({ success: true, turns: [{ id: 'saved', role: 'assistant', text: 'saved history' }] });
  render(panel()); fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'retained draft' } });
  await act(async () => { if (kind === 'result') load.resolve({ success: false, error: 'Storage unavailable' }); else load.reject(new Error('Transport unavailable')); });
  expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/);
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Clear conversation history' })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('Ask the assistant'), { key: 'Enter', ctrlKey: true });
  expect(api.sendStreamMessage).not.toHaveBeenCalled(); expect(api.deleteConversation).not.toHaveBeenCalled();
  await expect(flushAssistantTurns(root, api)).resolves.toBe(false); expect(api.workspaceAiSaveSession).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry history recovery' })); });
  expect(screen.getByRole('log')).toHaveTextContent('saved history'); expect(screen.getByLabelText('Ask the assistant')).toHaveValue('retained draft');
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled(); expect(api.workspaceAiSession).toHaveBeenCalledTimes(2);
});

test('old-root late hydration cannot reveal its history or typed draft in the next project', async () => {
  const load = deferred<any>(); const next = `${root}-next`;
  api.workspaceAiSession.mockImplementation((project: string) => project === root ? load.promise : Promise.resolve({ success: true, turns: [{ id: 'new-root', role: 'assistant', text: 'next project history' }] }));
  const view = render(panel()); fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'old private draft' } });
  await act(async () => { view.rerender(panel(next)); });
  await act(async () => { load.resolve({ success: true, turns: [{ id: 'private', role: 'assistant', text: 'old private history' }] }); });
  expect(screen.getByRole('log')).toHaveTextContent('next project history'); expect(screen.getByRole('log')).not.toHaveTextContent('old private history');
  expect(screen.getByLabelText('Ask the assistant')).toHaveValue('');
  expect(api.workspaceAiSaveSession).not.toHaveBeenCalled();
});

test('expired hydration can Retry and its late original response cannot replace the recovered transcript', async () => {
  jest.useFakeTimers(); const old = deferred<any>();
  api.workspaceAiSession.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ success: true, turns: [{ id: 'current', role: 'assistant', text: 'latest durable transcript' }] });
  render(panel());
  await act(async () => { await jest.advanceTimersByTimeAsync(ASSISTANT_HISTORY_LOAD_TIMEOUT_MS); });
  expect(screen.getByRole('alert')).toHaveTextContent('timed out'); expect(api.workspaceAiSaveSession).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry history recovery' })); });
  await act(async () => { old.resolve({ success: true, turns: [{ id: 'stale', role: 'assistant', text: 'expired old response' }] }); });
  expect(screen.getByRole('log')).toHaveTextContent('latest durable transcript'); expect(screen.getByRole('log')).not.toHaveTextContent('expired old response');
  expect(api.workspaceAiSession).toHaveBeenCalledTimes(2); expect(api.workspaceAiSaveSession).not.toHaveBeenCalled();
});

test('ephemeral assistant without recovery or save APIs stays usable and cannot write durable history', async () => {
  delete api.workspaceAiSession; delete api.workspaceAiSaveSession;
  render(panel()); fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'ephemeral question' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(api.sendStreamMessage).toHaveBeenCalledTimes(1);
  act(() => { stream.onStreamChunk({ chunk: 'ephemeral answer' }); stream.onStreamEnd(); });
  expect(screen.getByRole('log')).toHaveTextContent('ephemeral answer');
  await expect(flushAssistantTurns(root, api)).resolves.toBe(false);
});

test('a save connection without its recovery API cannot treat durable history as an empty conversation', async () => {
  delete api.workspaceAiSession;
  render(panel()); fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'must wait' } });
  expect(screen.getByRole('alert')).toHaveTextContent('loading is unavailable'); expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('Ask the assistant'), { key: 'Enter', ctrlKey: true });
  expect(api.sendStreamMessage).not.toHaveBeenCalled();
  await expect(flushAssistantTurns(root, api)).resolves.toBe(false); expect(api.workspaceAiSaveSession).not.toHaveBeenCalled();
});

test('Clear waits for recovered history and the actual saved payload becomes empty only after deliberate deletion', async () => {
  const load = deferred<any>(); api.workspaceAiSession.mockReturnValue(load.promise); render(panel());
  fireEvent.click(screen.getByRole('button', { name: 'Clear conversation history' })); expect(api.deleteConversation).not.toHaveBeenCalled();
  await act(async () => { load.resolve({ success: true, turns: [{ id: 'old', role: 'user', text: 'saved old' }] }); });
  expect(api.workspaceAiSaveSession).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear conversation history' })); });
  expect(api.deleteConversation).toHaveBeenCalledWith(`workspace:${root}`);
  expect(api.workspaceAiSaveSession).toHaveBeenLastCalledWith(root, []);
});
