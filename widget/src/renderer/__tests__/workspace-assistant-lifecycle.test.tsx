/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceAssistantPanel from '../components/workspace/WorkspaceAssistantPanel';

describe('IDE assistant lifecycle and approval controls', () => {
  let api: any, handlers: any, root: string;
  beforeEach(() => {
    root = `C:/project-${Math.random()}`;
    api = {
      subscribeToStream: jest.fn((_id, callbacks) => { handlers = callbacks; return jest.fn(); }),
      sendStreamMessage: jest.fn(async () => undefined), cancelStream: jest.fn(),
      workspaceAiSession: jest.fn(async () => ({ success: true, turns: [] })),
      workspaceAiSaveSession: jest.fn(async () => ({ success: true })),
      deleteConversation: jest.fn(async () => ({ success: true })),
      workspaceAiPreparePlan: jest.fn(async (_root, text) => ({ success: true, id: 'approved-plan', text })),
      workspaceAiApprovePlan: jest.fn(async () => ({ success: true, id: 'approved-plan' })),
      workspaceAiRules: jest.fn(async () => ({ success: true, rules: [{ path: `${root}/AGENTS.md`, text: 'Use project conventions.' }] })),
      workspaceAiMcpStatus: jest.fn(async () => ({ success: true, servers: [{ name: 'test', connected: true, toolCount: 1 }] })),
    };
    (window as any).electron = api;
  });
  afterEach(() => { delete (window as any).electron; });
  const panel = (project = root) => <WorkspaceAssistantPanel root={project} files={[]} activePath={null} onClose={jest.fn()} selection={{ path: `${project}/app.ts`, text: 'selected UNSAVED' }} terminalOutput="terminal result 42" />;
  const send = async (text: string) => {
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: text } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  };
  test('closing retains transcript, cancels its active stream, and isolates a different project', async () => {
    const first = render(panel()); await send('question');
    act(() => handlers.onStreamChunk({ chunk: 'partial answer' })); first.unmount();
    expect(api.cancelStream).toHaveBeenCalledTimes(1);
    const second = render(panel());
    expect(screen.getByRole('log')).toHaveTextContent('partial answer'); expect(screen.getByRole('log')).toHaveTextContent('[Stopped]');
    await waitFor(() => expect(api.workspaceAiSaveSession).toHaveBeenCalledWith(root, expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('partial answer') })])));
    await act(async () => { second.rerender(panel('C:/other-project')); });
    expect(screen.getByRole('log')).not.toHaveTextContent('partial answer');
  });
  test('IPC rejection releases Send and surfaces error, and a later request works', async () => {
    api.sendStreamMessage.mockRejectedValueOnce(new Error('Connection rejected'));
    render(panel()); await send('first');
    expect(screen.getByRole('log')).toHaveTextContent('Connection rejected'); expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    await send('second'); expect(api.sendStreamMessage).toHaveBeenCalledTimes(2);
    act(() => handlers.onStreamEnd());
  });
  test('selection/terminal/rules are context and a separate reviewed approval binds the structured request', async () => {
    render(panel()); await waitFor(() => expect(screen.getByText('Loaded 1 project instruction file(s).')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Add context'), { target: { value: `selection:${root}/app.ts` } });
    fireEvent.change(screen.getByLabelText('Add context'), { target: { value: 'terminal:terminal' } });
    await send('Please explain before changing anything.');
    expect(api.sendStreamMessage.mock.calls[0][0]).toMatchObject({ workspace: { root } });
    expect(api.sendStreamMessage.mock.calls[0][0].workspace.planId).toBeUndefined();
    expect(api.sendStreamMessage.mock.calls[0][0].message).toContain('selected UNSAVED');
    expect(api.sendStreamMessage.mock.calls[0][0].message).toContain('terminal result 42');
    expect(api.sendStreamMessage.mock.calls[0][0].conversationPrompt).toContain('Use project conventions.');
    act(() => handlers.onStreamEnd());
    fireEvent.change(screen.getByLabelText('Plan to approve'), { target: { value: 'Update app.ts with the intended correction.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review plan' })); });
    expect(api.workspaceAiApprovePlan).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve plan' })); });
    expect(api.workspaceAiApprovePlan).toHaveBeenCalledWith(root, 'approved-plan');
    await send('Proceed with the approved plan.');
    expect(api.sendStreamMessage.mock.calls[1][0]).toMatchObject({ workspace: { root, planId: 'approved-plan' } });
    act(() => handlers.onStreamEnd());
  });
  test('persisted restart history is loaded through the real session API contract', async () => {
    api.workspaceAiSession.mockResolvedValue({ success: true, turns: [{ id: 'recovered', role: 'assistant', text: 'Recovered answer' }] });
    render(panel()); await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('Recovered answer'));
  });
  test('clear deletes this project model context and persisted transcript, while preserving other chat IDs', async () => {
    const modelContext = new Map([[`workspace:${root}`, ['old project context']], ['chat-unrelated', ['other context']]]);
    api.deleteConversation.mockImplementation(async (id: string) => { modelContext.delete(id); return { success: true }; });
    render(panel()); await send('private question'); act(() => handlers.onStreamEnd());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear conversation history' })); });
    expect(api.deleteConversation).toHaveBeenCalledWith(`workspace:${root}`);
    expect(modelContext.has(`workspace:${root}`)).toBe(false); expect(modelContext.get('chat-unrelated')).toEqual(['other context']);
    expect(screen.getByRole('log')).not.toHaveTextContent('private question');
    expect(api.workspaceAiSaveSession).toHaveBeenLastCalledWith(root, []);
    expect(screen.getByRole('status')).toHaveTextContent('Conversation history and model context cleared.');
  });
  test('clear is unavailable while streaming and deletion failure retains the transcript', async () => {
    render(panel()); await send('keep my history');
    const clear = screen.getByRole('button', { name: 'Clear conversation history' });
    expect(clear).toBeDisabled(); fireEvent.click(clear); expect(api.deleteConversation).not.toHaveBeenCalled();
    act(() => handlers.onStreamEnd()); api.deleteConversation.mockResolvedValue({ success: false, error: 'Storage unavailable' });
    await act(async () => { fireEvent.click(clear); });
    expect(screen.getByRole('log')).toHaveTextContent('keep my history'); expect(screen.getByRole('status')).toHaveTextContent('Storage unavailable');
  });
  test('a pending old-project deletion cannot clear or annotate the newly selected project', async () => {
    let release!: (value: any) => void;
    api.deleteConversation.mockReturnValue(new Promise(resolve => { release = resolve; }));
    api.workspaceAiSession.mockImplementation(async (project: string) => ({ success: true, turns: project === root ? [] : [{ id: 'other', role: 'assistant', text: 'Other project context' }] }));
    const view = render(panel()); await send('old project private history'); act(() => handlers.onStreamEnd());
    fireEvent.click(screen.getByRole('button', { name: 'Clear conversation history' }));
    await act(async () => { view.rerender(panel('C:/other-cleared-project')); });
    await act(async () => { release({ success: true }); });
    expect(api.deleteConversation).toHaveBeenCalledTimes(1); expect(api.deleteConversation).toHaveBeenCalledWith(`workspace:${root}`);
    expect(screen.getByRole('log')).toHaveTextContent('Other project context'); expect(screen.queryByText('Conversation history and model context cleared.')).not.toBeInTheDocument();
    expect(api.workspaceAiSaveSession).toHaveBeenLastCalledWith(root, []);
  });
  test.each(['folder', 'codebase'])('closing during deferred %s context never starts a late stream', async kind => {
    let release!: (value: any) => void;
    const deferred = new Promise(resolve => { release = resolve; });
    api.workspaceList = jest.fn(() => deferred); api.workspaceCodeSearch = jest.fn(() => deferred);
    const view = render(panel());
    fireEvent.change(screen.getByLabelText('Add context'), { target: { value: `${kind}:${root}` } });
    await send('explain the attached project'); view.unmount();
    await act(async () => { release({ success: true, entries: [], matches: [], mode: 'Local keyword search' }); });
    expect(api.sendStreamMessage).not.toHaveBeenCalled(); expect(api.subscribeToStream).not.toHaveBeenCalled();
  });
  test('root switching cancels pending context and a late old send rejection cannot stop the new stream', async () => {
    let releaseContext!: (value: any) => void, rejectSend!: (value: any) => void;
    api.workspaceList = jest.fn(() => new Promise(resolve => { releaseContext = resolve; }));
    const view = render(panel()); fireEvent.change(screen.getByLabelText('Add context'), { target: { value: `folder:${root}` } });
    await send('old context question'); await act(async () => { view.rerender(panel('C:/new-context-project')); });
    await act(async () => { releaseContext({ success: true, entries: [] }); }); expect(api.sendStreamMessage).not.toHaveBeenCalled();
    api.sendStreamMessage.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
    await send('old pending transport');
    await act(async () => { view.rerender(panel('C:/new-live-project')); }); await send('new live response');
    const newStream = api.sendStreamMessage.mock.calls[1][0].streamId;
    await act(async () => { rejectSend(new Error('Old rejected transport')); });
    expect(screen.getByRole('button', { name: 'Stop', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('log')).not.toHaveTextContent('Old rejected transport');
    fireEvent.click(screen.getByRole('button', { name: 'Stop', exact: true })); expect(api.cancelStream).toHaveBeenLastCalledWith(newStream);
  });
  test.each(['prepare', 'approve', 'revoke'])('a deferred %s result cannot modify the next project', async operation => {
    let release!: (value: any) => void;
    api.workspaceTrustedFolders = jest.fn(async () => ({ success: true, roots: [root] }));
    api.workspaceRevokeFolder = jest.fn(async () => ({ success: true, roots: [] }));
    const view = render(panel());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove project access' })).toBeInTheDocument());
    const deferred = new Promise(resolve => { release = resolve; });
    if (operation === 'revoke') { api.workspaceRevokeFolder.mockReturnValueOnce(deferred); fireEvent.click(screen.getByRole('button', { name: 'Remove project access' })); }
    else {
      fireEvent.change(screen.getByLabelText('Plan to approve'), { target: { value: 'Old plan actions' } });
      if (operation === 'prepare') api.workspaceAiPreparePlan.mockReturnValueOnce(deferred);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review plan' })); });
      if (operation === 'approve') { api.workspaceAiApprovePlan.mockReturnValueOnce(deferred); fireEvent.click(screen.getByRole('button', { name: 'Approve plan' })); }
    }
    await act(async () => { view.rerender(panel('C:/later-plan-project')); });
    await act(async () => { release({ success: true, id: 'old-result-plan', text: 'Old plan actions', roots: [] }); });
    expect(screen.queryByRole('button', { name: 'Approved', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve plan', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/Plan approved for this project|Project access removed/)).not.toBeInTheDocument();
  });
});
