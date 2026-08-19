/** @jest-environment jsdom */

/**
 * The recovery buttons have to reach the screen.
 *
 * classifyError deciding to offer a cloud switch is only half the chain — the
 * error bubble has to draw it, and pressing it has to change the setting the
 * router reads. A hint nothing renders is the dominant defect shape in this
 * codebase, so these tests drive the rendered bubble rather than the classifier.
 *
 * The save is the part most worth pinning. `saveSettings` takes a WHOLE
 * settings object and only guards SECRET_KEYS against omission, so sending
 * `{ useCustomLLM: true }` on its own would erase every other non-secret key
 * the user has. It must be read-modify-write.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageBubble } from '../components/MessageBubble';
import type { ChatMessage } from '../types';

const noop = () => {};

const EXISTING_SETTINGS = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
  chatModel: 'qwen2.5:7b',
  theme: 'dark',
  useCustomLLM: false,
  anthropicApiKey: 'sk-ant-test',
};

let getSettings: jest.Mock;
let saveSettings: jest.Mock;
let startOllama: jest.Mock;

beforeEach(() => {
  getSettings = jest.fn().mockResolvedValue({ ...EXISTING_SETTINGS });
  saveSettings = jest.fn().mockResolvedValue({ ...EXISTING_SETTINGS, useCustomLLM: true });
  startOllama = jest.fn().mockResolvedValue({ success: true });
  (window as any).electron = { getSettings, saveSettings, startOllama, writeClipboard: jest.fn() };
});

afterEach(() => { delete (window as any).electron; });

function erroredMessage(hint: ChatMessage['recoveryHint']): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    streamingState: 'error',
    error: 'Ollama error',
    recoveryHint: hint,
  } as ChatMessage;
}

const OLLAMA_DOWN_WITH_CLOUD = {
  service: 'ollama' as const,
  userMessage: "The AI on this PC isn't running. Start it below, or switch to the online AI you already set up.",
  action: 'start-ollama' as const,
  actionLabel: 'Retry',
  cloudFallback: { provider: 'anthropic', model: 'claude-sonnet-5' },
};

const OLLAMA_DOWN_NO_CLOUD = {
  service: 'ollama' as const,
  userMessage: "The AI on this PC isn't running. Start it below, then send your message again.",
  action: 'start-ollama' as const,
  actionLabel: 'Retry',
};

describe('error bubble recovery actions', () => {
  test('offers both Start Ollama and the cloud switch when a provider is ready', () => {
    render(<MessageBubble message={erroredMessage(OLLAMA_DOWN_WITH_CLOUD)} onCancel={noop} onRetry={noop} />);

    expect(screen.getByText(/Start Ollama/)).toBeInTheDocument();
    expect(screen.getByText(/Use the online AI instead/)).toBeInTheDocument();
  });

  test('offers only Start Ollama when no cloud provider is configured', () => {
    render(<MessageBubble message={erroredMessage(OLLAMA_DOWN_NO_CLOUD)} onCancel={noop} onRetry={noop} />);

    expect(screen.getByText(/Start Ollama/)).toBeInTheDocument();
    expect(screen.queryByText(/Use the online AI instead/)).toBeNull();
  });

  test('a timeout offers the cloud switch without offering to start a service that is running', () => {
    render(<MessageBubble message={erroredMessage({
      service: 'unknown',
      userMessage: 'That took too long to answer.',
      action: 'retry',
      actionLabel: 'Retry',
      cloudFallback: { provider: 'openai', model: 'gpt-4o' },
    })} onCancel={noop} onRetry={noop} />);

    expect(screen.getByText(/Use the online AI instead/)).toBeInTheDocument();
    expect(screen.queryByText(/Start Ollama/)).toBeNull();
  });

  test('pressing the switch preserves every existing setting, not just the flag', async () => {
    render(<MessageBubble message={erroredMessage(OLLAMA_DOWN_WITH_CLOUD)} onCancel={noop} onRetry={noop} />);

    fireEvent.click(screen.getByText(/Use the online AI instead/));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    const saved = saveSettings.mock.calls[0][0];

    expect(saved.useCustomLLM).toBe(true);
    // Everything else must survive — a partial save wipes what it omits.
    expect(saved.chatModel).toBe('qwen2.5:7b');
    expect(saved.n8nUrl).toBe('http://localhost:5678');
    expect(saved.widgetHotkey).toBe('Ctrl+Shift+Space');
    expect(saved.anthropicApiKey).toBe('sk-ant-test');
    expect(saved.theme).toBe('dark');
  });

  test('the switch retries the message once the setting has been saved', async () => {
    const onRetry = jest.fn();
    render(<MessageBubble message={erroredMessage(OLLAMA_DOWN_WITH_CLOUD)} onCancel={noop} onRetry={onRetry} />);

    fireEvent.click(screen.getByText(/Use the online AI instead/));

    await waitFor(() => expect(onRetry).toHaveBeenCalledWith('msg-1'));
    expect(saveSettings).toHaveBeenCalled();
  });

  test('a failed save does not retry, and says so instead of silently doing nothing', async () => {
    saveSettings.mockRejectedValue(new Error('disk is read-only'));
    const onRetry = jest.fn();
    render(<MessageBubble message={erroredMessage(OLLAMA_DOWN_WITH_CLOUD)} onCancel={noop} onRetry={onRetry} />);

    fireEvent.click(screen.getByText(/Use the online AI instead/));

    await waitFor(() => expect(screen.getByText(/disk is read-only/)).toBeInTheDocument());
    expect(onRetry).not.toHaveBeenCalled();
  });

  test('Start Ollama calls the IPC handler and reports success', async () => {
    render(<MessageBubble message={erroredMessage(OLLAMA_DOWN_WITH_CLOUD)} onCancel={noop} onRetry={noop} />);

    fireEvent.click(screen.getByText(/Start Ollama/));

    await waitFor(() => expect(startOllama).toHaveBeenCalledTimes(1));
    // It must not quietly flip the privacy switch as a side effect.
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
