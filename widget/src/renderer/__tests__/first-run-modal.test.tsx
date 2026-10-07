/** @jest-environment jsdom */
/**
 * first-run-modal.test.tsx
 * Tests for src/renderer/components/FirstRunModal.tsx (3-step wizard: welcome → setup → done)
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import FirstRunModal from '../components/FirstRunModal';
import type { Settings } from '../../shared/types';
import { resolveCloudLLM } from '../../shared/cloud-llm';

const baseSettings: Settings = {
  alwaysOnTop: false,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Alt+Space',
  firstRun: true,
  telemetryEnabled: false,
  permissions: {
    delete_file: false,
    move_file: false,
    launch_app: false,
    screenshot: false,
  },
};

function makeMockElectron(saveSettings = jest.fn().mockResolvedValue(undefined)) {
  return {
    saveSettings,
    checkConnection: jest.fn().mockResolvedValue({ ollama: 'online' }),
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:7b' }, { name: 'nomic-embed-text' }] }),
    startOllama: jest.fn().mockResolvedValue({ success: true }),
    checkOllamaInstalled: jest.fn().mockResolvedValue({ installed: true, path: '/usr/bin/ollama' }),
    detectGpuVram: jest.fn().mockResolvedValue({ success: true, vramGB: 6, gpuName: 'Test GPU' }),
    listCustomLLMModels: jest.fn().mockResolvedValue({ success: true, models: [{ id: 'test-model' }] }),
    checkSubscriptionCli: jest.fn().mockResolvedValue({ status: 'ready' }),
    pullModelStream: jest.fn().mockResolvedValue({ success: true }),
    onPullModelProgress: jest.fn().mockReturnValue(() => {}),
    onOllamaDownloadProgress: jest.fn().mockReturnValue(() => {}),
    downloadOllama: jest.fn().mockResolvedValue({ success: true }),
  };
}

beforeEach(() => {
  (window as any).electron = makeMockElectron();
});

test.each([
  { codeModel: 'missing:14b', expected: 'qwen2.5:3b' },
  { codeModel: 'qwen2.5-coder:7b', expected: 'qwen2.5-coder:7b' },
])('local setup uses an installed coding choice instead of $codeModel when unavailable', async ({ codeModel, expected }) => {
  (window as any).electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }, { name: 'qwen2.5-coder:7b' }] });
  const onSave = jest.fn();
  render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'qwen2.5:3b', codeModel }} onSave={onSave} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /On this PC/ }));
  await screen.findByText('Ollama is ready!');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get Started' })); });
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ chatModel: 'qwen2.5:3b', codeModel: expected, uncensoredMode: false }));
  expect((window as any).electron.pullModelStream).not.toHaveBeenCalled();
});

afterEach(() => {
  delete (window as any).electron;
});

describe('FirstRunModal — open/closed', () => {
  test('renders nothing when open=false', () => {
    const { container } = render(
      <FirstRunModal open={false} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders welcome message when open=true', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByText('Welcome to HomeBot')).toBeInTheDocument();
  });

  test('renders path selection cards on welcome step', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByText('On this PC')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  test('renders Skip setup button', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByText('Skip setup')).toBeInTheDocument();
  });
});

describe('FirstRunModal — local path', () => {
  test('retains the downloaded hardware choice after save failure and persists that same draft on retry', async () => {
    const electron = makeMockElectron();
    electron.detectGpuVram.mockResolvedValue({ success: true, vramGB: 4, gpuName: 'Test GPU' });
    electron.listOllamaModels
      .mockResolvedValueOnce({ success: true, models: [] })
      .mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }, { name: 'nomic-embed-text' }] });
    electron.saveSettings.mockRejectedValueOnce(new Error('disk read-only'));
    window.electron = electron as any;
    const onSave = jest.fn(async payload => { await electron.saveSettings(payload); });
    const onClose = jest.fn();
    render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'qwen2.5:7b' }} onSave={onSave} onClose={onClose} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
    expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('qwen2.5:3b');
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(screen.getByRole('alert')).toHaveTextContent('disk read-only');
    expect(onClose).not.toHaveBeenCalled();
    expect(electron.saveSettings).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(electron.saveSettings).toHaveBeenCalledTimes(2);
    for (const [payload] of electron.saveSettings.mock.calls) {
      expect(payload).toMatchObject({ chatModel: 'qwen2.5:3b', firstRun: false });
    }
  });

  test.each(['codex', 'claude-code'] as const)('On this PC keeps %s cloud routing explicitly off', async provider => {
    const electron = makeMockElectron();
    window.electron = electron as any;
    const onSave = jest.fn();
    render(<FirstRunModal open settings={{
      ...baseSettings,
      useCustomLLM: false,
      uncensoredMode: true,
      customLLM: { name: 'Previous subscription', provider, model: provider === 'codex' ? 'default' : 'haiku', apiUrl: '', apiKey: '', enabled: true },
    }} onSave={onSave} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    await waitFor(() => expect(screen.getByText('Ollama is ready!')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    const saved = onSave.mock.calls[0][0];
    expect(saved.useCustomLLM).toBe(false);
    expect(resolveCloudLLM(saved).active).toBe(false);
    expect(electron.checkSubscriptionCli).not.toHaveBeenCalled();
  });

  test('saves the installed hardware-recommended chat model instead of the absent default', async () => {
    const electron = makeMockElectron();
    electron.detectGpuVram.mockResolvedValue({ success: true, vramGB: 4, gpuName: 'Test GPU' });
    electron.listOllamaModels
      .mockResolvedValueOnce({ success: true, models: [] })
      .mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }, { name: 'nomic-embed-text' }] });
    window.electron = electron as any;
    const onSave = jest.fn(async payload => { await electron.saveSettings(payload); });
    render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'qwen2.5:7b' }} onSave={onSave} onClose={jest.fn()} />);
    await waitFor(() => expect(electron.detectGpuVram).toHaveBeenCalled());
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
    await waitFor(() => expect(screen.getByText('Ollama is ready!')).toBeInTheDocument());
    expect(electron.pullModelStream).toHaveBeenCalledWith('qwen2.5:3b');
    expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('qwen2.5:3b');
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(electron.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ chatModel: 'qwen2.5:3b', firstRun: false }));
    expect(electron.saveSettings).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ chatModel: 'qwen2.5:3b' }));
    expect(resolveCloudLLM(onSave.mock.calls[0][0]).intended).toBe(false);
  });

  test.each(['pull failure', 'empty inventory', 'inventory failure'])('does not claim ready after %s', async failure => {
    const electron = makeMockElectron();
    if (failure === 'inventory failure') {
      electron.listOllamaModels.mockResolvedValue({ success: false, error: 'Connection lost', models: [] } as any);
    } else {
      electron.listOllamaModels.mockResolvedValue({ success: true, models: [] });
      if (failure === 'pull failure') electron.pullModelStream.mockResolvedValue({ success: false, error: 'Download failed' } as any);
    }
    window.electron = electron as any;
    render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'qwen2.5:7b' }} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    if (failure !== 'inventory failure') await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
    expect(screen.queryByText('Ollama is ready!')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('Continue anyway')); });
    expect(screen.queryByText("You're all set!")).toBeNull();
    expect(screen.getByText('Ready when you are')).toBeInTheDocument();
  });

  test('preserves an installed chat choice and never offers an embedding model for chat', async () => {
    const electron = makeMockElectron();
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'llama3.2:3b' }, { name: 'nomic-embed-text' }] });
    window.electron = electron as any;
    const onSave = jest.fn();
    render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'llama3.2:3b' }} onSave={onSave} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(screen.queryByRole('option', { name: 'nomic-embed-text' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ chatModel: 'llama3.2:3b' }));
  });

  test('reuses an installed chat model instead of downloading a recommended replacement or embeddings', async () => {
    const electron = makeMockElectron();
    electron.detectGpuVram.mockResolvedValue({ success: true, vramGB: 4, gpuName: 'Test GPU' });
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:0.5b' }] });
    window.electron = electron as any;
    render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'qwen2.5:7b' }} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('qwen2.5:0.5b');
  });

  test('embedding-only inventory cannot make local chat ready', async () => {
    const electron = makeMockElectron();
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'nomic-embed-text' }] });
    electron.pullModelStream.mockResolvedValue({ success: false, error: 'Offline' } as any);
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
    expect(screen.queryByText('Ollama is ready!')).toBeNull();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  test('retry verifies an installed model and saves it after a failed download', async () => {
    const electron = makeMockElectron();
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [] });
    electron.pullModelStream.mockResolvedValue({ success: false, error: 'Offline' } as any);
    window.electron = electron as any;
    const onSave = jest.fn(async payload => { await electron.saveSettings(payload); });
    render(<FirstRunModal open settings={baseSettings} onSave={onSave} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:7b' }, { name: 'nomic-embed-text' }] });
    await act(async () => { fireEvent.click(screen.getByText('Retry')); });
    expect(screen.getByText('Ollama is ready!')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(electron.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ chatModel: 'qwen2.5:7b' }));
    expect(electron.saveSettings).toHaveBeenCalledTimes(1);
  });

  test('waits for hardware detection before choosing the download', async () => {
    const electron = makeMockElectron();
    let resolveHardware!: (value: any) => void;
    const hardware = new Promise<any>(resolve => { resolveHardware = resolve; });
    electron.detectGpuVram.mockReturnValue(hardware);
    electron.listOllamaModels
      .mockResolvedValueOnce({ success: true, models: [] })
      .mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }, { name: 'nomic-embed-text' }] });
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    await act(async () => { resolveHardware({ success: true, vramGB: 4, gpuName: 'Test GPU' }); });
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    expect(screen.getByText(/approximately 2.0 GB/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
    expect(electron.pullModelStream).toHaveBeenCalledWith('qwen2.5:3b');
  });

  test('the chat picker choice is the model sent to settings persistence', async () => {
    const electron = makeMockElectron();
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.2:3b' }, { name: 'nomic-embed-text' }] });
    window.electron = electron as any;
    const onSave = jest.fn(async payload => { await electron.saveSettings(payload); });
    render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'qwen2.5:7b' }} onSave={onSave} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    fireEvent.change(screen.getByRole('combobox', { name: 'Select chat model' }), { target: { value: 'llama3.2:3b' } });
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(electron.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ chatModel: 'llama3.2:3b' }));
    expect(electron.saveSettings).toHaveBeenCalledTimes(1);
  });

  test('clicking Local shows connection check', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('On this PC'));
    });
    expect(screen.getByText('Local Setup')).toBeInTheDocument();
  });

  test('shows Ollama running status when online', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('On this PC'));
    });
    // Wait for async checkOllama
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(screen.getByText('Ollama is ready!')).toBeInTheDocument();
  });

  test('shows GPU info when detected', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('On this PC'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(screen.getByText(/Test GPU/)).toBeInTheDocument();
  });

  test('Next describes the verified installed local setup', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('On this PC'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
    // Installed-model verification earns a local setup claim. It does not
    // prove optional tools or that a future generation request will succeed.
    expect(screen.getByText('Ready to chat on this PC')).toBeInTheDocument();
  });

  test('done is HONEST when nothing was actually configured', async () => {
    const electron = makeMockElectron();
    (window as any).electron = electron;
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    // Online, then straight past the key step with the field left empty — the
    // path the audit flagged: Next stays enabled on an empty field, and the
    // old done step then claimed "You're all set!" over a configuration that
    // does not exist.
    await act(async () => { fireEvent.click(screen.getByText('Online')); });
    await act(async () => { fireEvent.click(screen.getByText('Next')); });

    expect(screen.queryByText("You're all set!")).toBeNull();
    expect(screen.getByText('Ready when you are')).toBeInTheDocument();
    expect(screen.getByText(/finish setting up any time from Settings/i)).toBeInTheDocument();
  });

  test('done stays honest when an API catalogue was prepared', async () => {
    const electron = makeMockElectron();
    (window as any).electron = electron;
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => { fireEvent.click(screen.getByText('Online')); });
    fireEvent.change(screen.getByPlaceholderText('Paste the key from your account page'), {
      target: { value: 'sk-test-123' },
    });
    await act(async () => { fireEvent.click(screen.getByText('Prepare service')); });
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    expect(screen.queryByText("You're all set!")).toBeNull();
    expect(screen.getByText('Ready to try a message')).toBeInTheDocument();
    expect(screen.getByText(/Your key has not been verified/)).toBeInTheDocument();
  });
});

describe('FirstRunModal — cloud path', () => {
  test.each([
    ['ChatGPT subscription', 'codex', 'default'],
    ['Claude subscription', 'claude-code', 'haiku'],
  ])('%s is reachable without an API key and saves an active chat provider', async (label, provider, model) => {
    const electron = makeMockElectron();
    window.electron = electron as any;
    const onSave = jest.fn();
    render(<FirstRunModal open settings={{ ...baseSettings, uncensoredMode: true }} onSave={onSave} onClose={jest.fn()} />);

    await act(async () => { fireEvent.click(screen.getByText('Online')); });
    await act(async () => { fireEvent.click(screen.getByText(label)); });
    expect(screen.queryByPlaceholderText('Paste the key from your account page')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check sign-in' })); });
    expect(electron.checkSubscriptionCli).toHaveBeenCalledWith(provider);
    expect(electron.listCustomLLMModels).not.toHaveBeenCalled();
    expect(screen.getByText('Subscription sign-in found. Ready to try a chat.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });

    const saved = onSave.mock.calls[0][0];
    expect(saved.customLLM).toMatchObject({ provider, model, apiKey: '', enabled: true });
    expect(saved.useCustomLLM).toBe(true);
    expect(saved.uncensoredMode).toBe(false);
    expect(resolveCloudLLM(saved).active).toBe(true);
  });

  test('subscription choice survives a failed settings save and retries once', async () => {
    const electron = makeMockElectron();
    window.electron = electron as any;
    const onSave = jest.fn().mockRejectedValueOnce(new Error('disk read-only')).mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<FirstRunModal open settings={{ ...baseSettings, uncensoredMode: true }} onSave={onSave} onClose={onClose} />);
    await act(async () => { fireEvent.click(screen.getByText('Online')); });
    await act(async () => { fireEvent.click(screen.getByText('ChatGPT subscription')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check sign-in' })); });
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(screen.getByRole('alert')).toHaveTextContent('disk read-only');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(2);
    for (const [payload] of onSave.mock.calls) {
      expect(payload).toMatchObject({ firstRun: false, useCustomLLM: true, uncensoredMode: false,
        customLLM: { provider: 'codex', model: 'default', apiKey: '', enabled: true } });
    }
  });

  test('signed-out CLI is explained and never marked ready or activated', async () => {
    const electron = makeMockElectron();
    electron.checkSubscriptionCli.mockResolvedValue({ status: 'signed-out' });
    window.electron = electron as any;
    const onSave = jest.fn();
    render(<FirstRunModal open settings={baseSettings} onSave={onSave} onClose={jest.fn()} />);

    await act(async () => { fireEvent.click(screen.getByText('Online')); });
    await act(async () => { fireEvent.click(screen.getByText('ChatGPT subscription')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check sign-in' })); });
    expect(screen.getByText(/has no active sign-in/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('Continue anyway')); });
    expect(screen.getByText('Ready when you are')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(resolveCloudLLM(onSave.mock.calls[0][0]).intended).toBe(false);
  });

  test('clicking Cloud shows provider selection', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Online'));
    });
    expect(screen.getByText('Connect an AI service')).toBeInTheDocument();
    expect(screen.getByText('Groq')).toBeInTheDocument();
  });

  /**
   * The step used to say "Pick a provider and paste your API key. Free tiers
   * are marked." and offered no way to obtain one — no link, nothing. Someone
   * who picks Online and has never heard of an API key cannot proceed, and the
   * only exits are Back or Skip. SettingsPanel had linked out like this in five
   * places for months; the wizard, the one screen every new user sees, did not.
   *
   * Asserts the affordance (a reachable link to the chosen provider) rather
   * than the wording, so the copy can keep improving.
   */
  test('offers a way to actually get a key', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Online'));
    });

    const link = screen.getByRole('link', { name: /get one from/i }) as HTMLAnchorElement;
    expect(link).toBeInTheDocument();
    expect(link.href).toMatch(/^https:\/\//);
    // Opening in the same window would destroy the half-finished wizard.
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });

  test('the key link follows the provider you picked', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Online'));
    });
    // Default is Groq; switching must not leave the link pointing at it.
    const before = (screen.getByRole('link', { name: /get one from/i }) as HTMLAnchorElement).href;
    await act(async () => {
      fireEvent.click(screen.getByText('OpenAI'));
    });
    const after = (screen.getByRole('link', { name: /get one from/i }) as HTMLAnchorElement).href;
    expect(after).not.toBe(before);
    expect(after).toContain('openai.com');
  });

  test('Preparing the default service retrieves a model choice without claiming validation', async () => {
    const electron = makeMockElectron();
    (window as any).electron = electron;
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Online'));
    });
    const input = screen.getByPlaceholderText('Paste the key from your account page');
    fireEvent.change(input, { target: { value: 'sk-test-123' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Prepare service'));
    });
    expect(electron.listCustomLLMModels).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-test-123', provider: 'groq' })
    );
  });

  test('successful catalogue retrieval shows an unverified service choice', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Online'));
    });
    const input = screen.getByPlaceholderText('Paste the key from your account page');
    fireEvent.change(input, { target: { value: 'sk-test-123' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Prepare service'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(screen.getByText('Service choice prepared. Your key and ability to chat have not been verified.')).toBeInTheDocument();
  });
});

