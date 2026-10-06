/** @jest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { contextBridge, ipcRenderer } from 'electron';
import '../../preload/index';
import App from '../App';

// Exercise the actual App, FirstRunModal, chat controls and acknowledgement
// bridges. Only IPC/provider responses and unrelated background services are
// isolated fixtures; no wizard or App component is replaced.
jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: jest.fn() },
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(), send: jest.fn(), removeListener: jest.fn() },
}));

const preload = (contextBridge.exposeInMainWorld as jest.Mock).mock.calls.find(([name]) => name === 'electron')![1];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const initialSettings = {
  firstRun: true, theme: 'dark', alwaysOnTop: true, n8nUrl: 'http://127.0.0.1:1',
  widgetHotkey: 'Ctrl+Shift+Space', modelRoutingMode: 'off',
  chatModel: 'qwen2.5:7b', uncensoredMode: true, useCustomLLM: true,
  customLLM: { name: 'Old service', provider: 'groq', model: 'previous-cloud-model', apiUrl: 'https://api.groq.com/openai/v1', apiKey: 'fixture-only', enabled: true },
};
let persisted = clone(initialSettings);
let runtimeUncensored: boolean;
let modeResult: Promise<{ success: boolean; enabled: boolean }> | undefined;
let events: string[];
let sendStreamMessage: jest.Mock;
let endStream: ((payload: { streamId: string; cancelled: boolean }) => void) | undefined;

beforeEach(() => {
  persisted = clone(initialSettings);
  runtimeUncensored = true;
  modeResult = undefined;
  events = [];
  endStream = undefined;
  window.localStorage.clear();
  (ipcRenderer.invoke as jest.Mock).mockReset().mockImplementation(async (channel, value) => {
    if (channel === 'homebot:get-settings') return clone(persisted);
    if (channel === 'homebot:save-settings') {
      persisted = clone(value);
      events.push('saved');
      return { success: true, data: clone(persisted) };
    }
    if (channel === 'homebot:set-uncensored-mode') {
      events.push('apply-started');
      const result = modeResult ? await modeResult : { success: true, enabled: value };
      if (result.success && result.enabled === value) {
        runtimeUncensored = value;
        events.push('applied');
      }
      return result;
    }
    return undefined;
  });
  sendStreamMessage = jest.fn(async () => {
    // This assertion describes the mode seen when the real App dispatches its
    // first message; native HTTP acceptance additionally proves the model.
    expect(runtimeUncensored).toBe(false);
    events.push('first-message');
  });
  const conversation = { id: 'setup-conversation', title: 'Conversation', messages: [], createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' };
  (window as any).electron = {
    getSettings: preload.getSettings,
    saveSettings: preload.saveSettings,
    setUncensoredMode: preload.setUncensoredMode,
    getUncensoredMode: jest.fn(async () => ({ enabled: runtimeUncensored })),
    getWidgetMode: jest.fn().mockResolvedValue(true),
    onWidgetModeChanged: jest.fn(() => jest.fn()),
    checkConnection: jest.fn().mockResolvedValue({ n8n: 'offline', ollama: 'online' }),
    getEnv: jest.fn().mockResolvedValue({ isE2E: false }),
    detectGpuVram: jest.fn().mockResolvedValue({ success: true, vramGB: 4, gpuName: 'Fixture GPU' }),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }] }),
    onPullModelProgress: jest.fn(() => jest.fn()),
    onOllamaDownloadProgress: jest.fn(() => jest.fn()),
    pullModelStream: jest.fn(), downloadOllama: jest.fn(),
    resolveActiveModel: jest.fn(async () => ({ success: true, source: 'local', model: persisted.chatModel })),
    moduleList: jest.fn().mockResolvedValue({ ok: true, modules: [] }),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [] } }),
    createConversation: jest.fn().mockResolvedValue({ success: true, data: conversation }),
    getConversation: jest.fn().mockResolvedValue({ success: true, data: conversation }),
    setActiveConversation: jest.fn().mockResolvedValue({ success: true }),
    saveConversation: jest.fn().mockResolvedValue({ success: true }),
    addMessage: jest.fn().mockResolvedValue({ success: true }),
    updateMessage: jest.fn().mockResolvedValue({ success: true }),
    onMessage: jest.fn(() => jest.fn()),
    subscribeToStream: jest.fn((_id: string, callbacks: { onStreamEnd: typeof endStream }) => { endStream = callbacks.onStreamEnd; return jest.fn(); }),
    sendStreamMessage,
  };
});

afterEach(() => {
  cleanup();
  delete (window as any).electron;
});

async function chooseLocalAndReachFinish() {
  await act(async () => { render(<App />); });
  const welcome = await screen.findByRole('dialog', { name: 'Welcome to HomeBot' });
  fireEvent.click(within(welcome).getByRole('button', { name: /On this PC/ }));
  await screen.findByText('Ollama is ready!');
  expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('qwen2.5:3b');
  expect((window as any).electron.pullModelStream).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  return screen.getByRole('dialog', { name: 'Ready to chat on this PC' });
}

function modeInvocations() {
  return (ipcRenderer.invoke as jest.Mock).mock.calls.filter(([channel]) => channel === 'homebot:set-uncensored-mode');
}

test('actual setup saves the installed local choice and waits for runtime acknowledgement before closing or the first send', async () => {
  let resolveMode!: (value: { success: boolean; enabled: boolean }) => void;
  modeResult = new Promise(resolve => { resolveMode = resolve; });
  const wizard = await chooseLocalAndReachFinish();
  await act(async () => { fireEvent.click(within(wizard).getByRole('button', { name: 'Get Started' })); });
  try {
    expect(persisted).toMatchObject({ firstRun: false, chatModel: 'qwen2.5:3b', codeModel: 'qwen2.5:3b', useCustomLLM: false, uncensoredMode: false, customLLM: { enabled: false } });
    expect(modeInvocations()).toEqual([['homebot:set-uncensored-mode', false]]);
    expect(runtimeUncensored).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Ready to chat on this PC' })).toBeInTheDocument();
    expect(within(wizard).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(sendStreamMessage).not.toHaveBeenCalled();
    expect(events).toEqual(['saved', 'apply-started']);
  } finally {
    await act(async () => { resolveMode({ success: true, enabled: false }); });
  }
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ready to chat on this PC' })).toBeNull());
  const composer = screen.getByRole('textbox', { name: 'Message HomeBot' });
  fireEvent.change(composer, { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = sendStreamMessage.mock.calls[0][0];
  try {
    expect(request).toMatchObject({ message: 'Hello', conversation_id: 'setup-conversation' });
    expect(events).toEqual(['saved', 'apply-started', 'applied', 'first-message']);
  } finally {
    act(() => { endStream?.({ streamId: request.streamId, cancelled: false }); });
  }
});

test.each(['rejected', 'wrong acknowledgement', 'unsuccessful acknowledgement'])('saved-but-not-applied %s remains in setup and retries the mode application', async failure => {
  if (failure === 'rejected') {
    const rejected = Promise.reject(new Error('fixture mode transport failed'));
    // This fixture is created before the UI reaches it; handle its rejection
    // until the real App awaits the same promise.
    rejected.catch(() => {});
    modeResult = rejected;
  } else {
    modeResult = Promise.resolve({ success: failure !== 'unsuccessful acknowledgement', enabled: true });
  }
  const wizard = await chooseLocalAndReachFinish();
  await act(async () => { fireEvent.click(within(wizard).getByRole('button', { name: 'Get Started' })); });
  expect(persisted).toMatchObject({ firstRun: false, chatModel: 'qwen2.5:3b', uncensoredMode: false });
  expect(runtimeUncensored).toBe(true);
  expect(screen.getByRole('dialog', { name: 'Ready to chat on this PC' })).toBeInTheDocument();
  expect(within(wizard).getByRole('alert')).toHaveTextContent('Your choices were saved, but HomeBot could not apply the model mode');
  expect(within(wizard).getByRole('button', { name: 'Get Started' })).toBeEnabled();
  expect(sendStreamMessage).not.toHaveBeenCalled();
  modeResult = undefined;
  await act(async () => { fireEvent.click(within(wizard).getByRole('button', { name: 'Get Started' })); });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ready to chat on this PC' })).toBeNull());
  expect(runtimeUncensored).toBe(false);
  expect(modeInvocations()).toEqual([['homebot:set-uncensored-mode', false], ['homebot:set-uncensored-mode', false]]);
  expect(sendStreamMessage).not.toHaveBeenCalled();
});

test('a failed actual settings acknowledgement stays in setup without attempting a runtime change', async () => {
  const invoke = (ipcRenderer.invoke as jest.Mock).getMockImplementation()!;
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async (channel, value) => {
    if (channel === 'homebot:save-settings') return { success: false, error: 'fixture disk read-only' };
    return invoke(channel, value);
  });
  const wizard = await chooseLocalAndReachFinish();
  await act(async () => { fireEvent.click(within(wizard).getByRole('button', { name: 'Get Started' })); });
  expect(persisted).toEqual(initialSettings);
  expect(modeInvocations()).toHaveLength(0);
  expect(within(wizard).getByRole('alert')).toHaveTextContent('fixture disk read-only');
  expect(screen.getByRole('dialog', { name: 'Ready to chat on this PC' })).toBeInTheDocument();
});
