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

function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test.each([
  { inventory: ['qwen2.5:3b'], selected: 'qwen2.5:3b', explicit: false },
  { inventory: ['qwen2.5:3b', 'llama3.2:3b'], selected: 'llama3.2:3b', explicit: true },
])('a late mount settings read preserves the installed setup choice $selected (explicit: $explicit)', async ({ inventory, selected, explicit }) => {
  const electron = (window as any).electron;
  electron.listOllamaModels.mockResolvedValue({ success: true, models: inventory.map(name => ({ name })) });
  const staleSettings = clone(initialSettings);
  const lateRead = held<typeof staleSettings>();
  const invoke = (ipcRenderer.invoke as jest.Mock).getMockImplementation()!;
  let settingsReads = 0;
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async (channel, value) => {
    if (channel === 'homebot:get-settings' && ++settingsReads === 2) return lateRead.promise;
    return invoke(channel, value);
  });

  await act(async () => { render(<App />); });
  const welcome = await screen.findByRole('dialog', { name: 'Welcome to HomeBot' });
  expect(settingsReads).toBeGreaterThanOrEqual(2);
  fireEvent.click(within(welcome).getByRole('button', { name: /On this PC/ }));
  await screen.findByText('Ollama is ready!');
  const choice = screen.getByRole('combobox', { name: 'Select chat model' });
  if (explicit) fireEvent.change(choice, { target: { value: selected } });
  expect(choice).toHaveValue(selected);

  // The earlier App settings request completes after inventory verification
  // and the user's choice. It must not replace that choice with the absent 7B.
  await act(async () => { lateRead.resolve(staleSettings); });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Started' })); });
  expect(persisted).toMatchObject({ firstRun: false, chatModel: selected, codeModel: selected, uncensoredMode: false, useCustomLLM: false });
  expect(electron.pullModelStream).not.toHaveBeenCalled();
  expect(electron.downloadOllama).not.toHaveBeenCalled();
  expect(runtimeUncensored).toBe(false);
  expect(screen.queryByRole('dialog', { name: 'Ready to chat on this PC' })).toBeNull();
});

test('a mount settings read arriving after Finish preserves the selected context window for the first real send', async () => {
  const electron = (window as any).electron;
  electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'llama3.2:3b' }] });
  const staleSettings = clone(initialSettings);
  const lateRead = held<typeof staleSettings>();
  const invoke = (ipcRenderer.invoke as jest.Mock).getMockImplementation()!;
  let settingsReads = 0;
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async (channel, value) => {
    if (channel === 'homebot:get-settings' && ++settingsReads === 2) return lateRead.promise;
    return invoke(channel, value);
  });

  await act(async () => { render(<App />); });
  const welcome = await screen.findByRole('dialog', { name: 'Welcome to HomeBot' });
  expect(settingsReads).toBeGreaterThanOrEqual(2);
  fireEvent.click(within(welcome).getByRole('button', { name: /On this PC/ }));
  await screen.findByText('Ollama is ready!');
  expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('llama3.2:3b');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Started' })); });
  expect(persisted).toMatchObject({ firstRun: false, chatModel: 'llama3.2:3b', codeModel: 'llama3.2:3b' });
  expect(screen.queryByRole('dialog', { name: 'Ready to chat on this PC' })).toBeNull();
  const tokenCounter = document.querySelector('.token-counter');
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 131,072'));

  // Its settings snapshot predates the completed choice. The real context
  // counter must continue using the selected 128K model after it arrives.
  await act(async () => { lateRead.resolve(staleSettings); });
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 131,072'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message HomeBot' }), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(sendStreamMessage).toHaveBeenCalledTimes(1));
  const request = sendStreamMessage.mock.calls[0][0];
  try {
    // The real request leaves model choice to persisted main settings when
    // routing is off; it does not carry a fabricated chatModel packet field.
    expect(request).toMatchObject({ message: 'Hello', conversation_id: 'setup-conversation' });
    expect(request.modelOverride).toBeUndefined();
    expect(persisted.chatModel).toBe('llama3.2:3b');
    expect(runtimeUncensored).toBe(false);
    expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 131,072'));
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    expect(electron.downloadOllama).not.toHaveBeenCalled();
  } finally {
    act(() => { endStream?.({ streamId: request.streamId, cancelled: false }); });
  }
});

