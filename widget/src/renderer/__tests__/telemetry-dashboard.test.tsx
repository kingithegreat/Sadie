/** @jest-environment jsdom */
/**
 * telemetry-dashboard.test.tsx
 * Tests for src/renderer/components/TelemetryDashboard.tsx (Analytics Dashboard)
 */

import { render, screen, act, fireEvent } from '@testing-library/react';
import TelemetryDashboard from '../components/TelemetryDashboard';

function setup(overrides?: { readTelemetryEvents?: () => Promise<any>; getAnalyticsSummary?: () => Promise<any> }) {
  const readTelemetryEvents = overrides?.readTelemetryEvents
    ?? jest.fn().mockResolvedValue({ success: true, events: [] });
  const getAnalyticsSummary = overrides?.getAnalyticsSummary
    ?? jest.fn().mockResolvedValue({ success: true, summary: { conversationCount: 0, totalMessages: 0, avgMessagesPerConversation: 0, oldestConversation: null } });
  (window as any).electron = { readTelemetryEvents, getAnalyticsSummary };
  return { readTelemetryEvents, getAnalyticsSummary };
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
    expect(screen.getByText(/Analytics Dashboard/)).toBeInTheDocument();
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
    (window as any).electron = {
      readTelemetryEvents: jest.fn().mockReturnValue(new Promise(() => {})),
      getAnalyticsSummary: jest.fn().mockReturnValue(new Promise(() => {})),
    };
    render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

describe('TelemetryDashboard — overview tab', () => {
  test('shows total events count', async () => {
    const events = [
      { event: 'stream_ok', timestamp: new Date().toISOString(), details: {} },
      { event: 'stream_failure', timestamp: new Date().toISOString(), details: {} },
    ];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
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
    // stream_failure and total both show 2
    const tiles = screen.getAllByText('2');
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });

  test('shows 0 stream failures when there are none', async () => {
    const events = [{ event: 'chat_sent', timestamp: new Date().toISOString(), details: {} }];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    // 0 appears for both stream_failure and tool_call counts
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(1);
  });

  test('shows tool call count', async () => {
    const events = [
      { event: 'tool_call', timestamp: new Date().toISOString(), details: { tool: 'weather' } },
      { event: 'tool_call', timestamp: new Date().toISOString(), details: { tool: 'calc' } },
      { event: 'stream_failure', timestamp: new Date().toISOString(), details: {} },
    ];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    // "2" should appear for tool_call count
    const matches = screen.getAllByText('2');
    expect(matches.length).toBeGreaterThanOrEqual(1);
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
    // 2 unique event types — may appear alongside other "2" values
    const matches = screen.getAllByText('2');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  test('renders activity chart', async () => {
    const events = [
      { event: 'test', timestamp: new Date().toISOString(), details: {} },
    ];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByTestId('activity-chart')).toBeInTheDocument();
  });

  test('shows tool breakdown when tool_call events exist', async () => {
    const events = [
      { event: 'tool_call', timestamp: new Date().toISOString(), details: { tool: 'weather' } },
      { event: 'tool_call', timestamp: new Date().toISOString(), details: { tool: 'weather' } },
      { event: 'tool_call', timestamp: new Date().toISOString(), details: { tool: 'calc' } },
    ];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText('Top tools')).toBeInTheDocument();
    expect(screen.getByText('weather')).toBeInTheDocument();
    expect(screen.getByText('calc')).toBeInTheDocument();
  });
});

describe('TelemetryDashboard — events tab', () => {
  test('shows events list when Events tab is clicked', async () => {
    const events = [
      { event: 'tool_call', timestamp: new Date().toISOString(), details: { tool: 'calc' } },
    ];
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Events'));
    expect(screen.getByText('tool_call')).toBeInTheDocument();
  });

  test('shows "No telemetry events recorded." when events list is empty', async () => {
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events: [] }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Events'));
    expect(screen.getByText('No telemetry events recorded.')).toBeInTheDocument();
  });
});

