/** @jest-environment jsdom */
/**
 * first-run-modal.test.tsx
 * Tests for src/renderer/components/FirstRunModal.tsx
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
  return { saveSettings };
}

beforeEach(() => {
  // Make window.electron available in jsdom
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

  test('renders Finish and Skip buttons', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByText('Finish')).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });
});

describe('FirstRunModal — Finish button', () => {
  test('calls onSave with firstRun: false', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Finish'));
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
      fireEvent.click(screen.getByText('Finish'));
    });
    expect(onSave.mock.calls[0][0]).toMatchObject({ telemetryEnabled: true });
  });

  test('calls onSave with a telemetryConsentTimestamp string', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Finish'));
    });
    const ts = onSave.mock.calls[0][0].telemetryConsentTimestamp;
    expect(typeof ts).toBe('string');
    expect(ts.length).toBeGreaterThan(0);
  });

  test('calls onClose after Finish', async () => {
    const onClose = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={onClose} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Finish'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls window.electron.saveSettings on Finish', async () => {
    const saveSettings = jest.fn().mockResolvedValue(undefined);
    (window as any).electron = { saveSettings };
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Finish'));
    });
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  test('still calls onSave when window.electron.saveSettings is absent', async () => {
    delete (window as any).electron.saveSettings;
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Finish'));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test('still calls onSave when window.electron is absent', async () => {
    delete (window as any).electron;
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Finish'));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('FirstRunModal — Skip button', () => {
  test('calls onSave with firstRun: false on Skip', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Skip'));
    });
    expect(onSave.mock.calls[0][0]).toMatchObject({ firstRun: false, telemetryEnabled: true });
  });

  test('calls onClose after Skip', async () => {
    const onClose = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={onClose} />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Skip'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('FirstRunModal — permissions', () => {
  test('renders a checkbox for each permission key', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // Expect at least one checkbox per permission (plus the disabled telemetry checkbox)
    expect(checkboxes.length).toBeGreaterThanOrEqual(Object.keys(baseSettings.permissions!).length);
  });

  test('toggling a permission includes updated value in Finish payload', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    // Find the "move file" checkbox (text label rendered as "move file")
    const moveFileCheckbox = screen.getByRole('checkbox', { name: /move file/i });
    fireEvent.click(moveFileCheckbox);
    await act(async () => {
      fireEvent.click(screen.getByText('Finish'));
    });
    expect(onSave.mock.calls[0][0].permissions?.move_file).toBe(true);
  });
});

describe('FirstRunModal — defaultTeam input', () => {
  test('renders the defaultTeam input field', () => {
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByPlaceholderText(/e\.g\., Lakers/i)).toBeInTheDocument();
  });

  test('reflects settings.defaultTeam as initial value', () => {
    const settings = { ...baseSettings, defaultTeam: 'Lakers' };
    render(
      <FirstRunModal open={true} settings={settings} onSave={jest.fn()} onClose={jest.fn()} />
    );
    expect(screen.getByPlaceholderText(/Lakers/i)).toHaveValue('Lakers');
  });

  test('includes updated defaultTeam in Finish payload', async () => {
    const onSave = jest.fn();
    render(
      <FirstRunModal open={true} settings={baseSettings} onSave={onSave} onClose={jest.fn()} />
    );
    const input = screen.getByPlaceholderText(/e\.g\., Lakers/i);
    fireEvent.change(input, { target: { value: 'Celtics' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Finish'));
    });
    expect(onSave.mock.calls[0][0].defaultTeam).toBe('Celtics');
  });
});
