/** @jest-environment jsdom */
import { act } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { contextBridge, ipcRenderer } from 'electron';
import '../../preload/index';
import App from '../App';

jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: jest.fn() },
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(), send: jest.fn(), removeListener: jest.fn() },
}));

const bridge = (contextBridge.exposeInMainWorld as jest.Mock).mock.calls.find(([name]) => name === 'electron')![1];
const original = {
  alwaysOnTop: true, n8nUrl: 'http://localhost:5678', widgetHotkey: 'Ctrl+Shift+Space',
  firstRun: false, chatModel: 'mistral:latest', useCustomLLM: true,
  customLLM: { provider: 'openai', model: 'fixture-model', apiKey: 'fixture-only', enabled: true },
};
let persisted: any;
let failSave: boolean;
let finishSave: (() => void) | undefined;
let delaySave: boolean;
const clone = (value: any) => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  persisted = clone(original);
  failSave = true;
  delaySave = false;
  finishSave = undefined;
  window.localStorage.clear();
  (ipcRenderer.invoke as jest.Mock).mockReset().mockImplementation(async (channel, value) => {
    if (channel === 'homebot:get-settings') return clone(persisted);
    if (channel === 'homebot:save-settings') {
      if (delaySave) await new Promise<void>(resolve => { finishSave = resolve; });
      if (failSave) return { success: false, error: 'disk read-only' };
      persisted = clone(value);
      return { success: true, data: clone(persisted) };
    }
    return undefined;
  });
  (window as any).electron = {
    getSettings: bridge.getSettings, saveSettings: bridge.saveSettings,
    onMessage: jest.fn(() => jest.fn()), checkConnection: jest.fn().mockResolvedValue({ ollama: 'offline', n8n: 'offline' }),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: [] }),
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: jest.fn().mockResolvedValue([]), mcpGetStatus: jest.fn().mockResolvedValue([]),
    schedulerList: jest.fn().mockResolvedValue([]), listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    listCustomLLMModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
  };
});

async function openSimpleSettings() {
  await act(async () => { render(<App />); });
  expect(screen.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]); });
  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true');
}

test('actual preload rejects a failed write instead of returning stale settings', async () => {
  await expect(bridge.saveSettings({ useCustomLLM: false })).rejects.toThrow('disk read-only');
  expect(ipcRenderer.invoke).not.toHaveBeenCalledWith('homebot:get-settings');
});

test('failed Simple Settings save retains the draft, unchanged saved policy, and retry persists on reopen', async () => {
  await openSimpleSettings();
  const online = screen.getByTestId('privacy-switch') as HTMLInputElement;
  fireEvent.click(online);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  const error = within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('alert');
  expect(error).toHaveTextContent('disk read-only');
  expect(error).toHaveTextContent('previous settings');
  expect(online.checked).toBe(false);
  expect(persisted.useCustomLLM).toBe(true);
  failSave = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull());
  expect((await bridge.getSettings()).useCustomLLM).toBe(false);
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]); });
  expect((await screen.findByTestId('privacy-switch') as HTMLInputElement).checked).toBe(false);
});

test('pending success keeps the dialog open and blocks duplicate saves until acknowledged', async () => {
  failSave = false;
  delaySave = true;
  await openSimpleSettings();
  fireEvent.click(screen.getByTestId('privacy-switch'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 's', ctrlKey: true });
  expect((ipcRenderer.invoke as jest.Mock).mock.calls.filter(([channel]) => channel === 'homebot:save-settings')).toHaveLength(1);
  expect(persisted.useCustomLLM).toBe(true);
  await act(async () => { finishSave!(); });
  expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  expect(persisted.useCustomLLM).toBe(false);
});

test('a pending save blocks Cancel, Close, Escape and backdrop until its write resolves', async () => {
  failSave = false;
  delaySave = true;
  await openSimpleSettings();
  fireEvent.click(screen.getByTestId('privacy-switch'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  const close = screen.getByRole('button', { name: 'Close settings' });
  expect(cancel).toBeDisabled();
  expect(close).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  fireEvent.click(dialog.closest('.settings-overlay')!);
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  await act(async () => { finishSave!(); });
  expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  expect(persisted.useCustomLLM).toBe(false);
});

test('setup skip awaits the same actual save bridge, retains first-run on failure, and retries once', async () => {
  persisted.firstRun = true;
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Skip setup' })); });
  expect(screen.getByText('Welcome to HomeBot')).toBeInTheDocument();
  expect(screen.getByText(/Could not save setup: disk read-only/)).toBeInTheDocument();
  expect(persisted.firstRun).toBe(true);
  failSave = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip setup' })); });
  expect(screen.queryByText('Welcome to HomeBot')).toBeNull();
  expect(persisted.firstRun).toBe(false);
  expect((ipcRenderer.invoke as jest.Mock).mock.calls.filter(([channel]) => channel === 'homebot:save-settings')).toHaveLength(2);
});
