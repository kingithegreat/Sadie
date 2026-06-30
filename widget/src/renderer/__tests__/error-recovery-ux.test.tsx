/** @jest-environment jsdom */
/**
 * Tests for the inline error-recovery UX (Task #20).
 *
 * When the main process emits homebot:stream-error with a recoveryHint,
 * the renderer should display a contextual recovery card instead of the
 * generic "Something went wrong" banner.
 *
 * Scenarios covered:
 *   1. Ollama offline  — 🔌 icon, "Ollama Offline" title, "▶ Start Ollama" button
 *   2. Model missing   — 📦 icon, "Model Missing" title, "📦 Pull <model>" button
 *   3. n8n unavailable — ⚙️ icon, "n8n Unavailable" title, ↻ retry button
 *   4. No hint         — falls back to generic "Something went wrong" card
 *   5. Start Ollama success → startOllama IPC called, success label shown
 *   6. Pull Model success   → pullModel IPC called with correct model name, success label
 *   7. Start Ollama failure → inline error message shown
 *   8. recoveryHint preserved alongside partial streamed content
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import App from '../App';
import type { ElectronAPI } from '../../shared/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeElectronMock(overrides: Partial<ElectronAPI> = {}): ElectronAPI {
  return {
    cancelStream: jest.fn(),
    subscribeToStream: jest.fn(),
    getSettings: jest.fn().mockResolvedValue({
      alwaysOnTop: true,
      n8nUrl: 'http://localhost:5678',
      widgetHotkey: 'Ctrl+Shift+Space',
    }),
    saveSettings: jest.fn().mockResolvedValue(undefined),
    sendStreamMessage: jest.fn().mockResolvedValue(undefined),
    onMessage: jest.fn(() => jest.fn()),
    sendMessage: jest.fn(),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
    startOllama: jest.fn().mockResolvedValue({ success: true }),
    pullModel: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
  } as unknown as ElectronAPI;
}

/** Send a user message, stream a partial chunk, then fire stream-error with the given hint. */
async function triggerRecoveryCard(hint: object | null) {
  const el = makeElectronMock();
  let streamId: string | undefined;
  let chunkCb: ((d: any) => void) | undefined;
  let errorCb: ((d: any) => void) | undefined;

  (el.subscribeToStream as jest.Mock).mockImplementation((_sid: string, handlers: any) => {
    chunkCb = handlers.onStreamChunk;
    errorCb = handlers.onStreamError;
    return jest.fn();
  });
  (el.sendStreamMessage as jest.Mock).mockImplementation((p: any) => {
    streamId = p.streamId;
    return Promise.resolve();
  });

  (window as any).electron = el;
  render(<App />);

  // Send a message
  const textarea = screen.getByLabelText('Message HomeBot') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: 'hello' } });
  fireEvent.click(screen.getByText('Send'));
  await waitFor(() => expect(el.sendStreamMessage).toHaveBeenCalled());

  // Emit a partial chunk so there is some content
  act(() => { chunkCb?.({ streamId, chunk: 'partial response' }); });
  await waitFor(() => expect(screen.getByText('partial response')).toBeInTheDocument());

  // Emit the stream error with (or without) a recoveryHint
  act(() => {
    errorCb?.({
      streamId,
      error: 'upstream failed',
      ...(hint !== null ? { recoveryHint: hint } : {}),
    });
  });

  return { el };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('error recovery UX — inline recovery card', () => {
  beforeEach(() => { (window as any).electron = undefined; });

  // 1 ────────────────────────────────────────────────────────────────────────
  test('Ollama offline hint shows 🔌 icon, "Ollama Offline" title, and Start Ollama button', async () => {
    await triggerRecoveryCard({
      service: 'ollama',
      userMessage: 'Ollama is not running. Start it with: ollama serve',
      action: 'start-ollama',
      actionLabel: 'Retry',
    });

    await waitFor(() => expect(screen.getByText('Ollama Offline')).toBeInTheDocument());
    expect(screen.getByText('🔌')).toBeInTheDocument();
    expect(screen.getByText('Ollama is not running. Start it with: ollama serve')).toBeInTheDocument();
    // StartOllamaButton renders "▶ Start Ollama"
    expect(screen.getByRole('button', { name: /start ollama/i })).toBeInTheDocument();
    // Generic fallback should NOT appear
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  // 2 ────────────────────────────────────────────────────────────────────────
  test('Model missing hint shows 📦 icon, "Model Missing" title, and Pull button', async () => {
    await triggerRecoveryCard({
      service: 'model',
      userMessage: 'Model "mistral" is not installed.',
      action: 'pull-model',
      actionLabel: 'Pull mistral',
      model: 'mistral',
    });

    await waitFor(() => expect(screen.getByText('Model Missing')).toBeInTheDocument());
    // The 📦 icon in the card header (service icon)
    expect(screen.getAllByText('📦').length).toBeGreaterThan(0);
    expect(screen.getByText('Model "mistral" is not installed.')).toBeInTheDocument();
    // PullModelButton renders "📦 Pull mistral" — use regex that won't match ↻ Pull mistral
    const pullBtn = screen.getByRole('button', { name: /^📦 Pull mistral$/ });
    expect(pullBtn).toBeInTheDocument();
    // Generic fallback should NOT appear
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  // 3 ────────────────────────────────────────────────────────────────────────
  test('n8n unavailable hint shows ⚙️ icon, "n8n Unavailable" title, and Retry button', async () => {
    await triggerRecoveryCard({
      service: 'n8n',
      userMessage: 'The n8n automation service is unavailable.',
      action: 'retry',
      actionLabel: 'Retry',
    });

    await waitFor(() => expect(screen.getByText('n8n Unavailable')).toBeInTheDocument());
    expect(screen.getByText('⚙️')).toBeInTheDocument();
    expect(screen.getByText('The n8n automation service is unavailable.')).toBeInTheDocument();
    // The generic ↻ Retry button in the recovery card actions
    expect(screen.getByText('↻ Retry')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  // 4 ────────────────────────────────────────────────────────────────────────
  test('no recoveryHint falls back to generic "Something went wrong" card with Retry', async () => {
    await triggerRecoveryCard(null);

    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeInTheDocument());
    expect(screen.queryByText('Ollama Offline')).toBeNull();
    expect(screen.queryByText('Model Missing')).toBeNull();
    expect(screen.getByText('↻ Retry')).toBeInTheDocument();
  });

  // 5 ────────────────────────────────────────────────────────────────────────
  test('clicking "▶ Start Ollama" calls startOllama IPC and shows success label', async () => {
    const { el } = await triggerRecoveryCard({
      service: 'ollama',
      userMessage: 'Ollama is offline.',
      action: 'start-ollama',
      actionLabel: 'Retry',
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /start ollama/i })).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /start ollama/i })); });

    expect(el.startOllama).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/ollama running/i)).toBeInTheDocument()
    );
  });

  // 6 ────────────────────────────────────────────────────────────────────────
  test('clicking "📦 Pull mistral" calls pullModel IPC with correct model and shows success', async () => {
    const { el } = await triggerRecoveryCard({
      service: 'model',
      userMessage: 'Model "mistral" is not installed.',
      action: 'pull-model',
      actionLabel: 'Pull mistral',
      model: 'mistral',
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^📦 Pull mistral$/ })).toBeInTheDocument()
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^📦 Pull mistral$/ }));
    });

    expect(el.pullModel).toHaveBeenCalledWith('mistral');
    await waitFor(() =>
      expect(screen.getByText(/mistral pulled/i)).toBeInTheDocument()
    );
  });

  // 7 ────────────────────────────────────────────────────────────────────────
  test('failed startOllama call shows error text inline', async () => {
    const el = makeElectronMock({
      startOllama: jest.fn().mockResolvedValue({ success: false, error: 'Permission denied' }),
    });

    let streamId: string | undefined;
    let chunkCb: ((d: any) => void) | undefined;
    let errorCb: ((d: any) => void) | undefined;

    (el.subscribeToStream as jest.Mock).mockImplementation((_sid: string, handlers: any) => {
      chunkCb = handlers.onStreamChunk;
      errorCb = handlers.onStreamError;
      return jest.fn();
    });
    (el.sendStreamMessage as jest.Mock).mockImplementation((p: any) => {
      streamId = p.streamId;
      return Promise.resolve();
    });

    (window as any).electron = el;
    render(<App />);

    const textarea = screen.getByLabelText('Message HomeBot') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(el.sendStreamMessage).toHaveBeenCalled());

    act(() => { chunkCb?.({ streamId, chunk: 'starting...' }); });
    await waitFor(() => expect(screen.getByText('starting...')).toBeInTheDocument());

    act(() => {
      errorCb?.({
        streamId,
        error: 'econnrefused',
        recoveryHint: {
          service: 'ollama',
          userMessage: 'Ollama is offline.',
          action: 'start-ollama',
          actionLabel: 'Retry',
        },
      });
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /start ollama/i })).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /start ollama/i })); });

    expect(el.startOllama).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('Permission denied')).toBeInTheDocument()
    );
  });

  // 8 ────────────────────────────────────────────────────────────────────────
  test('recoveryHint card appears alongside partial streamed content', async () => {
    await triggerRecoveryCard({
      service: 'ollama',
      userMessage: 'Connection reset mid-stream.',
      action: 'start-ollama',
      actionLabel: 'Retry',
    });

    await waitFor(() => {
      expect(screen.getByText('partial response')).toBeInTheDocument();
      expect(screen.getByText('Ollama Offline')).toBeInTheDocument();
      expect(screen.getByText('Connection reset mid-stream.')).toBeInTheDocument();
    });
  });
});
