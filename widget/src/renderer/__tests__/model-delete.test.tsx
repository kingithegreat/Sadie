/** @jest-environment jsdom */

/**
 * Deleting a model you downloaded.
 *
 * Found by the 2026-08-22 reachability audit. `deleteOllamaModel` sat on the
 * preload bridge, wired to a working main handler, with ZERO callers — while
 * PULLING a model is offered in three places: the first-run modal, the error
 * bubble, and the model picker's recommendations.
 *
 * So one click could take 9.6 GB (gemma4:e4b) and nothing in HomeBot would ever
 * give it back. Worse than untidy: model-download-fit refuses pulls that will
 * not fit on disk, so the app could talk itself into a corner it offered no way
 * out of.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';

const noop = () => {};

const BASE = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
  chatModel: 'qwen2.5:7b',
  uncensoredModel: 'dolphin-mistral:7b',
  visionModel: 'moondream',
};

const INSTALLED = [
  { name: 'qwen2.5:7b', size: 4.7 * 1024 ** 3 },
  { name: 'gemma4:e4b', size: 9.6 * 1024 ** 3 },
];

let deleteOllamaModel: jest.Mock;

function mountElectron(models = INSTALLED) {
  deleteOllamaModel = jest.fn().mockResolvedValue({ success: true, model: 'gemma4:e4b' });
  (window as any).electron = {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: jest.fn().mockResolvedValue([]),
    mcpGetStatus: jest.fn().mockResolvedValue([]),
    schedulerList: jest.fn().mockResolvedValue([]),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models }),
    listCustomLLMModels: jest.fn().mockResolvedValue({ success: true, models: [] }),
    deleteOllamaModel,
  };
  try { window.localStorage.clear(); } catch { /* not available */ }
}

afterEach(() => { delete (window as any).electron; });

const open = async (settings: any = BASE) => {
  mountElectron();
  const utils = render(<SettingsPanel settings={settings} onSave={noop} onClose={noop} />);
  // The installed list arrives from an async IPC call after mount.
  await waitFor(() => expect(utils.container.querySelector('.model-card-wrap')).toBeTruthy());
  return utils;
};

test('an installed model offers a delete control', async () => {
  const { container } = await open();
  expect(container.querySelector('[data-testid="delete-model-gemma4:e4b"]')).toBeTruthy();
});

test('the model currently answering cannot be deleted', async () => {
  // chatModel is qwen2.5:7b. Deleting it would leave chat pointing at a model
  // Ollama no longer has.
  const { container } = await open();
  const btn = container.querySelector('[data-testid="delete-model-qwen2.5:7b"]') as HTMLButtonElement;
  expect(btn).toBeTruthy();
  expect(btn.disabled).toBe(true);
  expect(btn.title).toMatch(/in use/i);
});

test('deleting asks first — it is 9.6 GB and irreversible without a re-download', async () => {
  const { container } = await open();
  fireEvent.click(container.querySelector('[data-testid="delete-model-gemma4:e4b"]') as HTMLElement);

  expect(screen.getByText(/Delete Gemma 4/i)).toBeInTheDocument();
  // Nothing happens until the user says so.
  expect(deleteOllamaModel).not.toHaveBeenCalled();
});

test('confirming calls the IPC with the model name', async () => {
  const { container } = await open();
  fireEvent.click(container.querySelector('[data-testid="delete-model-gemma4:e4b"]') as HTMLElement);
  await act(async () => { fireEvent.click(screen.getByText('Delete it')); });

  expect(deleteOllamaModel).toHaveBeenCalledWith('gemma4:e4b');
});

test('a deleted model disappears from the list', async () => {
  const { container } = await open();
  fireEvent.click(container.querySelector('[data-testid="delete-model-gemma4:e4b"]') as HTMLElement);
  await act(async () => { fireEvent.click(screen.getByText('Delete it')); });

  await waitFor(() => {
    expect(container.querySelector('[data-testid="delete-model-gemma4:e4b"]')).toBeNull();
  });
  // The other one is untouched.
  expect(container.querySelector('[data-testid="delete-model-qwen2.5:7b"]')).toBeTruthy();
});

test('a failure says so and leaves the model in the list', async () => {
  const { container } = await open();
  deleteOllamaModel.mockResolvedValue({ success: false, error: 'ollama is not running' });

  fireEvent.click(container.querySelector('[data-testid="delete-model-gemma4:e4b"]') as HTMLElement);
  await act(async () => { fireEvent.click(screen.getByText('Delete it')); });

  await waitFor(() => {
    expect(screen.getByTestId('model-delete-error').textContent).toMatch(/ollama is not running/);
  });
  // Still there — reporting a failure and then hiding the row would be a lie.
  expect(container.querySelector('[data-testid="delete-model-gemma4:e4b"]')).toBeTruthy();
});