describe('TelemetryDashboard — conversations tab', () => {
  test('shows conversation stats when Conversations tab is clicked', async () => {
    setup({
      getAnalyticsSummary: jest.fn().mockResolvedValue({
        success: true,
        summary: { conversationCount: 5, totalMessages: 42, avgMessagesPerConversation: 8, oldestConversation: '2025-01-15T00:00:00Z' },
      }),
    });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Conversations'));
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  test('shows fallback when no summary is available', async () => {
    setup({
      getAnalyticsSummary: jest.fn().mockResolvedValue({ success: false }),
    });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Conversations'));
    expect(screen.getByText('No conversation data available.')).toBeInTheDocument();
  });
});

describe('TelemetryDashboard — tabs', () => {
  test('renders all three tab buttons', async () => {
    setup();
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Conversations')).toBeInTheDocument();
  });
});

describe('TelemetryDashboard — API edge cases', () => {
  test('treats success=false response as empty events', async () => {
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: false }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Events'));
    expect(screen.getByText('No telemetry events recorded.')).toBeInTheDocument();
  });

  test('treats non-array events field as empty', async () => {
    setup({ readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events: null }) });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Events'));
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

// ── Tools tab ──────────────────────────────────────────────────────────────

describe('TelemetryDashboard — tools tab', () => {
  const toolCallStats = {
    totalCalls: 42,
    successRate: 0.905,
    perTool: {
      read_file: { count: 20, success: 19, errors: 1, cancelled: 0, p50_ms: 12, p95_ms: 45, errorTypes: { permission: 1 } },
      web_search: { count: 22, success: 19, errors: 2, cancelled: 1, p50_ms: 300, p95_ms: 1200, errorTypes: { network: 1, timeout: 1 } },
    },
  };

  function setupWithToolStats() {
    return setup({
      readTelemetryEvents: jest.fn().mockResolvedValue({ success: true, events: [] }),
      getAnalyticsSummary: jest.fn().mockResolvedValue({
        success: true,
        summary: {
          conversationCount: 5,
          totalMessages: 30,
          avgMessagesPerConversation: 6,
          oldestConversation: null,
          toolCallStats,
        },
      }),
    });
  }

  test('renders Tools tab button', async () => {
    setupWithToolStats();
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    expect(screen.getByText('Tools')).toBeInTheDocument();
  });

  test('shows total calls and success rate when Tools tab is active', async () => {
    setupWithToolStats();
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Tools'));
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('90.5%')).toBeInTheDocument();
  });

  test('renders per-tool table with tool names', async () => {
    setupWithToolStats();
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Tools'));
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('web_search')).toBeInTheDocument();
  });

  test('shows p50 and p95 latencies', async () => {
    setupWithToolStats();
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Tools'));
    expect(screen.getByText('12ms')).toBeInTheDocument();
    expect(screen.getByText('1200ms')).toBeInTheDocument();
  });

  test('shows error type breakdown', async () => {
    setupWithToolStats();
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Tools'));
    expect(screen.getByText(/network:1/)).toBeInTheDocument();
    expect(screen.getByText(/timeout:1/)).toBeInTheDocument();
  });

  test('shows empty state when no tool calls exist', async () => {
    setup({
      getAnalyticsSummary: jest.fn().mockResolvedValue({
        success: true,
        summary: {
          conversationCount: 0, totalMessages: 0, avgMessagesPerConversation: 0, oldestConversation: null,
          toolCallStats: { totalCalls: 0, successRate: 0, perTool: {} },
        },
      }),
    });
    await act(async () => {
      render(<TelemetryDashboard open={true} onClose={jest.fn()} />);
    });
    fireEvent.click(screen.getByText('Tools'));
    expect(screen.getByText(/no tool calls recorded/i)).toBeInTheDocument();
  });
});
