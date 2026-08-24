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

  test('Next advances to done and celebrates when the local AI actually came up', async () => {
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
    // In this mocked run the local check genuinely succeeds, so the
    // celebration is earned. The dishonest branch is tested below, where the
    // cloud path reaches done with nothing configured at all.
    expect(screen.getByText("You're all set!")).toBeInTheDocument();
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

  test('done DOES celebrate when the cloud key actually tested OK', async () => {
    const electron = makeMockElectron();
    (window as any).electron = electron;
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => { fireEvent.click(screen.getByText('Online')); });
    fireEvent.change(screen.getByPlaceholderText('Paste the key from your account page'), {
      target: { value: 'sk-test-123' },
    });
    await act(async () => { fireEvent.click(screen.getByText('Test Connection')); });
    await act(async () => { fireEvent.click(screen.getByText('Next')); });
    // A tested, working key is a real success and gets said as one.
    expect(screen.getByText("You're all set!")).toBeInTheDocument();
  });
});

describe('FirstRunModal — cloud path', () => {
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

  test('Test Connection calls listCustomLLMModels', async () => {
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
      fireEvent.click(screen.getByText('Online'));
    });
    const input = screen.getByPlaceholderText('Paste the key from your account page');
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
      fireEvent.click(screen.getByText('Online'));
    });

    const input = screen.getByPlaceholderText('Paste the key from your account page');
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
    expect(screen.getByText(/Several providers have genuinely free tiers/i)).toBeInTheDocument();
  });
});
