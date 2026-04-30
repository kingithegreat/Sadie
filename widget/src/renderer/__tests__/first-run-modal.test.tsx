/** @jest-environment jsdom */
/**
 * first-run-modal.test.tsx
 * Tests for src/renderer/components/FirstRunModal.tsx (multi-step wizard)
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
    listOllamaModels: jest.fn().mockResolvedValue({ success: true, models: [{ name: 'qwen2.5:7b' }] }),
  };
}

async function advanceToStep(targetStep: number) {
  for (let i = 0; i < targetStep; i++) {
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
  }
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

  test('renders Next and Skip setup buttons on first step', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByText('Next')).toBeInTheDocument();
    expect(screen.getByText('Skip setup')).toBeInTheDocument();
  });
});

describe('FirstRunModal — Get Started button (final step)', () => {
  test('calls onSave with firstRun: false', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await advanceToStep(4);
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
    await advanceToStep(4);
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onSave.mock.calls[0][0]).toMatchObject({ telemetryEnabled: true });
  });

  test('calls onSave with a telemetryConsentTimestamp string', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await advanceToStep(4);
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    const ts = onSave.mock.calls[0][0].telemetryConsentTimestamp;
    expect(typeof ts).toBe('string');
    expect(ts.length).toBeGreaterThan(0);
  });

  test('calls onClose after Get Started', async () => {
    const onClose = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={onClose} />
    );
    await advanceToStep(4);
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls window.electron.saveSettings on Get Started', async () => {
    const saveSettings = jest.fn().mockResolvedValue(undefined);
    (window as any).electron = { ...makeMockElectron(saveSettings), saveSettings };
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await advanceToStep(4);
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  test('still calls onSave when window.electron.saveSettings is absent', async () => {
    delete (window as any).electron.saveSettings;
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await advanceToStep(4);
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('still calls onSave when window.electron is absent', async () => {
    delete (window as any).electron;
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    // Without electron, Next won't trigger checkOllama correctly but should still work
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        fireEvent.click(screen.getByText('Next'));
      });
    }
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
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

describe('FirstRunModal — permissions (step 4)', () => {
  test('renders a checkbox for each permission key on the permissions step', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await advanceToStep(3);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(Object.keys(baseSettings.permissions!).length);
  });

  test('toggling a permission includes updated value in Get Started payload', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await advanceToStep(3);
    const moveFileCheckbox = screen.getByRole('checkbox', { name: /move file/i });
    fireEvent.click(moveFileCheckbox);
    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Get Started'));
    });
    expect(onSave.mock.calls[0][0].permissions?.move_file).toBe(true);
  });
});

describe('FirstRunModal — wizard navigation', () => {
  test('shows Back button after first step', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.queryByText('Back')).toBeNull();
    await advanceToStep(1);
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  test('Back button returns to previous step', async () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await advanceToStep(1);
    expect(screen.getByText('Connection Check')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('Back'));
    });
    expect(screen.getByText('Welcome to SADIE')).toBeInTheDocument();
  });

  test('progress dots are rendered', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    const dots = document.querySelectorAll('.wizard-dot');
    expect(dots.length).toBe(5);
  });
});