test('an unchanged mount read still applies the model returned by the actual settings bridge', async () => {
  persisted.firstRun = false;
  const lateRead = held<typeof persisted>();
  const invoke = (ipcRenderer.invoke as jest.Mock).getMockImplementation()!;
  let settingsReads = 0;
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async (channel, value) => {
    if (channel === 'homebot:get-settings' && ++settingsReads === 2) return lateRead.promise;
    return invoke(channel, value);
  });
  await act(async () => { render(<App />); });
  expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
  expect(settingsReads).toBeGreaterThanOrEqual(2);
  expect(screen.queryByRole('dialog', { name: 'Welcome to HomeBot' })).toBeNull();
  const tokenCounter = document.querySelector('.token-counter');
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 32,768'));

  // No choice or save has superseded this read. Its model must reach the real
  // counter; suppressing every mount read would leave the previous 32K limit.
  persisted.chatModel = 'llama3.2:3b';
  await act(async () => { lateRead.resolve(clone(persisted)); });
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 131,072'));
  expect((ipcRenderer.invoke as jest.Mock).mock.calls.filter(([channel]) => channel === 'homebot:save-settings')).toHaveLength(0);
  expect(sendStreamMessage).not.toHaveBeenCalled();
});

test('a registered model fallback supersedes an earlier mount settings read', async () => {
  persisted.firstRun = false;
  const staleSettings = clone(persisted);
  const lateRead = held<typeof staleSettings>();
  const invoke = (ipcRenderer.invoke as jest.Mock).getMockImplementation()!;
  let settingsReads = 0;
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async (channel, value) => {
    if (channel === 'homebot:get-settings' && ++settingsReads === 2) return lateRead.promise;
    return invoke(channel, value);
  });
  const fallbackSubscription = jest.fn((_callback: (data: { from: string; to: string }) => void) => jest.fn());
  (window as any).electron.onModelFallback = fallbackSubscription;
  await act(async () => { render(<App />); });
  expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
  expect(settingsReads).toBeGreaterThanOrEqual(2);
  expect(fallbackSubscription).toHaveBeenCalledTimes(1);
  const onFallback = fallbackSubscription.mock.calls[0][0];
  const tokenCounter = document.querySelector('.token-counter');
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 32,768'));

  // Deliver the event through the callback installed by the actual App effect.
  // No settings save in the renderer is needed for this newer model decision.
  persisted.chatModel = 'llama3.2:3b';
  act(() => { onFallback({ from: 'qwen2.5:7b', to: 'llama3.2:3b' }); });
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 131,072'));
  await act(async () => { lateRead.resolve(staleSettings); });
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 131,072'));
  expect((ipcRenderer.invoke as jest.Mock).mock.calls.filter(([channel]) => channel === 'homebot:save-settings')).toHaveLength(0);
  expect(sendStreamMessage).not.toHaveBeenCalled();
});

