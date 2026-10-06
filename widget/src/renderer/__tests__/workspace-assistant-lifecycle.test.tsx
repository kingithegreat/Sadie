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
});
