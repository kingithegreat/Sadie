/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { resizeImageFile } from '../utils/imageUtils';
import type { HomeBotRequestWithImages, Message } from '../../shared/types';

jest.mock('../utils/imageUtils', () => ({ resizeImageFile: jest.fn() }));

const PHOTO_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=';
const NOTE_TEXT = 'Please retain this exact document text on Retry.';
type SentRequest = HomeBotRequestWithImages & { streamId: string };
type StreamHandlers = {
  onStreamChunk: (payload: { streamId: string; chunk: string }) => void;
  onStreamEnd: (payload: { streamId: string; cancelled: boolean }) => void;
  onStreamError: (payload: { streamId: string; error: string }) => void;
};

let sendStreamMessage: jest.Mock;
let addMessage: jest.Mock;
let saveSettings: jest.Mock;
let handlers: Map<string, StreamHandlers>;

function mockElectron(settingsOverride: Record<string, unknown> = {}) {
  const settings = {
    firstRun: false, alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space',
    useCustomLLM: false, modelRoutingMode: 'off', chatModel: 'qwen2.5:3b', visionModel: 'llava',
    ...settingsOverride,
  };
  sendStreamMessage = jest.fn().mockResolvedValue(undefined);
  addMessage = jest.fn().mockResolvedValue({ success: true });
  saveSettings = jest.fn().mockResolvedValue(settings);
  handlers = new Map();
  (window as any).electron = {
    getSettings: jest.fn().mockResolvedValue(settings),
    saveSettings,
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [], activeConversationId: null } }),
    createConversation: jest.fn().mockResolvedValue({ success: true, data: { id: 'retry-conversation', systemPrompt: 'Keep replies simple.' } }),
    setActiveConversation: jest.fn().mockResolvedValue({ success: true }),
    getConversation: jest.fn().mockResolvedValue({ success: true, data: { id: 'retry-conversation', title: 'Conversation', messages: [] } }),
    saveConversation: jest.fn().mockResolvedValue({ success: true }),
    addMessage,
    updateMessage: jest.fn().mockResolvedValue({ success: true }),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }, { name: 'qwen2.5:7b' }, { name: 'llava' }] }),
    subscribeToStream: jest.fn((id: string, callbacks: StreamHandlers) => { handlers.set(id, callbacks); return jest.fn(); }),
    sendStreamMessage,
    writeClipboard: jest.fn().mockResolvedValue({ success: true }),
    cancelStream: jest.fn(),
    onMessage: jest.fn(() => jest.fn()),
    sendMessage: jest.fn(),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'online', ollama: 'online' }),
    getWidgetMode: jest.fn().mockResolvedValue(true),
    onWidgetModeChanged: jest.fn(() => jest.fn()),
    onConfirmationRequest: jest.fn(() => jest.fn()),
    onPermissionRequest: jest.fn(() => jest.fn()),
    onReminderFired: jest.fn(() => jest.fn()),
    onAutoProfileApplied: jest.fn(() => jest.fn()),
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    getEnv: jest.fn().mockResolvedValue({}),
  };
}

async function mountReady(initialMessages?: Message[]) {
  await act(async () => { render(<App initialMessages={initialMessages} />); });
  expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
}

async function attachPhoto() {
  const photo = new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Attach images'), { target: { files: [photo] } });
  // A prior sent message also shows this filename. Wait for the next file to
  // reach the actual composer before sending it, rather than its old thumbnail.
  await waitFor(() => expect(within(document.querySelector('.input-box')!).getByRole('img', { name: 'photo.png' })).toBeInTheDocument());
}

async function attachDocument() {
  const note = new File([NOTE_TEXT], 'notes.txt', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('Attach documents'), { target: { files: [note] } });
  await waitFor(() => expect(screen.getByText('notes.txt')).toBeInTheDocument());
}