test('a startup fallback survives the primary settings snapshot while conversation loading is pending', async () => {
  persisted.theme = 'light';
  const conversations = held<{ success: true; data: { conversations: [] } }>();
  (window as any).electron.loadConversations.mockReturnValueOnce(conversations.promise);
  const fallbackSubscription = jest.fn((_callback: (data: { from: string; to: string }) => void) => jest.fn());
  (window as any).electron.onModelFallback = fallbackSubscription;
  await act(async () => { render(<App />); });
  const root = screen.getByTestId('homebot-app-root');
  expect(root).not.toHaveAttribute('data-hydrated', 'true');
  expect((ipcRenderer.invoke as jest.Mock).mock.calls.filter(([channel]) => channel === 'homebot:get-settings')).toHaveLength(2);
  const tokenCounter = document.querySelector('.token-counter');
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 32,768'));

  persisted.chatModel = 'llama3.2:3b';
  act(() => { fallbackSubscription.mock.calls[0][0]({ from: 'qwen2.5:7b', to: 'llama3.2:3b' }); });
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 131,072'));
  await act(async () => { conversations.resolve({ success: true, data: { conversations: [] } }); });
  expect(root).toHaveAttribute('data-hydrated', 'true');
  expect(tokenCounter).toHaveAttribute('title', expect.stringContaining('of 131,072'));
  // The initial snapshot still owns unrelated configuration and first-run
  // intent; ignoring the entire boot snapshot would lose these fields.
  expect(root).toHaveAttribute('data-theme', 'light');
  expect(await screen.findByRole('dialog', { name: 'Welcome to HomeBot' })).toBeInTheDocument();
  expect((ipcRenderer.invoke as jest.Mock).mock.calls.filter(([channel]) => channel === 'homebot:save-settings')).toHaveLength(0);
  expect(sendStreamMessage).not.toHaveBeenCalled();
});

test('the post-subscription settings model survives an older primary boot snapshot', async () => {
  persisted.theme = 'light';
  const oldSettings = clone(persisted);
  persisted.chatModel = 'llama3.2:3b';
  const conversations = held<{ success: true; data: { conversations: [] } }>();
  (window as any).electron.loadConversations.mockReturnValueOnce(conversations.promise);
  const invoke = (ipcRenderer.invoke as jest.Mock).getMockImplementation()!;
  let reads = 0;
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async (channel, value) => {
    if (channel === 'homebot:get-settings' && ++reads === 1) return oldSettings;
    return invoke(channel, value);
  });
  await act(async () => { render(<App />); });
  expect(reads).toBe(2);
  const root = screen.getByTestId('homebot-app-root');
  const counter = document.querySelector('.token-counter');
  expect(root).not.toHaveAttribute('data-hydrated', 'true');
  expect(counter).toHaveAttribute('title', expect.stringContaining('of 131,072'));
  await act(async () => { conversations.resolve({ success: true, data: { conversations: [] } }); });
  expect(root).toHaveAttribute('data-hydrated', 'true');
  expect(counter).toHaveAttribute('title', expect.stringContaining('of 131,072'));
  expect(root).toHaveAttribute('data-theme', 'light');
  expect(await screen.findByRole('dialog', { name: 'Welcome to HomeBot' })).toBeInTheDocument();
  expect(sendStreamMessage).not.toHaveBeenCalled();
});

test('a full settings save before boot hydration supersedes the entire older snapshot', async () => {
  persisted.firstRun = false;
  const conversations = held<{ success: true; data: { conversations: [] } }>();
  (window as any).electron.loadConversations.mockReturnValueOnce(conversations.promise);
  await act(async () => { render(<App />); });
  const root = screen.getByTestId('homebot-app-root');
  expect(root).not.toHaveAttribute('data-hydrated', 'true');
  fireEvent.keyDown(window, { ctrlKey: true, key: ',' });
  const panel = await screen.findByRole('dialog', { name: 'Settings' });
  fireEvent.click(within(panel).getByRole('button', { name: 'light theme' }));
  await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' })); });
  expect(persisted.theme).toBe('light');
  expect(root).toHaveAttribute('data-theme', 'light');
  expect((ipcRenderer.invoke as jest.Mock).mock.calls.filter(([channel]) => channel === 'homebot:save-settings')).toHaveLength(1);
  await act(async () => { conversations.resolve({ success: true, data: { conversations: [] } }); });
  expect(root).toHaveAttribute('data-hydrated', 'true');
  expect(root).toHaveAttribute('data-theme', 'light');
  expect(screen.queryByRole('dialog', { name: 'Welcome to HomeBot' })).toBeNull();
  expect(sendStreamMessage).not.toHaveBeenCalled();
});

