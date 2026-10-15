/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceAssistantPanel, { ASSISTANT_RULES_LOAD_TIMEOUT_MS } from '../components/workspace/WorkspaceAssistantPanel';
import { flushAssistantTurns } from '../components/workspace/workspace-assistant-session';
import { workspaceTranscriptModelMessages } from '../../main/workspace-conversation-store';

// Only dependencies of the real, pure model-history converter are stubbed.
jest.mock('electron', () => ({ app: { getPath: jest.fn() } }));
jest.mock('../../main/config-manager', () => ({ getSettings: jest.fn() }));
jest.mock('../../main/workspace-trust', () => ({ validateTrustedWorkspaceRoot: jest.fn() }));

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let api: any, root: string, callbacks: any;
let persisted: Map<string, any[]>;
beforeEach(() => {
  root = `C:/assistant-authority-${Math.random()}`; persisted = new Map();
  api = {
    workspaceAiSession: jest.fn(async (project: string) => ({ success: true, turns: JSON.parse(JSON.stringify(persisted.get(project) || [])) })),
    workspaceAiSaveSession: jest.fn(async (project: string, turns: any[]) => { persisted.set(project, JSON.parse(JSON.stringify(turns))); return { success: true }; }),
    workspaceAiRules: jest.fn(async (project: string) => ({ success: true, rules: [{ path: `${project}/AGENTS.md`, text: 'Follow the loaded project instructions.' }] })),
    subscribeToStream: jest.fn((_id: string, stream: any) => { callbacks = stream; return jest.fn(); }),
    sendStreamMessage: jest.fn(async () => undefined), cancelStream: jest.fn(),
  };
  (window as any).electron = api;
});
afterEach(() => { jest.useRealTimers(); delete (window as any).electron; });
const panel = (project = root) => <WorkspaceAssistantPanel root={project} files={[]} activePath={null} onClose={jest.fn()} />;
const typeQuestion = (text = 'Explain this project.') => fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: text } });
async function send() {
  typeQuestion(); await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
}