describe('FirstRunModal — Get Started (final step)', () => {
  test('calls onSave with firstRun: false', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('On this PC'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ firstRun: false });
  });

  test('telemetry is off by default and no consent timestamp is stamped', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('On this PC'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onSave.mock.calls[0][0]).toMatchObject({ telemetryEnabled: false });
    expect(onSave.mock.calls[0][0].telemetryConsentTimestamp).toBeUndefined();
  });

  test('checking the consent box enables telemetry and stamps consent', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('On this PC'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onSave.mock.calls[0][0]).toMatchObject({ telemetryEnabled: true });
    expect(typeof onSave.mock.calls[0][0].telemetryConsentTimestamp).toBe('string');
  });

  test('calls onClose after Get Started', async () => {
    const onClose = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={onClose} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('On this PC'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('cloud path saves customLLM config on Get Started', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Online'));
    });
    const input = screen.getByPlaceholderText('Paste the key from your account page');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Prepare service'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onSave.mock.calls[0][0].useCustomLLM).toBe(true);
    expect(onSave.mock.calls[0][0].customLLM).toMatchObject({ provider: 'groq', apiKey: 'sk-test-key' });
    // Model should be set from the model-catalogue response or provider default
    expect(onSave.mock.calls[0][0].customLLM.model).toBe('test-model');
  });

  test('switching provider after a successful test clears the prior success state and requires retest', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Online'));
    });

    const input = screen.getByPlaceholderText('Paste the key from your account page');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Prepare service'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    await act(async () => {
      fireEvent.click(screen.getByText('OpenAI'));
    });

    expect(screen.queryByText('Service choice prepared. Your key and ability to chat have not been verified.')).not.toBeInTheDocument();
    expect(screen.getByText('Next')).toBeDisabled();
  });
});

