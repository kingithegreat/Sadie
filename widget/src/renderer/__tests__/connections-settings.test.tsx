/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../components/TelemetryConsentModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/TelemetryDashboard', () => ({ __esModule: true, default: () => null }));

import SettingsPanel from '../components/SettingsPanel';

const baseSettings = {
  alwaysOnTop: true,
  n8nUrl: 'http://localhost:5678',
  widgetHotkey: 'Ctrl+Shift+Space',
};

const mockListServers = jest.fn();
const mockAddServer = jest.fn();
const mockRemoveServer = jest.fn();
const mockToggleServer = jest.fn();
const mockGetStatus = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockListServers.mockResolvedValue([]);
  mockGetStatus.mockResolvedValue([]);
  mockAddServer.mockResolvedValue({ success: true, connected: true, toolCount: 5 });
  mockRemoveServer.mockResolvedValue({ success: true });
  mockToggleServer.mockResolvedValue({ success: true });
  window.confirm = jest.fn().mockReturnValue(true);

  (window as any).electron = {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    mcpListServers: mockListServers,
    mcpGetStatus: mockGetStatus,
    mcpAddServer: mockAddServer,
    mcpRemoveServer: mockRemoveServer,
    mcpToggleServer: mockToggleServer,
    schedulerList: jest.fn().mockResolvedValue([]),
    listCustomLLMModels: jest.fn().mockResolvedValue({
      success: true,
      models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
    }),
  };
});

afterEach(() => {
  delete (window as any).electron;
});

describe('SettingsPanel — Curated Connections in Simple view', () => {
  test('renders Connected Services section directly in Simple view without needing Advanced', async () => {
    render(
      <SettingsPanel settings={baseSettings as any} onSave={jest.fn()} onClose={jest.fn()} />
    );

    // Connected Services header should exist immediately in default Simple view
    expect(screen.getByText(/Connected Services/i)).toBeTruthy();
    // Cards for Google Drive & Docs and Gmail should be rendered
    expect(screen.getByText('Google Drive & Docs')).toBeTruthy();
    expect(screen.getByText('Gmail')).toBeTruthy();
    expect(screen.getByText('Notion')).toBeTruthy();
    expect(screen.getByText('GitHub')).toBeTruthy();
  });

  test('entering credentials and clicking Save & Connect calls mcpAddServer', async () => {
    render(
      <SettingsPanel settings={baseSettings as any} onSave={jest.fn()} onClose={jest.fn()} />
    );

    // Find Connect button for Google Drive & Docs
    const gdriveHeading = screen.getByText('Google Drive & Docs');
    const card = gdriveHeading.closest('.sp-connection-card')!;
    const connectBtn = card.querySelector('button')!;
    expect(connectBtn.textContent).toBe('Connect');

    // Click Connect to expand credentials form
    fireEvent.click(connectBtn);

    const input = screen.getByLabelText('Path to gcp-oauth.keys.json credentials file');
    const saveBtn = screen.getByRole('button', { name: 'Save & Connect' });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    // Fill in path
    fireEvent.change(input, { target: { value: 'C:\\keys\\gcp-oauth.keys.json' } });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAddServer).toHaveBeenCalledTimes(1);
    });

    const passedConfig = mockAddServer.mock.calls[0][0];
    expect(passedConfig.name).toBe('google-drive');
    expect(passedConfig.command).toBe('npx');
    expect(passedConfig.args).toContain('@modelcontextprotocol/server-gdrive');
    expect(passedConfig.env.GDRIVE_CREDENTIALS_PATH).toBe('C:\\keys\\gcp-oauth.keys.json');
  });

  test('shows 1-click Disconnect and Disable for connected servers and calls IPC', async () => {
    mockListServers.mockResolvedValue([
      { name: 'gmail', enabled: true },
    ]);
    mockGetStatus.mockResolvedValue([
      { name: 'gmail', connected: true, toolCount: 3 },
    ]);

    render(
      <SettingsPanel settings={baseSettings as any} onSave={jest.fn()} onClose={jest.fn()} />
    );

    // Wait for server list and status to load
    await waitFor(() => {
      expect(screen.getByText('Connected (3 tools)')).toBeTruthy();
    });

    // Toggle to disable
    const disableBtn = screen.getByRole('button', { name: 'Disable' });
    fireEvent.click(disableBtn);

    await waitFor(() => {
      expect(mockToggleServer).toHaveBeenCalledWith('gmail', false);
    });
    await screen.findByText(/Gmail disabled/i);

    // Disconnect
    const disconnectBtn = screen.getByRole('button', { name: 'Disconnect' });
    fireEvent.click(disconnectBtn);

    await waitFor(() => {
      expect(mockRemoveServer).toHaveBeenCalledWith('gmail');
    });
  });
});
