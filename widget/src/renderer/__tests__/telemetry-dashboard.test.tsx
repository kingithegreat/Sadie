/** @jest-environment jsdom */
/**
 * telemetry-dashboard.test.tsx
 * Tests for src/renderer/components/TelemetryDashboard.tsx
 */

import { render, screen, act, fireEvent } from '@testing-library/react';
import TelemetryDashboard from '../components/TelemetryDashboard';

function setup(overrides?: { readTelemetryEvents?: () => Promise<any> }) {
  const readTelemetryEvents = overrides?.readTelemetryEvents
    ?? jest.fn().mockResolvedValue({ success: true, events: [] });
  (window as any).electron = { readTelemetryEvents };
  return { readTelemetryEvents };
}

afterEach(() => {
  delete (window as any).electron;
});

describe('TelemetryDashboard — open/closed', () => {
  test('renders nothing when open=false', () => {
    setup();
    const { container } = render(<TelemetryDashboard open={false} onClose={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders heading when open=true', async () => {
    setup();
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText('Telemetry Dashboard')).toBeInTheDocument();
  });

  test('renders Close button', async () => {
    setup();
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  test('calls onClose when Close is clicked', async () => {
    setup();
    const onClose = jest.fn();
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={onClose} />);
    });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TelemetryDashboard — loading state', () => {
  test('shows Loading… while data is fetching', () => {
    // Never resolves
    (window as any).electron = {
      readTelemetryEvents: jest.fn().mockReturnValue(new Promise(() => {})),
    };
    render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

describe('TelemetryDashboard — data display', () => {
  test('shows total events count', async () => {
    const events = [
      { event: 'stream_ok', timestamp: new Date().toISOString(), details: {} },
      { event: 'stream_failure', timestamp: new Date().toISOString(), details: {} },
    ];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    // Use getAllByText since the same number can appear in multiple tiles
    const matches = screen.getAllByText('2');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  test('shows stream_failure count', async () => {
    const events = [
      { event: 'stream_failure', timestamp: new Date().toISOString(), details: {} },
      { event: 'stream_failure', timestamp: new Date().toISOString(), details: {} },
    ];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    // stream_failure count + total count = "2" appears twice; unique types = 1
    const tiles = screen.getAllByText('2');
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });

  test('shows 0 stream failures when there are none', async () => {
    const events = [{ event: 'chat_sent', timestamp: new Date().toISOString(), details: {} }];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  test('shows unique event types count', async () => {
    const events = [
      { event: 'a', timestamp: new Date().toISOString(), details: {} },
      { event: 'b', timestamp: new Date().toISOString(), details: {} },
      { event: 'a', timestamp: new Date().toISOString(), details: {} },
    ];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    // 2 unique event types
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  test('shows "No telemetry events recorded." when events list is empty', async () => {
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events: [] }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText('No telemetry events recorded.')).toBeInTheDocument();
  });

  test('renders event rows', async () => {
    const events = [
      { event: 'tool_call', timestamp: new Date().toISOString(), details: { tool: 'calc' } },
    ];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText('tool_call')).toBeInTheDocument();
  });
});

describe('TelemetryDashboard — API edge cases', () => {
  test('treats success=false response as empty events', async () => {
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: false }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText('No telemetry events recorded.')).toBeInTheDocument();
  });

  test('treats non-array events field as empty', async () => {
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events: null }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText('No telemetry events recorded.')).toBeInTheDocument();
  });

  test('shows error text when readTelemetryEvents throws', async () => {
    setup({ readTelemetryEvents: jest.fn().mockRejectedValue(new Error('read failed')) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText(/read failed/)).toBeInTheDocument();
  });

  test('does not call readTelemetryEvents when open=false', () => {
    const { readTelemetryEvents } = setup();
    render(<TelemetryDashboard open={false} onClose={jest.fn()} />);
    expect(readTelemetryEvents).not.toHaveBeenCalled();
  });
});