describe('FirstRunModal — pending Online validation', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }

  const success = (model: string) => ({ success: true, models: [{ id: model }] });

  async function startApiCheck(onSave = jest.fn()) {
    render(<FirstRunModal open settings={baseSettings} onSave={onSave} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('Online')); });
    const input = screen.getByPlaceholderText('Paste the key from your account page');
    fireEvent.change(input, { target: { value: 'fixture-old-key' } });
    await act(async () => { fireEvent.click(screen.getByText('Prepare service')); });
    return input;
  }

  test('changing provider discards an outstanding success and requires a current check', async () => {
    const old = deferred<ReturnType<typeof success>>();
    (window as any).electron.listCustomLLMModels.mockReturnValueOnce(old.promise);
    await startApiCheck();
    fireEvent.click(screen.getByText('OpenAI'));
    await act(async () => { old.resolve(success('old-provider-model')); });
    expect(screen.queryByText('Service choice prepared. Your key and ability to chat have not been verified.')).not.toBeInTheDocument();
    expect(screen.getByText('Next')).toBeDisabled();
  });

  test('editing the key discards an outstanding success', async () => {
    const old = deferred<ReturnType<typeof success>>();
    (window as any).electron.listCustomLLMModels.mockReturnValueOnce(old.promise);
    const input = await startApiCheck();
    fireEvent.change(input, { target: { value: 'fixture-new-key' } });
    await act(async () => { old.resolve(success('old-key-model')); });
    expect(screen.queryByText('Service choice prepared. Your key and ability to chat have not been verified.')).not.toBeInTheDocument();
    expect(screen.getByText('Next')).toBeDisabled();
  });

  test('provider A to B to A cannot revive the first A result', async () => {
    const old = deferred<ReturnType<typeof success>>();
    (window as any).electron.listCustomLLMModels.mockReturnValueOnce(old.promise);
    await startApiCheck();
    fireEvent.click(screen.getByText('OpenAI'));
    fireEvent.click(screen.getByRole('button', { name: /^Groq/ }));
    await act(async () => { old.resolve(success('expired-groq-model')); });
    expect(screen.queryByText('Service choice prepared. Your key and ability to chat have not been verified.')).not.toBeInTheDocument();
    expect(screen.getByText('Next')).toBeDisabled();
  });

  test('changing subscription discards the previous sign-in result', async () => {
    const old = deferred<{ status: string }>();
    (window as any).electron.checkSubscriptionCli.mockReturnValueOnce(old.promise);
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('Online'));
    fireEvent.click(screen.getByText('ChatGPT subscription'));
    fireEvent.click(screen.getByText('Check sign-in'));
    fireEvent.click(screen.getByText('Claude subscription'));
    await act(async () => { old.resolve({ status: 'ready' }); });
    expect(screen.queryByText('Subscription sign-in found. Ready to try a chat.')).not.toBeInTheDocument();
    expect(screen.getByText('Continue anyway')).toBeInTheDocument();
  });

  test('Back and return to Online invalidates the old check', async () => {
    const old = deferred<ReturnType<typeof success>>();
    (window as any).electron.listCustomLLMModels.mockReturnValueOnce(old.promise);
    await startApiCheck();
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByText('Online'));
    await act(async () => { old.resolve(success('expired-path-model')); });
    expect(screen.queryByText('Service choice prepared. Your key and ability to chat have not been verified.')).not.toBeInTheDocument();
    expect(screen.getByText('Next')).toBeDisabled();
  });

  test('an old success and finally do not clear the newer pending check', async () => {
    const old = deferred<ReturnType<typeof success>>(), current = deferred<ReturnType<typeof success>>();
    (window as any).electron.listCustomLLMModels.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const input = await startApiCheck();
    fireEvent.change(input, { target: { value: 'fixture-new-key' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((window as any).electron.listCustomLLMModels).toHaveBeenCalledTimes(2);
    await act(async () => { old.resolve(success('old-model')); });
    expect(screen.getByText('Checking...')).toBeDisabled();
    expect(screen.queryByText('Service choice prepared. Your key and ability to chat have not been verified.')).not.toBeInTheDocument();
    await act(async () => { current.resolve(success('current-model')); });
    expect(screen.getByText('Service choice prepared. Your key and ability to chat have not been verified.')).toBeInTheDocument();
  });

  test('an old rejection does not overwrite a newer successful check', async () => {
    const old = deferred<ReturnType<typeof success>>(), current = deferred<ReturnType<typeof success>>();
    (window as any).electron.listCustomLLMModels.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const input = await startApiCheck();
    fireEvent.change(input, { target: { value: 'fixture-new-key' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => { current.resolve(success('current-model')); });
    await act(async () => { old.reject(new Error('expired fixture failure')); });
    expect(screen.getByText('Service choice prepared. Your key and ability to chat have not been verified.')).toBeInTheDocument();
    expect(screen.queryByText('current fixture failure')).not.toBeInTheDocument();
  });

  test('Enter does not start a duplicate check for unchanged pending input', async () => {
    const pending = deferred<ReturnType<typeof success>>();
    (window as any).electron.listCustomLLMModels.mockReturnValue(pending.promise);
    const input = await startApiCheck();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((window as any).electron.listCustomLLMModels).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(success('current-model')); });
  });

  test('the current successful check saves its own key and model', async () => {
    const pending = deferred<ReturnType<typeof success>>(), onSave = jest.fn();
    (window as any).electron.listCustomLLMModels.mockReturnValueOnce(pending.promise);
    await startApiCheck(onSave);
    await act(async () => { pending.resolve(success('current-model')); });
    expect(screen.getByText('Service choice prepared. Your key and ability to chat have not been verified.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      useCustomLLM: true,
      customLLM: expect.objectContaining({ provider: 'groq', apiKey: 'fixture-old-key', model: 'current-model' }),
    }));
  });

  test('the current failure remains visible and blocks unfinished API setup', async () => {
    const pending = deferred<ReturnType<typeof success>>();
    (window as any).electron.listCustomLLMModels.mockReturnValueOnce(pending.promise);
    await startApiCheck();
    await act(async () => { pending.reject(new Error('current fixture failure')); });
    expect(screen.getByText('current fixture failure')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeDisabled();
  });
});

describe('FirstRunModal — Skip setup button', () => {
  test('calls onSave with firstRun: false on Skip setup', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Skip setup'));
    });
    expect(onSave.mock.calls[0][0]).toMatchObject({ firstRun: false, telemetryEnabled: false });
    expect(onSave.mock.calls[0][0].telemetryConsentTimestamp).toBeUndefined();
  });

  test('calls onClose after Skip setup', async () => {
    const onClose = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={onClose} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Skip setup'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('FirstRunModal — wizard navigation', () => {
  test('Back button returns to welcome from setup', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('On this PC'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(screen.getByText('Back')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('Back'));
    });
    expect(screen.getByText('Welcome to HomeBot')).toBeInTheDocument();
  });

  test('progress dots are rendered (3 steps)', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    const dots = document.querySelectorAll('.wizard-dot');
    expect(dots.length).toBe(3);
  });
});

