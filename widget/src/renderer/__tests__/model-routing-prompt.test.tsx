/** @jest-environment jsdom */

import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { ElectronAPI } from '../../shared/types';

describe('model routing prompt mode', () => {
  beforeEach(() => {
    (window as any).electron = {
      cancelStream: jest.fn(),
      subscribeToStream: jest.fn(() => jest.fn()),
      getSettings: jest.fn().mockResolvedValue({
        firstRun: false,
        alwaysOnTop: true,
        n8nUrl: 'http://localhost:5678',
        widgetHotkey: 'Ctrl+Shift+Space',
        useCustomLLM: false,
        modelRoutingMode: 'prompt',
        chatModel: 'qwen2.5:3b',
        codeModel: '',
        visionModel: 'moondream:latest',
      }),
      listOllamaModels: jest.fn().mockResolvedValue({
        success: true,
        models: [
          { name: 'qwen2.5:3b' },
          { name: 'qwen2.5:7b' },
        ],
      }),
      saveSettings: jest.fn().mockResolvedValue(undefined),
      sendStreamMessage: jest.fn().mockResolvedValue(undefined),
      onMessage: jest.fn(() => jest.fn()),
      sendMessage: jest.fn(),
      checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
      getWidgetMode: jest.fn().mockResolvedValue(true),
      onWidgetModeChanged: jest.fn(() => jest.fn()),
      loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [], activeConversationId: null } }),
      createConversation: jest.fn().mockResolvedValue({ success: true, data: { id: 'conv-1', systemPrompt: '' } }),
      setActiveConversation: jest.fn().mockResolvedValue({ success: true }),
      addMessage: jest.fn().mockResolvedValue({ success: true }),
      getConversation: jest.fn().mockResolvedValue({ success: true, data: { id: 'conv-1', title: 'Conversation', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
      detectGpuVram: jest.fn().mockResolvedValue({ success: true, vramGB: 4 }),
      onConfirmationRequest: jest.fn(() => jest.fn()),
      onPermissionRequest: jest.fn(() => jest.fn()),
      onReminderFired: jest.fn(() => jest.fn()),
      onAutoProfileApplied: jest.fn(() => jest.fn()),
      getEnv: jest.fn().mockResolvedValue({}),
    } as unknown as ElectronAPI;
  });

  afterEach(() => { delete (window as any).electron; });

  test('prompt mode asks before applying a suggested model override', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');

    const textarea = await screen.findByLabelText('Message HomeBot');
    fireEvent.change(textarea, { target: { value: 'compare the pros and cons of local versus cloud models for privacy' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText('Suggest Better Model')).toBeInTheDocument());
    expect((window as any).electron.sendStreamMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Use suggested model'));

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalledTimes(1));
    const payload = ((window as any).electron.sendStreamMessage as jest.Mock).mock.calls[0][0];
    expect(payload.modelOverride).toBe('qwen2.5:7b');
    expect((window as any).electron.saveSettings).not.toHaveBeenCalled();
  });

  test('prompt mode keeps the current model when the suggestion is declined', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');

    const textarea = await screen.findByLabelText('Message HomeBot');
    fireEvent.change(textarea, { target: { value: 'compare the pros and cons of local versus cloud models for privacy' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText('Suggest Better Model')).toBeInTheDocument());
    expect((window as any).electron.sendStreamMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Keep current model'));

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalledTimes(1));
    const payload = ((window as any).electron.sendStreamMessage as jest.Mock).mock.calls[0][0];
    expect(payload.modelOverride).toBeUndefined();
    expect(screen.queryByText('Suggest Better Model')).toBeNull();
    expect((window as any).electron.saveSettings).not.toHaveBeenCalled();
  });

  test('confirming a one-request model keeps the saved default and the next plain request uses it', async () => {
    const electron = (window as any).electron;
    const initialSettings = await electron.getSettings();
    let savedSettings = { ...initialSettings };
    electron.getSettings.mockImplementation(async () => ({ ...savedSettings }));
    electron.saveSettings.mockImplementation(async (next: typeof savedSettings) => {
      savedSettings = { ...next };
      return savedSettings;
    });
    await act(async () => { render(<App />); });
    expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Message HomeBot' }), {
        target: { value: 'Compare the pros and cons of two approaches.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(await screen.findByText('Suggest Better Model')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use suggested model' })); });
    await waitFor(() => expect(electron.sendStreamMessage).toHaveBeenCalledTimes(1));
    const firstRequest = electron.sendStreamMessage.mock.calls[0][0];
    expect(firstRequest.modelOverride).toBe('qwen2.5:7b');
    expect(electron.saveSettings).not.toHaveBeenCalled();
    expect(savedSettings).toEqual(initialSettings);

    const callbacks = electron.subscribeToStream.mock.calls[0][1];
    act(() => {
      callbacks.onStreamChunk({ streamId: firstRequest.streamId, chunk: 'Here is the comparison.' });
      callbacks.onStreamEnd({ streamId: firstRequest.streamId, cancelled: false, model: 'qwen2.5:7b' });
    });
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Message HomeBot' }), { target: { value: 'Hello again!' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    // The second proposal identifies the unchanged default. A persistent switch
    // would instead consider 7b current and skip this choice altogether.
    expect(await screen.findByText('Use qwen2.5:7b instead of qwen2.5:3b for this chat request?')).toBeInTheDocument();
    expect(electron.sendStreamMessage).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Keep current model' })); });
    await waitFor(() => expect(electron.sendStreamMessage).toHaveBeenCalledTimes(2));
    expect(electron.sendStreamMessage.mock.calls[1][0]).toEqual(expect.objectContaining({ message: 'Hello again!' }));
    expect(electron.sendStreamMessage.mock.calls[1][0].modelOverride).toBeUndefined();
    expect(savedSettings.chatModel).toBe('qwen2.5:3b');
    expect(electron.saveSettings).not.toHaveBeenCalled();
  });
});