test('restored history does not unlock Send while project rules are pending; the loaded rules reach the actual request', async () => {
  const pending = deferred<any>(); api.workspaceAiRules.mockReturnValueOnce(pending.promise);
  render(panel()); typeQuestion('Keep my question while loading.');
  await waitFor(() => expect(screen.queryByText('Restoring conversation history before sending.')).not.toBeInTheDocument());
  expect(screen.getByText('Loading project instructions before sending.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.queryByText('No project instruction files found.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); fireEvent.keyDown(screen.getByLabelText('Ask the assistant'), { key: 'Enter', ctrlKey: true });
  expect(api.sendStreamMessage).not.toHaveBeenCalled(); expect(api.workspaceAiSaveSession).not.toHaveBeenCalled();
  await act(async () => { pending.resolve({ success: true, rules: [{ path: `${root}/AGENTS.md`, text: 'MANDATORY project rules.' }] }); });
  expect(screen.getByLabelText('Ask the assistant')).toHaveValue('Keep my question while loading.');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(api.sendStreamMessage).toHaveBeenCalledWith(expect.objectContaining({ workspace: { root }, conversationPrompt: expect.stringContaining('MANDATORY project rules.') }));
  act(() => callbacks.onStreamEnd());
});

test.each(['failure', 'transport', 'missing-api', 'invalid-result'])('a %s rules load visibly blocks keyboard/button Send and explicit Retry recovers', async kind => {
  if (kind === 'failure') api.workspaceAiRules.mockResolvedValueOnce({ success: false, error: 'Rules denied.' });
  if (kind === 'transport') api.workspaceAiRules.mockRejectedValueOnce(new Error('Rules transport failed.'));
  if (kind === 'missing-api') delete api.workspaceAiRules;
  if (kind === 'invalid-result') api.workspaceAiRules.mockResolvedValueOnce({ success: true });
  render(panel()); typeQuestion('Retain typed rules question.');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sending is paused until project instructions load.'));
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('Ask the assistant'), { key: 'Enter', ctrlKey: true });
  expect(api.sendStreamMessage).not.toHaveBeenCalled();
  api.workspaceAiRules = jest.fn(async () => ({ success: true, rules: [] }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry project instructions' })); });
  expect(screen.getByText('No project instruction files found.')).toBeInTheDocument();
  expect(screen.getByLabelText('Ask the assistant')).toHaveValue('Retain typed rules question.');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(api.sendStreamMessage).toHaveBeenCalledWith(expect.objectContaining({ workspace: { root }, conversationPrompt: undefined }));
  act(() => callbacks.onStreamEnd());
});

test('rules timeout Retry owns its generation and a late original success cannot replace the recovered rules', async () => {
  jest.useFakeTimers(); const original = deferred<any>();
  api.workspaceAiRules.mockReturnValueOnce(original.promise).mockResolvedValueOnce({ success: true, rules: [{ path: `${root}/AGENTS.md`, text: 'CURRENT retry instructions.' }] });
  await act(async () => { render(panel()); }); typeQuestion();
  await act(async () => { jest.advanceTimersByTime(ASSISTANT_RULES_LOAD_TIMEOUT_MS); });
  expect(screen.getByRole('alert')).toHaveTextContent('timed out');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry project instructions' })); });
  await act(async () => { original.resolve({ success: true, rules: [{ path: `${root}/old.md`, text: 'STALE original instructions.' }] }); });
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(api.sendStreamMessage.mock.calls[0][0].conversationPrompt).toContain('CURRENT retry instructions.');
  expect(api.sendStreamMessage.mock.calls[0][0].conversationPrompt).not.toContain('STALE');
  act(() => callbacks.onStreamEnd());
});

test('a late old-project load cannot unlock the next project or leak its rules into the new request', async () => {
  const old = deferred<any>(), next = deferred<any>(); const nextRoot = `${root}-next`;
  api.workspaceAiRules.mockImplementation((project: string) => project === root ? old.promise : next.promise);
  const view = render(panel()); await act(async () => { view.rerender(panel(nextRoot)); }); typeQuestion('New project question.');
  await act(async () => { old.resolve({ success: true, rules: [{ path: `${root}/AGENTS.md`, text: 'OLD private project rules.' }] }); });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('Ask the assistant'), { key: 'Enter', ctrlKey: true }); expect(api.sendStreamMessage).not.toHaveBeenCalled();
  await act(async () => { next.resolve({ success: true, rules: [{ path: `${nextRoot}/AGENTS.md`, text: 'NEW project rules.' }] }); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(api.sendStreamMessage.mock.calls[0][0].workspace.root).toBe(nextRoot);
  expect(api.sendStreamMessage.mock.calls[0][0].conversationPrompt).toContain('NEW project rules.');
  expect(api.sendStreamMessage.mock.calls[0][0].conversationPrompt).not.toContain('OLD private');
  act(() => callbacks.onStreamEnd());
});

test.each(['stop', 'close', 'stop-before-chunk'])('%s retains incomplete recovery bytes but a fresh UI reload does not hydrate them as completed model pairs', async action => {
  const view = render(panel()); await send();
  if (action !== 'stop-before-chunk') act(() => callbacks.onStreamChunk({ chunk: 'Partial answer retained for recovery.' }));
  await flushAssistantTurns(root, api);
  expect(persisted.get(root)?.[1].error).toBe(true);
  if (action === 'close') view.unmount(); else { fireEvent.click(screen.getByRole('button', { name: 'Stop' })); view.unmount(); }
  await flushAssistantTurns(root, api);
  const saved = persisted.get(root)!;
  expect(saved[1]).toEqual(expect.objectContaining({ error: true, text: expect.stringContaining('[Stopped]') }));
  if (action !== 'stop-before-chunk') expect(saved[1].text).toContain('Partial answer retained');
  expect(workspaceTranscriptModelMessages(saved)).toEqual([]);
  // A new root key forces a real session API load rather than the prior memory
  // cache, using exactly the persisted payload as a restarted renderer would.
  const restarted = `${root}-restart`; persisted.set(restarted, saved); render(panel(restarted));
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('[Stopped]'));
  expect(api.workspaceAiSession).toHaveBeenCalledWith(restarted);
  expect(workspaceTranscriptModelMessages(persisted.get(restarted)!)).toEqual([]);
  act(() => { callbacks.onStreamChunk({ chunk: 'late cancelled chunk' }); callbacks.onStreamEnd(); });
  expect(persisted.get(root)?.[1].error).toBe(true);
});

test.each(['async', 'synchronous'])('a genuinely completed %s response persists a valid pair and stays usable after reload', async delivery => {
  const removed = jest.fn();
  if (delivery === 'synchronous') api.subscribeToStream.mockImplementation((_id: string, stream: any) => { callbacks = stream; stream.onStreamChunk({ chunk: 'Complete answer.' }); stream.onStreamEnd(); return removed; });
  const view = render(panel()); await send();
  if (delivery === 'async') act(() => { callbacks.onStreamChunk({ chunk: 'Complete answer.' }); callbacks.onStreamEnd(); });
  await flushAssistantTurns(root, api); const saved = persisted.get(root)!;
  expect(saved[1]).toEqual(expect.objectContaining({ error: false, text: 'Complete answer.' }));
  expect(workspaceTranscriptModelMessages(saved)).toEqual([{ role: 'user', content: 'Explain this project.' }, { role: 'assistant', content: 'Complete answer.' }]);
  expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  if (delivery === 'synchronous') expect(removed).toHaveBeenCalledTimes(1);
  view.unmount(); expect(api.cancelStream).not.toHaveBeenCalled();
  const restarted = `${root}-restart`; persisted.set(restarted, saved); render(panel(restarted));
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('Complete answer.'));
  expect(workspaceTranscriptModelMessages(persisted.get(restarted)!)).toHaveLength(2);
});

test.each(['partial', 'before-chunk'])('backend cancelled end %s retains incomplete recovery and cannot later become a completed pair', async delivery => {
  render(panel()); await send();
  if (delivery === 'partial') act(() => callbacks.onStreamChunk({ chunk: 'Backend-cancelled partial answer.' }));
  act(() => callbacks.onStreamEnd({ cancelled: true }));
  await flushAssistantTurns(root, api); const saved = persisted.get(root)!;
  expect(saved[1]).toEqual(expect.objectContaining({ error: true, text: expect.stringContaining('[Stopped]') }));
  if (delivery === 'partial') expect(saved[1].text).toBe('Backend-cancelled partial answer.\n[Stopped]');
  expect(api.cancelStream).not.toHaveBeenCalled();
  expect(workspaceTranscriptModelMessages(saved)).toEqual([]);
  act(() => { callbacks.onStreamChunk({ chunk: 'late chunk' }); callbacks.onStreamEnd({ cancelled: false }); });
  await flushAssistantTurns(root, api);
  expect(persisted.get(root)).toEqual(saved); expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
});

test('a rejected dispatch freezes partial recovery against retained late chunk/end callbacks and permits a fresh response', async () => {
  const request = deferred<void>(); const removed = jest.fn();
  api.sendStreamMessage.mockReturnValueOnce(request.promise);
  api.subscribeToStream.mockImplementationOnce((_id: string, stream: any) => { callbacks = stream; return removed; });
  render(panel()); await send(); const oldCallbacks = callbacks;
  act(() => oldCallbacks.onStreamChunk({ chunk: 'Preserve these original partial bytes.' }));
  await act(async () => { request.reject(new Error('Dispatch rejected.')); });
  await flushAssistantTurns(root, api); const saved = persisted.get(root)!;
  expect(saved[1]).toEqual(expect.objectContaining({ text: 'Preserve these original partial bytes.', error: true }));
  expect(removed).toHaveBeenCalledTimes(1); expect(screen.getByRole('status')).toHaveTextContent('Dispatch rejected.');
  act(() => { oldCallbacks.onStreamChunk({ chunk: 'UNWANTED late bytes' }); oldCallbacks.onStreamEnd(); });
  await flushAssistantTurns(root, api); expect(persisted.get(root)).toEqual(saved); expect(workspaceTranscriptModelMessages(saved)).toEqual([]);
  await send(); act(() => { callbacks.onStreamChunk({ chunk: 'Fresh completed answer.' }); callbacks.onStreamEnd(); });
  await flushAssistantTurns(root, api);
  expect(workspaceTranscriptModelMessages(persisted.get(root)!)).toEqual([{ role: 'user', content: 'Explain this project.' }, { role: 'assistant', content: 'Fresh completed answer.' }]);
  act(() => oldCallbacks.onStreamChunk({ chunk: 'OLD owner after replacement' }));
  expect(screen.getByRole('log')).not.toHaveTextContent('OLD owner after replacement');
});