test('a rejected settings save still hydrates the original first-run configuration', async () => {
  persisted.theme = 'light';
  const conversations = held<{ success: true; data: { conversations: [] } }>();
  (window as any).electron.loadConversations.mockReturnValueOnce(conversations.promise);
  const invoke = (ipcRenderer.invoke as jest.Mock).getMockImplementation()!;
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async (channel, value) => {
    if (channel === 'homebot:save-settings') throw new Error('Configuration was not saved');
    return invoke(channel, value);
  });
  await act(async () => { render(<App />); });
  const root = screen.getByTestId('homebot-app-root');
  expect(root).not.toHaveAttribute('data-hydrated', 'true');
  fireEvent.keyDown(window, { ctrlKey: true, key: ',' });
  const panel = await screen.findByRole('dialog', { name: 'Settings' });
  fireEvent.click(within(panel).getByRole('button', { name: 'light theme' }));
  await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' })); });
  expect(await within(panel).findByRole('alert')).toHaveTextContent('Configuration was not saved');
  await act(async () => { conversations.resolve({ success: true, data: { conversations: [] } }); });
  expect(root).toHaveAttribute('data-hydrated', 'true');
  expect(root).toHaveAttribute('data-theme', 'light');
  expect(await screen.findByRole('dialog', { name: 'Welcome to HomeBot' })).toBeInTheDocument();
  expect(persisted.firstRun).toBe(true);
  expect(sendStreamMessage).not.toHaveBeenCalled();
});

async function startDownloadAndReturnToLocal() {
  const electron = (window as any).electron;
  const pull = held<{ success: boolean; error?: string }>();
  electron.listOllamaModels.mockResolvedValue({ success: true, models: [] });
  electron.pullModelStream.mockReturnValueOnce(pull.promise);
  await act(async () => { render(<App />); });
  const welcome = await screen.findByRole('dialog', { name: 'Welcome to HomeBot' });
  // App's real header checks inventory on mount. Count wizard checks from
  // this user gesture without suppressing that independent production path.
  electron.listOllamaModels.mockClear();
  await act(async () => { fireEvent.click(within(welcome).getByRole('button', { name: /On this PC/ })); });
  expect(electron.pullModelStream).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText(/continues in the background/)).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /On this PC/ })); });
  expect(screen.getByRole('button', { name: 'Download AI' })).toBeDisabled();
  expect(electron.listOllamaModels).toHaveBeenCalledTimes(2);
  expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
  return { electron, pull };
}