describe('FirstRunModal — hardware-aware path recommendation', () => {
  // The regression this guards: the welcome screen used to ask a brand-new
  // user "local or cloud?" and answer it with "runs on your GPU". Detection
  // existed but ran inside runLocalSetup(), i.e. only AFTER the user had
  // already chosen local, so it could never inform the choice.

  const renderWizard = async (vramGB: number | null) => {
    (window as any).electron = makeMockElectron();
    (window as any).electron.detectGpuVram = jest.fn().mockResolvedValue(
      vramGB === null ? { success: false } : { success: true, vramGB, gpuName: 'Test GPU' }
    );
    const utils = render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    // Let the fire-and-forget detection settle.
    await act(async () => { await Promise.resolve(); });
    return utils;
  };

  test('detects the GPU on open, before any path is chosen', async () => {
    await renderWizard(12);
    // Still on the welcome step — nothing has been clicked.
    expect(screen.getByText('Welcome to HomeBot')).toBeInTheDocument();
    expect((window as any).electron.detectGpuVram).toHaveBeenCalled();
  });

  test('recommends running on this PC when the card is capable', async () => {
    await renderWizard(12);
    const badges = screen.getAllByText('Recommended for your PC');
    expect(badges).toHaveLength(1);
    // The badge must sit on the local card, not merely exist somewhere.
    expect(badges[0].closest('button')).toHaveTextContent('On this PC');
  });

  test('recommends online when the card is too small to be worth it', async () => {
    await renderWizard(2);
    const badges = screen.getAllByText('Recommended for your PC');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('button')).toHaveTextContent('Online');
  });

  test('explains the recommendation in plain words, quoting the real card size', async () => {
    await renderWizard(8);
    expect(screen.getByText(/8GB/)).toBeInTheDocument();
    // No jargon may reach this screen.
    expect(screen.queryByText(/VRAM/i)).toBeNull();
    expect(screen.queryByText(/Ollama/i)).toBeNull();
  });

  test('shows no recommendation at all when the GPU cannot be read', async () => {
    await renderWizard(null);
    // Better to say nothing than to guess at someone's hardware — and an
    // "unknown hardware" disclaimer would worry a beginner more than the
    // missing badge helps them.
    expect(screen.queryByText('Recommended for your PC')).toBeNull();
    // The screen still works: both choices present, plus the reassurance.
    expect(screen.getByText('On this PC')).toBeInTheDocument();
    expect(screen.getByText(/you can change it later/i)).toBeInTheDocument();
  });

  test('never leaves the user without a way forward', async () => {
    await renderWizard(2);
    // Both paths remain clickable regardless of which one is recommended —
    // the badge is advice, and the user may have reasons we cannot see.
    expect(screen.getByText('On this PC').closest('button')).toBeEnabled();
    expect(screen.getByText('Online').closest('button')).toBeEnabled();
  });
});

