/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { ElectronAPI } from '../../shared/types';

describe('model routing prompt mode', () => {
  beforeEach(() => {
    (window as any).electron = {
      cancelStream: jest.fn(),
      subscribeToStream: jest.fn(() => jest.fn()),
      getSettings: jest.fn().mockResolvedValue({
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

  test('prompt mode asks before applying a suggested model override', async () => {
    render(<App />);

    const textarea = await screen.findByLabelText('Message SADIE');
    fireEvent.change(textarea, { target: { value: 'compare the pros and cons of local versus cloud models for privacy' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText('Suggest Better Model')).toBeInTheDocument());
    expect((window as any).electron.sendStreamMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Use suggested model'));

    await waitFor(() => expect((window as any).electron.sendStreamMessage).toHaveBeenCalledTimes(1));
    const payload = ((window as any).electron.sendStreamMessage as jest.Mock).mock.calls[0][0];
    expect(payload.modelOverride).toBe('qwen2.5:7b');
  });
});