async function send(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Message HomeBot' }), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}

async function failAndRetry(original: SentRequest) {
  act(() => { handlers.get(original.streamId)!.onStreamError({ streamId: original.streamId, error: 'Disposable provider failure.' }); });
  const retry = await screen.findByRole('button', { name: 'Retry' });
  await act(async () => { fireEvent.click(retry); });
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(2));
  return sendStreamMessage.mock.calls[1][0] as SentRequest;
}

beforeEach(() => {
  mockElectron();
  (resizeImageFile as jest.Mock).mockResolvedValue({
    filename: 'photo.png', mimeType: 'image/png', data: PHOTO_DATA, url: `data:image/png;base64,${PHOTO_DATA}`, size: 68,
  });
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  delete (window as any).electron;
  jest.clearAllMocks();
});

test.each(['Image', 'Document'])('a reopened %s Retry without bytes keeps the partial response available to copy', async kind => {
  const partial = 'Keep this useful partial answer while I find the attachment.';
  await mountReady([
    { id: 'saved-user', role: 'user', content: `[${kind} attached: notes]\n\nExplain this attachment.`, timestamp: '2026-10-07T00:00:00.000Z' },
    { id: 'saved-assistant', role: 'assistant', content: partial, timestamp: '2026-10-07T00:00:01.000Z', streamingState: 'error', error: true },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(`Reattach the original ${kind.toLowerCase()} and send your request again.`)).toBeInTheDocument();
  expect(screen.getByText(partial)).toBeInTheDocument();
  fireEvent.contextMenu(document.querySelector('[data-message-id="saved-assistant"]')!);
  await act(async () => { fireEvent.click(screen.getByText('Copy')); });
  expect(window.electron.writeClipboard).toHaveBeenCalledWith(partial);
  expect(sendStreamMessage).not.toHaveBeenCalled();
});

test('photo Retry resends the exact image payload and original request instead of text alone', async () => {
  await mountReady();
  await attachPhoto();
  await send('What is in this picture?');
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(1));
  const original = sendStreamMessage.mock.calls[0][0] as SentRequest;
  expect(original.images).toHaveLength(1);
  expect(original.images![0]).toEqual(expect.objectContaining({ filename: 'photo.png', mimeType: 'image/png', data: PHOTO_DATA }));
  expect(original.message).toBe('[Image attached: photo.png]\n\nWhat is in this picture?');
  expect(addMessage).toHaveBeenCalledWith('retry-conversation', expect.objectContaining({ role: 'user', content: original.message }));
  const retry = await failAndRetry(original);
  expect(retry).toEqual({ ...original, timestamp: expect.any(String), retry: true });
  expect(retry.images).toEqual(original.images);
  expect(retry.image).toEqual(original.image);
  expect(retry.conversationPrompt).toBe('Keep replies simple.');
});

test('document Retry resends the original file bytes without requiring an unnecessary reattachment', async () => {
  await mountReady();
  await attachDocument();
  await send('Summarize these notes.');
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(1));
  const original = sendStreamMessage.mock.calls[0][0] as SentRequest;
  expect(original.documents).toHaveLength(1);
  expect(original.documents![0]).toEqual(expect.objectContaining({ filename: 'notes.txt', mimeType: 'text/plain', data: btoa(NOTE_TEXT) }));
  const retry = await failAndRetry(original);
  expect(retry).toEqual({ ...original, timestamp: expect.any(String), retry: true });
  expect(retry.documents).toEqual(original.documents);
  expect(screen.queryByRole('button', { name: 'Reattach document' })).toBeNull();
});