test('returning to actual local setup verifies the original background download before enabling Finish, without another pull', async () => {
  const { electron, pull } = await startDownloadAndReturnToLocal();
  const inventory = held<{ success: boolean; models: { name: string }[] }>();
  electron.listOllamaModels.mockReturnValueOnce(inventory.promise);
  await act(async () => { pull.resolve({ success: true }); });
  expect(electron.listOllamaModels).toHaveBeenCalledTimes(3);
  expect(screen.getByText('Checking installed models...')).toBeInTheDocument();
  expect(screen.queryByText('Ollama is ready!')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download AI' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Setting up...' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Skip setup' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Skip setup' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(events).toEqual([]);
  expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
  await act(async () => { inventory.resolve({ success: true, models: [{ name: 'qwen2.5:3b' }] }); });
  expect(screen.getByText('Ollama is ready!')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('qwen2.5:3b');
  expect(screen.queryByText(/continues in the background/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Skip setup' })).toBeEnabled();
  expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Started' })); });
  expect(persisted).toMatchObject({ firstRun: false, chatModel: 'qwen2.5:3b', codeModel: 'qwen2.5:3b', uncensoredMode: false, useCustomLLM: false, customLLM: { enabled: false } });
  expect(runtimeUncensored).toBe(false);
  expect(screen.queryByRole('dialog', { name: 'Ready to chat on this PC' })).toBeNull();
});

test.each(['model', 'Ollama'])('an active %s operation blocks actual Skip and cloud Finish through reopen attempts, then unlocks explicit consent', async operation => {
  const electron = (window as any).electron;
  let complete!: () => void;
  if (operation === 'model') {
    const started = await startDownloadAndReturnToLocal();
    complete = () => started.pull.resolve({ success: true });
  } else {
    const installation = held<{ success: boolean }>();
    complete = () => installation.resolve({ success: true });
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [] });
    electron.checkConnection.mockResolvedValue({ ollama: 'offline', n8n: 'offline' });
    electron.checkOllamaInstalled = jest.fn().mockResolvedValue({ installed: false });
    electron.downloadOllama.mockReturnValueOnce(installation.promise);
    await act(async () => { render(<App />); });
    const welcome = await screen.findByRole('dialog', { name: 'Welcome to HomeBot' });
    await act(async () => { fireEvent.click(within(welcome).getByRole('button', { name: /On this PC/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install Ollama automatically' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /On this PC/ })); });
    expect(screen.getByRole('button', { name: 'Install Ollama automatically' })).toBeDisabled();
  }
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
  expect(screen.getByText(/Setup stays open until they finish/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Skip setup' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Skip setup' }));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.click(dialog.parentElement!);
  act(() => { window.dispatchEvent(new Event('homebot:reopen-first-run')); });
  expect(screen.getByRole('dialog')).toBe(dialog);
  const sameOperation = operation === 'model' ? electron.pullModelStream : electron.downloadOllama;
  expect(sameOperation).toHaveBeenCalledTimes(1);
  expect(events).toEqual([]);

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: /Online/ }));
  fireEvent.click(screen.getByRole('button', { name: /DeepSeek/ }));
  fireEvent.change(screen.getByLabelText('AI service key'), { target: { value: 'fixture-only' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Prepare service' })); });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('button', { name: 'Get Started' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Get Started' }));
  act(() => { window.dispatchEvent(new Event('homebot:reopen-first-run')); });
  expect(screen.getByRole('dialog', { name: 'Ready to try a message' })).toBeInTheDocument();
  expect(events).toEqual([]);
  expect(persisted).toEqual(initialSettings);
  expect(sameOperation).toHaveBeenCalledTimes(1);

  await act(async () => { complete(); });
  expect(screen.getByRole('button', { name: 'Get Started' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Skip setup' })).toBeEnabled();
  expect(screen.queryByText('Ollama is ready!')).toBeNull();
  expect(sameOperation).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Started' })); });
  expect(screen.queryByRole('dialog', { name: 'Ready to try a message' })).toBeNull();
  expect(persisted).toMatchObject({ chatModel: initialSettings.chatModel, useCustomLLM: true, customLLM: { provider: 'deepseek', enabled: true } });

  // Reopening now creates a new wizard; neither the completed operation nor
  // entering local setup supplies consent for a new model download.
  electron.checkConnection.mockResolvedValue({ ollama: 'online', n8n: 'offline' });
  act(() => { window.dispatchEvent(new Event('homebot:reopen-first-run')); });
  const welcome = await screen.findByRole('dialog', { name: 'Welcome to HomeBot' });
  await act(async () => { fireEvent.click(within(welcome).getByRole('button', { name: /On this PC/ })); });
  expect(screen.getByRole('button', { name: 'Download AI' })).toBeEnabled();
  expect(sameOperation).toHaveBeenCalledTimes(1);
  const nextPull = held<{ success: boolean }>();
  electron.pullModelStream.mockReturnValueOnce(nextPull.promise);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
  expect(electron.pullModelStream).toHaveBeenCalledTimes(operation === 'model' ? 2 : 1);
  electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }] });
  await act(async () => { nextPull.resolve({ success: true }); });
  expect(screen.getByText('Ollama is ready!')).toBeInTheDocument();
  expect(electron.downloadOllama).toHaveBeenCalledTimes(operation === 'Ollama' ? 1 : 0);
});

test('a background completion inventory check cannot overwrite the actual Online setup after Back', async () => {
  const { electron, pull } = await startDownloadAndReturnToLocal();
  const inventory = held<{ success: boolean; models: { name: string }[] }>();
  electron.listOllamaModels.mockReturnValueOnce(inventory.promise);
  await act(async () => { pull.resolve({ success: true }); });
  expect(screen.getByText('Checking installed models...')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: /Online/ }));
  fireEvent.click(screen.getByRole('button', { name: /DeepSeek/ }));
  fireEvent.change(screen.getByLabelText('AI service key'), { target: { value: 'fixture-only' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Prepare service' })); });
  await act(async () => { inventory.resolve({ success: true, models: [{ name: 'late-local-model' }] }); });
  expect(screen.getByRole('dialog', { name: 'Connect an AI service' })).toBeInTheDocument();
  expect(screen.queryByText('Ollama is ready!')).toBeNull();
  expect(screen.getByLabelText('AI service key')).toHaveValue('fixture-only');
  expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Started' })); });
  expect(persisted).toMatchObject({ chatModel: initialSettings.chatModel, useCustomLLM: true, customLLM: { provider: 'deepseek', enabled: true } });
});

test('Back and local reentry during completion verification also reconciles before releasing the original download', async () => {
  const { electron, pull } = await startDownloadAndReturnToLocal();
  const oldInventory = held<{ success: boolean; models: { name: string }[] }>();
  electron.listOllamaModels.mockReturnValueOnce(oldInventory.promise);
  await act(async () => { pull.resolve({ success: true }); });
  expect(screen.getByText('Checking installed models...')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /On this PC/ })); });
  expect(screen.getByRole('button', { name: 'Download AI' })).toBeDisabled();
  const currentInventory = held<{ success: boolean; models: { name: string }[] }>();
  electron.listOllamaModels.mockReturnValueOnce(currentInventory.promise);
  await act(async () => { oldInventory.resolve({ success: true, models: [{ name: 'expired-model' }] }); });
  expect(screen.getByText('Checking installed models...')).toBeInTheDocument();
  expect(screen.queryByText('Ollama is ready!')).toBeNull();
  expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
  await act(async () => { currentInventory.resolve({ success: true, models: [{ name: 'qwen2.5:3b' }] }); });
  expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('qwen2.5:3b');
  expect(screen.queryByRole('option', { name: 'expired-model' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download AI' })).toBeNull();
  expect(electron.listOllamaModels).toHaveBeenCalledTimes(5);
  expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
});

test.each(['reported', 'rejected'])('a %s background download failure rechecks and offers a deliberate retry rather than a second implicit pull', async failure => {
  const { electron, pull } = await startDownloadAndReturnToLocal();
  await act(async () => {
    if (failure === 'reported') pull.resolve({ success: false, error: 'Fixture download interrupted' });
    else pull.reject(new Error('Fixture download interrupted'));
  });
  expect(electron.listOllamaModels).toHaveBeenCalledTimes(3);
  expect(screen.getByText(/Fixture download interrupted.*Local setup has been checked again/)).toBeInTheDocument();
  expect(screen.queryByText('Ollama is ready!')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download AI' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
  expect(electron.listOllamaModels).toHaveBeenCalledTimes(4);
  expect(screen.getByRole('button', { name: 'Download AI' })).toBeEnabled();
  expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
  const retry = held<{ success: boolean }>();
  electron.pullModelStream.mockReturnValueOnce(retry.promise);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
  expect(electron.pullModelStream).toHaveBeenCalledTimes(2);
  electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }] });
  await act(async () => { retry.resolve({ success: true }); });
  expect(screen.getByText('Ollama is ready!')).toBeInTheDocument();
  expect(electron.pullModelStream).toHaveBeenCalledTimes(2);
});

test('a failed background download retains the inventory recheck error instead of claiming it was checked successfully', async () => {
  const { electron, pull } = await startDownloadAndReturnToLocal();
  electron.listOllamaModels.mockResolvedValue({ success: false, error: 'Fixture inventory unavailable' });
  await act(async () => { pull.resolve({ success: false, error: 'Fixture download interrupted' }); });
  expect(screen.getByText(/Fixture download interrupted.*Fixture inventory unavailable/)).toBeInTheDocument();
  expect(screen.queryByText(/Local setup has been checked again/)).toBeNull();
  expect(screen.queryByText('Ollama is ready!')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
});

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