describe('FirstRunModal — free-setup guidance (Track D)', () => {
  // The plan's finding: HomeBot is already almost entirely free, and the gap is
  // that a newcomer is never told so in the moment they are choosing. Two ways
  // that failed here: the provider grid listed paid-only services above the
  // free ones, and every provider's specific freeHint text was defined but
  // never rendered — only its truthiness, to light up a one-word badge.

  async function renderCloudStep() {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Online'));
    });
  }

  test('every free-tier provider appears above every paid-only one', async () => {
    await renderCloudStep();
    const chips = Array.from(document.querySelectorAll('.wizard-cloud-chip'));
    const pos = (name: string) =>
      chips.findIndex(c => c.textContent?.startsWith(name));
    const freeOnes = ['Groq', 'OpenRouter', 'Google AI Studio', 'Google Gemini Native', 'Cerebras', 'SambaNova', 'Hugging Face'];
    const paidOnes = ['Anthropic', 'OpenAI', 'DeepSeek', 'Together AI'];
    for (const f of freeOnes) expect(pos(f)).toBeGreaterThanOrEqual(0);
    for (const p of paidOnes) expect(pos(p)).toBeGreaterThanOrEqual(0);
    const lastFree = Math.max(...freeOnes.map(pos));
    const firstPaid = Math.min(...paidOnes.map(pos));
    expect(lastFree).toBeLessThan(firstPaid);
  });

  test('the selected provider’s actual free promise is written out, not just a "free" badge', async () => {
    await renderCloudStep();
    // Groq is the default selection.
    expect(screen.getByText('Groq: Free tier available.')).toBeInTheDocument();
    // Switching providers swaps the promise with it.
    fireEvent.click(screen.getByRole('button', { name: /Cerebras/ }));
    expect(screen.getByText('Cerebras: Free tier.')).toBeInTheDocument();
    expect(screen.queryByText('Groq: Free tier available.')).not.toBeInTheDocument();
  });

  test('a paid-only provider makes no free claim at all', async () => {
    await renderCloudStep();
    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
    // No hint line renders for it — silence is honest; inventing a promise is not.
    expect(screen.queryByText(/: Free tier/)).not.toBeInTheDocument();
  });

  test('the welcome card says free tiers exist instead of assuming every option is free', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByText(/account limits and charges depend on the service/i)).toBeInTheDocument();
  });
});