test('retry retention counts both composer image strings and evicts the older request without sending an incomplete retry', async () => {
  const imageData = 'A'.repeat(6 * 1024 * 1024);
  (resizeImageFile as jest.Mock).mockResolvedValue({
    filename: 'photo.png', mimeType: 'image/png', data: imageData,
    url: `data:image/png;base64,${imageData}`, size: 4.5 * 1024 * 1024,
  });
  await mountReady();
  await attachPhoto();
  await send('Explain the first photo.');
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(1));
  const first = sendStreamMessage.mock.calls[0][0] as SentRequest;
  act(() => { handlers.get(first.streamId)!.onStreamError({ streamId: first.streamId, error: 'First provider failure.' }); });

  await attachPhoto();
  await send('Explain the second photo.');
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(2));
  const second = sendStreamMessage.mock.calls[1][0] as SentRequest;
  act(() => { handlers.get(second.streamId)!.onStreamError({ streamId: second.streamId, error: 'Second provider failure.' }); });
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]); });
  expect(await screen.findByText('Reattach the original image and send your request again.')).toBeInTheDocument();
  expect(sendStreamMessage).toHaveBeenCalledTimes(2);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(3));
  expect(sendStreamMessage.mock.calls[2][0]).toEqual({ ...second, timestamp: expect.any(String), retry: true });
  expect(sendStreamMessage.mock.calls[2][0].images).toEqual(second.images);
});

test('editing a failed request changes Retry wording while retaining its original document bytes', async () => {
  await mountReady();
  await attachDocument();
  await send('Summarize these notes.');
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(1));
  const original = sendStreamMessage.mock.calls[0][0] as SentRequest;
  // Retry deliberately refuses while the terminal reply is still being saved.
  // Complete its acknowledged persistence before exercising a later edit/Retry.
  await act(async () => {
    handlers.get(original.streamId)!.onStreamError({ streamId: original.streamId, error: 'Disposable provider failure.' });
  });
  expect(window.electron.updateMessage).toHaveBeenCalledWith('retry-conversation', original.streamId,
    expect.objectContaining({ streamingState: 'error', error: true }));
  fireEvent.contextMenu(document.querySelector('[data-role="user-message"]')!);
  fireEvent.click(screen.getByText('Edit'));
  const revised = '[Document attached: notes.txt]\n\nList the action items instead.';
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: revised } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(2));
  expect(sendStreamMessage.mock.calls[1][0]).toEqual({ ...original, message: revised, timestamp: expect.any(String), retry: true });
  expect(sendStreamMessage.mock.calls[1][0].documents).toEqual(original.documents);
});

test('Retry retains a confirmed one-request model override and attachments without changing the default', async () => {
  mockElectron({ modelRoutingMode: 'prompt' });
  await mountReady();
  await attachDocument();
  await send('Please summarize this document.');
  expect(await screen.findByText('Suggest Better Model')).toBeInTheDocument();
  expect(sendStreamMessage).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use suggested model' })); });
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(1));
  const original = sendStreamMessage.mock.calls[0][0] as SentRequest;
  expect(original.modelOverride).toBe('qwen2.5:7b');
  expect(original.documents![0].data).toBe(btoa(NOTE_TEXT));
  const retry = await failAndRetry(original);
  expect(retry.modelOverride).toBe('qwen2.5:7b');
  expect(retry.documents).toEqual(original.documents);
  expect(saveSettings).not.toHaveBeenCalled();
});

test.each([
  { marker: '[Image attached: photo.png]', action: 'Reattach images', input: 'Attach images', explanation: 'Reattach the original image and send your request again.' },
  { marker: '[Document attached: notes.txt]', action: 'Reattach document', input: 'Attach documents', explanation: 'Reattach the original document and send your request again.' },
])('a reopened $marker turn offers actual reattachment instead of an incomplete retry', async ({ marker, action, input, explanation }) => {
  await mountReady([
    { id: 'saved-user', role: 'user', content: `${marker}\n\nExplain this attachment.`, timestamp: '2026-10-07T00:00:00.000Z' },
    { id: 'saved-assistant', role: 'assistant', content: '', timestamp: '2026-10-07T00:00:01.000Z', streamingState: 'error', error: true },
  ]);
  expect(sendStreamMessage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(explanation)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(sendStreamMessage).not.toHaveBeenCalled();
  const picker = screen.getByLabelText(input) as HTMLInputElement;
  const clickPicker = jest.spyOn(picker, 'click');
  fireEvent.click(screen.getByRole('button', { name: action }));
  expect(clickPicker).toHaveBeenCalledTimes(1);
  expect(sendStreamMessage).not.toHaveBeenCalled();
});
