/**
 * @jest-environment jsdom
 *
 * Tests for ConnectionsPanel — the curated front door to MCP.
 *
 * The house defect is capability that exists and that nothing reaches, so the
 * assertions here are about what a PERSON can do: see every card, open one,
 * see Connect disabled until the key fields are filled, and have Connect go
 * through the same mcpAddServer IPC as the hand-entry form.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionsPanel } from '../components/ConnectionsPanel';
import { CONNECTIONS } from '../../shared/connections-catalogue';

const mockListServers = jest.fn().mockResolvedValue([]);
const mockAddServer = jest.fn().mockResolvedValue({ success: true });

beforeEach(() => {
  jest.clearAllMocks();
  (window as any).electron = {
    mcpListServers: mockListServers,
    mcpAddServer: mockAddServer,
  };
});

describe('ConnectionsPanel', () => {
  test('shows a card for every catalogue entry, with its cost badge', async () => {
    render(<ConnectionsPanel navContext={null} />);
    for (const entry of CONNECTIONS) {
      expect(screen.getByText(entry.name)).toBeTruthy();
      expect(screen.getByText(entry.reach)).toBeTruthy();
    }
    // Cost is visible before expanding — nobody invests in a dead end.
    expect(screen.getAllByText(/Free —/).length).toBeGreaterThan(0);
  });

  test('marks an already-configured server as Connected', async () => {
    mockListServers.mockResolvedValue([{ name: 'memory', enabled: true }]);
    render(<ConnectionsPanel navContext={null} />);
    await waitFor(() => expect(screen.getAllByText('Connected').length).toBe(1));
  });

  test('Connect stays disabled until required keys are filled, then sends the pre-filled config', async () => {
    const notion = CONNECTIONS.find((c) => c.id === 'notion')!;
    render(<ConnectionsPanel navContext={{ service: 'notion' }} />);

    const connectBtn = await screen.findByRole('button', { name: 'Connect' });
    expect((connectBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(notion.keys[0].label), {
      target: { value: 'ntn_test123' },
    });
    expect((connectBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(connectBtn);
    await waitFor(() => expect(mockAddServer).toHaveBeenCalledTimes(1));
    const config = mockAddServer.mock.calls[0][0];
    expect(config.type).toBe('stdio');
    expect(config.name).toBe('notion');
    expect(config.command).toBe(notion.command);
    const header = JSON.parse(config.env.OPENAPI_MCP_HEADERS);
    expect(header.Authorization).toBe('Bearer ntn_test123');

    // The restart note: a connection saved silently looks broken on relaunch.
    await screen.findByText(/Restart HomeBot/i);
  });

  test('a keyless entry can connect straight from its card', async () => {
    render(<ConnectionsPanel navContext={{ service: 'memory' }} />);
    const connectBtn = await screen.findByRole('button', { name: 'Connect' });
    expect((connectBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(connectBtn);
    await waitFor(() => expect(mockAddServer).toHaveBeenCalledTimes(1));
    expect(mockAddServer.mock.calls[0][0].name).toBe('memory');
  });

  test('cards start collapsed unless navContext names the service', () => {
    render(<ConnectionsPanel navContext={{ service: 'github' }} />);
    expect(screen.getByLabelText(CONNECTIONS.find((c) => c.id === 'github')!.keys[0].label)).toBeTruthy();
    // And nothing else's form is open.
    expect(
      screen.queryByLabelText(CONNECTIONS.find((c) => c.id === 'slack')!.keys[0].label),
    ).toBeNull();
  });

  test('says where each key comes from, as a real link', () => {
    render(<ConnectionsPanel navContext={{ service: 'notion' }} />);
    const links = screen.getAllByText('Where do I find this?') as HTMLAnchorElement[];
    expect(links.length).toBe(1);
    expect(links[0].href).toBe('https://www.notion.so/profile/integrations');
  });

  test('keeps the boundary visible: HomeBot mediates, hand-entry still exists', () => {
    render(<ConnectionsPanel navContext={null} />);
    expect(screen.getByText(/mediates every connection/i)).toBeTruthy();
    expect(screen.getByText(/hand-entry form/i)).toBeTruthy();
  });
});
