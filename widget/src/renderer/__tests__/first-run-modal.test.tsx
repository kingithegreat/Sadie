/** @jest-environment jsdom */
/**
 * first-run-modal.test.tsx
 * Tests for src/renderer/components/FirstRunModal.tsx (3-step wizard: welcome → setup → done)
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import FirstRunModal from '../components/FirstRunModal';
import type { Settings } from '../../shared/types';

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
  defaultTeam: '',
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
    pullModelStream: jest.fn().mockResolvedValue({ success: true }),
    onPullModelProgress: jest.fn().mockReturnValue(() => {}),
    onOllamaDownloadProgress: jest.fn().mockReturnValue(() => {}),
    downloadOllama: jest.fn().mockResolvedValue({ success: true }),
  };
}

beforeEach(() => {
  (window as any).electron = makeMockElectron();
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
    expect(screen.getByText('Welcome to SADIE')).toBeInTheDocument();
  });

  test('renders path selection cards on welcome step', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByText('Local (Ollama)')).toBeInTheDocument();
    expect(screen.getByText('Cloud API')).toBeInTheDocument();
  });

  test('renders Skip setup button', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByText('Skip setup')).toBeInTheDocument();
  });
});

describe('FirstRunModal — local path', () => {
  test('clicking Local shows connection check', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Local (Ollama)'));
    });
    expect(screen.getByText('Local Setup')).toBeInTheDocument();
  });

  test('shows Ollama running status when online', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Local (Ollama)'));
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
      fireEvent.click(screen.getByText('Local (Ollama)'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(screen.getByText(/Test GPU/)).toBeInTheDocument();
  });

  test('Next advances to done step', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Local (Ollama)'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
    expect(screen.getByText("You're all set!")).toBeInTheDocument();
  });
});

describe('FirstRunModal — cloud path', () => {
  test('clicking Cloud shows provider selection', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Cloud API'));
    });
    expect(screen.getByText('Cloud Setup')).toBeInTheDocument();
    expect(screen.getByText('Groq')).toBeInTheDocument();
  });

  test('Test Connection calls listCustomLLMModels', async () => {
    const electron = makeMockElectron();
    (window as any).electron = electron;
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Cloud API'));
    });
    const input = screen.getByPlaceholderText('Paste your API key');
    fireEvent.change(input, { target: { value: 'sk-test-123' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Test Connection'));
    });
    expect(electron.listCustomLLMModels).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-test-123', provider: 'groq' })
    );
  });

  test('successful test shows connected status', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Cloud API'));
    });
    const input = screen.getByPlaceholderText('Paste your API key');
    fireEvent.change(input, { target: { value: 'sk-test-123' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Test Connection'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(screen.getByText('Connected! Ready to chat.')).toBeInTheDocument();
  });
});

describe('FirstRunModal — Get Started (final step)', () => {
  test('calls onSave with firstRun: false', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Local (Ollama)'));
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

  test('calls onSave with telemetryEnabled: true', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Local (Ollama)'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onSave.mock.calls[0][0]).toMatchObject({ telemetryEnabled: true });
  });

  test('calls onClose after Get Started', async () => {
    const onClose = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={onClose} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Local (Ollama)'));
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
      fireEvent.click(screen.getByText('Cloud API'));
    });
    const input = screen.getByPlaceholderText('Paste your API key');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Test Connection'));
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
    // Model should be set from the test-connection response or provider default
    expect(onSave.mock.calls[0][0].customLLM.model).toBe('test-model');
  });

  test('switching provider after a successful test clears the prior success state and requires retest', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Cloud API'));
    });

    const input = screen.getByPlaceholderText('Paste your API key');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Test Connection'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    await act(async () => {
      fireEvent.click(screen.getByText('OpenAI'));
    });

    expect(screen.queryByText('Connected! Ready to chat.')).not.toBeInTheDocument();
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
    expect(onSave.mock.calls[0][0]).toMatchObject({ firstRun: false, telemetryEnabled: true });
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
      fireEvent.click(screen.getByText('Local (Ollama)'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(screen.getByText('Back')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('Back'));
    });
    expect(screen.getByText('Welcome to SADIE')).toBeInTheDocument();
  });

  test('progress dots are rendered (3 steps)', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    const dots = document.querySelectorAll('.wizard-dot');
    expect(dots.length).toBe(3);
  });
});