describe('FirstRunModal — first-user consent, routing and focus', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
  }

  test('checking this PC offers size and internet requirements without starting a download', async () => {
    const electron = makeMockElectron();
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [] });
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(screen.getByText(/approximately 4.4 GB/)).toBeInTheDocument();
    expect(screen.getByText(/needs an internet connection and free disk space/)).toBeInTheDocument();
    expect(screen.getByText(/Free disk space could not be checked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download AI' })).toBeEnabled();
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    expect(electron.downloadOllama).not.toHaveBeenCalled();
  });

  test('known insufficient disk space blocks the explicit download', async () => {
    const electron = { ...makeMockElectron(), runDiagnostics: jest.fn().mockResolvedValue({ disk: { ok: true, freeGB: 1 } }) };
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [] });
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    const download = screen.getByRole('button', { name: 'Download AI' });
    expect(download).toBeDisabled();
    fireEvent.click(download);
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    expect(screen.getByText(/Not enough disk space/)).toBeInTheDocument();
  });

  test('installation consent is separate from consent to download a chat model', async () => {
    const electron = makeMockElectron();
    electron.checkConnection.mockResolvedValue({ ollama: 'offline' });
    electron.checkOllamaInstalled.mockResolvedValue({ installed: false, path: '' });
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [] });
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(electron.downloadOllama).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install Ollama automatically' })); });
    expect(electron.downloadOllama).toHaveBeenCalledTimes(1);
    expect(electron.pullModelStream).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download AI' })).toBeEnabled();
  });

  test('local Finish disables inherited cloud and uncensored routing while saving the installed choice', async () => {
    const electron = makeMockElectron();
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }] });
    window.electron = electron as any;
    const onSave = jest.fn();
    render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'missing', uncensoredMode: true, useCustomLLM: true,
      customLLM: { name: 'Previous', provider: 'groq', apiUrl: 'https://api.groq.com/openai/v1', apiKey: 'fixture', model: 'previous', enabled: true },
    }} onSave={onSave} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    fireEvent.click(screen.getByText('Next'));
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ chatModel: 'qwen2.5:3b', uncensoredMode: false, useCustomLLM: false });
    expect(saved.customLLM.enabled).toBe(false);
    expect(resolveCloudLLM(saved).intended).toBe(false);
    expect(electron.pullModelStream).not.toHaveBeenCalled();
  });

  test('local completion copy stays local after visiting a subscription choice', async () => {
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('Online'));
    fireEvent.click(screen.getByText('ChatGPT subscription'));
    fireEvent.click(screen.getByText('Back'));
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText(/Your installed AI is selected for chat/)).toBeInTheDocument();
    expect(screen.queryByText(/Your subscription is selected for chat/)).toBeNull();
  });

  test('Back rejects an old inventory reply after choosing a different path', async () => {
    const electron = makeMockElectron();
    const inventory = deferred<{ success: boolean; models: { name: string }[] }>();
    electron.listOllamaModels.mockReturnValueOnce(inventory.promise);
    window.electron = electron as any;
    const onSave = jest.fn();
    render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'original' }} onSave={onSave} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(screen.getByText('Setting up...')).toBeDisabled();
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByText('Online'));
    await act(async () => { inventory.resolve({ success: true, models: [{ name: 'expired-model' }] }); });
    fireEvent.click(screen.getByText('Next'));
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ chatModel: 'original' }));
    expect(electron.pullModelStream).not.toHaveBeenCalled();
  });

  test('an old local check cannot overwrite a newer local choice', async () => {
    const electron = makeMockElectron();
    const old = deferred<{ success: boolean; models: { name: string }[] }>();
    electron.listOllamaModels.mockReturnValueOnce(old.promise).mockResolvedValue({ success: true, models: [{ name: 'current-model' }] });
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    fireEvent.click(screen.getByText('Back'));
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    await act(async () => { old.resolve({ success: true, models: [{ name: 'expired-model' }] }); });
    expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('current-model');
    expect(screen.queryByRole('option', { name: 'expired-model' })).toBeNull();
  });

  test('an authorized download continues after Back without starting another pull or changing the new path', async () => {
    const electron = makeMockElectron();
    const pull = deferred<{ success: boolean }>();
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [] });
    electron.pullModelStream.mockReturnValueOnce(pull.promise);
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText(/continues in the background/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(screen.getByRole('button', { name: 'Download AI' })).toBeDisabled();
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByText('Online'));
    await act(async () => { pull.resolve({ success: true }); });
    expect(screen.getByRole('dialog', { name: 'Connect an AI service' })).toBeInTheDocument();
    expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
    expect(electron.listOllamaModels).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Ollama is ready!')).toBeNull();
  });

  test('Skip invalidates a pending local download and prevents its verification follow-up', async () => {
    const electron = makeMockElectron();
    const pull = deferred<{ success: boolean }>();
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [] });
    electron.pullModelStream.mockReturnValueOnce(pull.promise);
    window.electron = electron as any;
    const onSave = jest.fn(), onClose = jest.fn();
    render(<FirstRunModal open settings={{ ...baseSettings, chatModel: 'original' }} onSave={onSave} onClose={onClose} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
    await act(async () => { fireEvent.click(screen.getByText('Skip setup')); });
    await act(async () => { pull.resolve({ success: true }); });
    expect(electron.listOllamaModels).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ chatModel: 'original', firstRun: false }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('background Ollama installation reconciles the reentered local path without another installation or model pull', async () => {
    const electron = makeMockElectron();
    const installation = deferred<{ success: boolean }>();
    electron.checkConnection.mockResolvedValue({ ollama: 'offline' });
    electron.checkOllamaInstalled.mockResolvedValue({ installed: false, path: '' });
    electron.downloadOllama.mockReturnValueOnce(installation.promise);
    electron.listOllamaModels.mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }] });
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install Ollama automatically' })); });
    fireEvent.click(screen.getByText('Back'));
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(screen.getByRole('button', { name: 'Install Ollama automatically' })).toBeDisabled();
    electron.checkConnection.mockResolvedValue({ ollama: 'online' });
    await act(async () => { installation.resolve({ success: true }); });
    expect(screen.getByText('Ollama is ready!')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('qwen2.5:3b');
    expect(electron.checkConnection).toHaveBeenCalledTimes(3);
    expect(electron.listOllamaModels).toHaveBeenCalledTimes(1);
    expect(electron.downloadOllama).toHaveBeenCalledTimes(1);
    expect(electron.pullModelStream).not.toHaveBeenCalled();
  });

  test('a failed background Ollama installation rechecks and can be retried deliberately', async () => {
    const electron = makeMockElectron();
    const installation = deferred<{ success: boolean; error: string }>();
    electron.checkConnection.mockResolvedValue({ ollama: 'offline' });
    electron.checkOllamaInstalled.mockResolvedValue({ installed: false, path: '' });
    electron.downloadOllama.mockReturnValueOnce(installation.promise);
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install Ollama automatically' })); });
    fireEvent.click(screen.getByText('Back'));
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    await act(async () => { installation.resolve({ success: false, error: 'Fixture installation interrupted' }); });
    expect(electron.checkConnection).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/Fixture installation interrupted.*Local setup has been checked again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(electron.downloadOllama).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    expect(electron.checkConnection).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('button', { name: 'Install Ollama automatically' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install Ollama automatically' })); });
    expect(electron.downloadOllama).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Ollama is ready!')).toBeInTheDocument();
    expect(electron.pullModelStream).not.toHaveBeenCalled();
  });

  test('download completion replaces an unfinished reentry check and ignores its later empty inventory', async () => {
    const electron = makeMockElectron();
    const pull = deferred<{ success: boolean }>();
    const oldInventory = deferred<{ success: boolean; models: { name: string }[] }>();
    electron.listOllamaModels.mockResolvedValueOnce({ success: true, models: [] })
      .mockReturnValueOnce(oldInventory.promise)
      .mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:3b' }] });
    electron.pullModelStream.mockReturnValueOnce(pull.promise);
    window.electron = electron as any;
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download AI' })); });
    fireEvent.click(screen.getByText('Back'));
    await act(async () => { fireEvent.click(screen.getByText('On this PC')); });
    expect(screen.getByText('Checking installed models...')).toBeInTheDocument();
    await act(async () => { pull.resolve({ success: true }); });
    expect(screen.getByText('Ollama is ready!')).toBeInTheDocument();
    await act(async () => { oldInventory.resolve({ success: true, models: [] }); });
    expect(screen.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('qwen2.5:3b');
    expect(screen.queryByRole('button', { name: 'Download AI' })).toBeNull();
    expect(electron.listOllamaModels).toHaveBeenCalledTimes(3);
    expect(electron.pullModelStream).toHaveBeenCalledTimes(1);
  });

  test('fake-key catalogue success never claims a validated connection', async () => {
    const onSave = jest.fn();
    render(<FirstRunModal open settings={baseSettings} onSave={onSave} onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('Online'));
    fireEvent.change(screen.getByLabelText('AI service key'), { target: { value: 'not-a-real-key' } });
    await act(async () => { fireEvent.click(screen.getByText('Prepare service')); });
    expect(screen.queryByText('Connected! Ready to chat.')).toBeNull();
    expect(screen.getByText(/Your key and ability to chat have not been verified/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    expect(screen.queryByText("You're all set!")).toBeNull();
    expect(screen.getByText('Ready to try a message')).toBeInTheDocument();
  });

  test.each(['DeepSeek', 'Google AI Studio', 'Google Gemini Native'])('%s configures a default without a saved-consent-gated discovery call', async label => {
    const electron = makeMockElectron();
    window.electron = electron as any;
    const onSave = jest.fn();
    render(<FirstRunModal open settings={baseSettings} onSave={onSave} onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('Online'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
    fireEvent.change(screen.getByLabelText('AI service key'), { target: { value: 'fixture-key' } });
    await act(async () => { fireEvent.click(screen.getByText('Prepare service')); });
    expect(electron.listCustomLLMModels).not.toHaveBeenCalled();
    expect(screen.getByText(/have not been verified/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    await act(async () => { fireEvent.click(screen.getByText('Get Started')); });
    expect(onSave.mock.calls[0][0]).toMatchObject({ useCustomLLM: true, uncensoredMode: false, customLLM: { enabled: true, apiKey: 'fixture-key' } });
    expect(onSave.mock.calls[0][0].customLLM.model).toBeTruthy();
  });

  test('returned preparation errors remain actionable instead of being replaced by a guessed key error', async () => {
    (window as any).electron.listCustomLLMModels.mockResolvedValue({ success: false, error: 'Online access is disabled. Open Settings to enable it.' });
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('Online'));
    fireEvent.change(screen.getByLabelText('AI service key'), { target: { value: 'fixture' } });
    await act(async () => { fireEvent.click(screen.getByText('Prepare service')); });
    expect(screen.getByRole('alert')).toHaveTextContent('Online access is disabled. Open Settings to enable it.');
    expect(screen.getByText('Next')).toBeDisabled();
  });

  test('focus enters the labelled dialog, wraps at both keyboard boundaries and follows the step', async () => {
    render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    const heading = screen.getByRole('heading', { name: 'Welcome to HomeBot' });
    expect(screen.getByRole('dialog', { name: 'Welcome to HomeBot' })).toHaveAttribute('aria-modal', 'true');
    expect(heading).toHaveFocus();
    fireEvent.keyDown(heading, { key: 'Tab', shiftKey: true });
    const skip = screen.getByText('Skip setup');
    expect(skip).toHaveFocus();
    fireEvent.keyDown(skip, { key: 'Tab' });
    const local = screen.getByText('On this PC').closest('button')!;
    expect(local).toHaveFocus();
    fireEvent.keyDown(local, { key: 'Tab', shiftKey: true });
    expect(skip).toHaveFocus();
    await act(async () => { fireEvent.click(screen.getByText('Online')); });
    expect(screen.getByRole('heading', { name: 'Connect an AI service' })).toHaveFocus();
    expect(screen.getByRole('img', { name: 'Setup step 2 of 3' })).toBeInTheDocument();
    expect(screen.getByLabelText('AI service key')).toBeInTheDocument();
  });

  test('closing restores focus to the control that opened setup', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open setup';
    document.body.appendChild(opener);
    opener.focus();
    const view = render(<FirstRunModal open settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
