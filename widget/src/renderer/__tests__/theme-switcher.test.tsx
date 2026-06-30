/** @jest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react';
import SettingsPanel from '../components/SettingsPanel';

// Minimal valid settings object
const baseSettings: any = {
  alwaysOnTop: false,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'CmdOrCtrl+Shift+Space',
  chatModel: 'qwen2.5:7b',
  permissions: {},
};

// Mock electron API used by SettingsPanel sub-components
beforeEach(() => {
  (window as any).electron = {
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: {} } }),
    saveConversation: jest.fn().mockResolvedValue({}),
    getModelList: jest.fn().mockResolvedValue([]),
    checkModelStatus: jest.fn().mockResolvedValue({ loaded: false }),
    invoke: jest.fn().mockResolvedValue(null),
    getTelemetryStats: jest.fn().mockResolvedValue({ totalEvents: 0, events: [] }),
    onTelemetryStats: jest.fn(),
    offTelemetryStats: jest.fn(),
  };
});

afterEach(() => {
  delete (window as any).electron;
});

describe('SettingsPanel — Theme switcher', () => {
  test('renders three theme buttons', () => {
    render(<SettingsPanel settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByLabelText('dark theme')).toBeInTheDocument();
    expect(screen.getByLabelText('light theme')).toBeInTheDocument();
    expect(screen.getByLabelText('system theme')).toBeInTheDocument();
  });

  test('dark is active by default when no theme set', () => {
    render(<SettingsPanel settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    const darkBtn = screen.getByLabelText('dark theme');
    expect(darkBtn.className).toContain('active');
  });

  test('clicking light theme makes it active', () => {
    render(<SettingsPanel settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    const lightBtn = screen.getByLabelText('light theme');
    fireEvent.click(lightBtn);
    expect(lightBtn.className).toContain('active');
    expect(screen.getByLabelText('dark theme').className).not.toContain('active');
  });

  test('clicking system theme makes it active', () => {
    render(<SettingsPanel settings={baseSettings} onSave={jest.fn()} onClose={jest.fn()} />);
    const systemBtn = screen.getByLabelText('system theme');
    fireEvent.click(systemBtn);
    expect(systemBtn.className).toContain('active');
  });

  test('respects initial theme from settings', () => {
    render(<SettingsPanel settings={{ ...baseSettings, theme: 'light' }} onSave={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByLabelText('light theme').className).toContain('active');
    expect(screen.getByLabelText('dark theme').className).not.toContain('active');
  });
});
