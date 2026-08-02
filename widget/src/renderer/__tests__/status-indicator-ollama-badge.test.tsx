/** @jest-environment jsdom */
/**
 * status-indicator-ollama-badge.test.tsx
 * Tests the proactive Ollama offline badge in src/renderer/components/StatusIndicator.tsx.
 * The badge mirrors the n8n BackendBadge but adds an inline "Start Ollama" action so a
 * mid-session Ollama drop is recoverable in-place instead of only after the next message fails.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import StatusIndicator from '../components/StatusIndicator';
import { ConnectionStatus } from '../../shared/types';

const mockStartOllama = jest.fn();
const mockGetUncensoredMode = jest.fn();

beforeAll(() => {
  (window as any).electron = {
    startOllama: mockStartOllama,
    getUncensoredMode: mockGetUncensoredMode,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUncensoredMode.mockResolvedValue({ enabled: false });
  mockStartOllama.mockResolvedValue({ success: true });
});

const baseProps = {
  onRefresh: jest.fn(),
  onSettingsClick: jest.fn(),
};

async function renderWith(connection: ConnectionStatus, extra = {}) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <StatusIndicator connectionStatus={connection} {...baseProps} {...extra} />
    );
  });
  return result!;
}

describe('StatusIndicator — Ollama offline badge', () => {
  test('shows the badge when Ollama is offline', async () => {
    await renderWith({ n8n: 'online', ollama: 'offline' });
    expect(screen.getByText('Ollama offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start ollama/i })).toBeInTheDocument();
  });

  test('hides the badge when Ollama is online', async () => {
    await renderWith({ n8n: 'online', ollama: 'online' });
    expect(screen.queryByText('Ollama offline')).not.toBeInTheDocument();
  });

  test('hides the badge while connection is still checking', async () => {
    await renderWith({ n8n: 'checking', ollama: 'checking' });
    expect(screen.queryByText('Ollama offline')).not.toBeInTheDocument();
  });

  test('Start calls startOllama then onRefresh on success', async () => {
    const onRefresh = jest.fn();
    await renderWith({ n8n: 'online', ollama: 'offline' }, { onRefresh });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start ollama/i }));
    });
    expect(mockStartOllama).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  test('shows error text when start fails', async () => {
    mockStartOllama.mockResolvedValue({ success: false, error: 'ollama binary not found' });
    await renderWith({ n8n: 'online', ollama: 'offline' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start ollama/i }));
    });
    expect(await screen.findByText('ollama binary not found')).toBeInTheDocument();
  });

  test('retry button calls onRefresh', async () => {
    const onRefresh = jest.fn();
    await renderWith({ n8n: 'online', ollama: 'offline' }, { onRefresh });
    fireEvent.click(screen.getByRole('button', { name: /retry connection/i }));
    expect(onRefresh).toHaveBeenCalled();
  });
});
