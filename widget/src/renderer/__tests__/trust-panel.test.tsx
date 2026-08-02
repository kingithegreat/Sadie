/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TrustPanel from '../components/TrustPanel';

const getSupervisorStatus = jest.fn();
const getCrmActivity = jest.fn();
const getBatchSummaries = jest.fn();
const onSupervisorStatus = jest.fn();
const onBatchSummary = jest.fn();
const unsubscribe = jest.fn();
const unsubscribeBatch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  onSupervisorStatus.mockReturnValue(unsubscribe);
  onBatchSummary.mockReturnValue(unsubscribeBatch);
  getBatchSummaries.mockResolvedValue({ success: true, summaries: [] });
  (window as any).electron = {
    getSupervisorStatus,
    getCrmActivity,
    getBatchSummaries,
    onSupervisorStatus,
    onBatchSummary,
  };
});

const healthyStatus = {
  success: true,
  status: {
    startedAt: 1,
    stopped: false,
    services: [
      { name: 'ollama', health: 'healthy', required: true, totalRecoveries: 0, lastOkAt: Date.now() },
      { name: 'n8n', health: 'recovering', required: true, totalRecoveries: 2, lastOkAt: Date.now() - 5000 },
      { name: 'qdrant', health: 'down', required: false, totalRecoveries: 0, lastOkAt: null },
    ],
  },
};

const activity = {
  success: true,
  items: [
    {
      id: 42,
      at: '2026-08-02T03:00:00.000Z',
      summary: 'Advanced deal “Website rebuild”: qualified → proposal',
      toolName: 'crm_advance_deal',
      actor: 'sadie',
      changes: [{ field: 'stage', from: 'qualified', to: 'proposal' }],
    },
    {
      id: 41,
      at: '2026-08-02T02:00:00.000Z',
      summary: 'Created company “Bayfair Fitness”',
      toolName: 'crm_create_company',
      actor: 'sadie',
      changes: [],
    },
  ],
};

describe('TrustPanel', () => {
  test('renders nothing when closed and subscribes/unsubscribes with open state', async () => {
    getSupervisorStatus.mockResolvedValue(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    const { rerender, unmount } = render(<TrustPanel open={false} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSupervisorStatus).not.toHaveBeenCalled();

    rerender(<TrustPanel open={true} onClose={() => undefined} />);
    await waitFor(() => expect(onSupervisorStatus).toHaveBeenCalledTimes(1));
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(unsubscribeBatch).toHaveBeenCalled();
  });

  test('shows service health with recovery count and activity summaries', async () => {
    getSupervisorStatus.mockResolvedValue(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    render(<TrustPanel open={true} onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByText(/ollama — healthy/)).toBeTruthy());
    expect(screen.getByText(/n8n — recovering/)).toBeTruthy();
    expect(screen.getByText(/auto-recovered ×2/)).toBeTruthy();
    expect(screen.getByText(/qdrant — down \(optional\)/)).toBeTruthy();
    expect(screen.getByText('Advanced deal “Website rebuild”: qualified → proposal')).toBeTruthy();
    expect(screen.getByText('Created company “Bayfair Fitness”')).toBeTruthy();
  });

  test('expands field-level changes on demand', async () => {
    getSupervisorStatus.mockResolvedValue(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    render(<TrustPanel open={true} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByText('1 field')).toBeTruthy());

    fireEvent.click(screen.getByText('1 field'));
    expect(screen.getByText(/stage: qualified → proposal/)).toBeTruthy();
    fireEvent.click(screen.getByText('Hide'));
    expect(screen.queryByText(/stage: qualified → proposal/)).toBeNull();
  });

  test('supervision-off (null status) and empty activity render honest empty states', async () => {
    getSupervisorStatus.mockResolvedValue({ success: true, status: null });
    getCrmActivity.mockResolvedValue({ success: true, items: [] });
    render(<TrustPanel open={true} onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByText('Supervision is off in this mode')).toBeTruthy());
    expect(screen.getByText(/No CRM activity yet/)).toBeTruthy();
  });

  test('a supervisor push re-pulls the snapshot and updates the strip', async () => {
    getSupervisorStatus.mockResolvedValueOnce(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    render(<TrustPanel open={true} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/n8n — recovering/)).toBeTruthy());

    const updated = JSON.parse(JSON.stringify(healthyStatus));
    updated.status.services[1].health = 'healthy';
    getSupervisorStatus.mockResolvedValueOnce(updated);

    const pushCallback = onSupervisorStatus.mock.calls[0][0];
    pushCallback({ service: 'n8n', from: 'recovering', to: 'healthy', at: Date.now() });

    await waitFor(() => expect(screen.getByText(/n8n — healthy/)).toBeTruthy());
  });

  test('renders batch summaries with blocked marker and expandable per-call detail', async () => {
    getSupervisorStatus.mockResolvedValue(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    getBatchSummaries.mockResolvedValue({
      success: true,
      summaries: [
        {
          kind: 'executed',
          at: '2026-08-02T05:00:00.000Z',
          total: 2,
          succeeded: 1,
          failed: 1,
          totalDurationMs: 200,
          calls: [
            { name: 'read_file', ok: true, durationMs: 120 },
            { name: 'write_file', ok: false, error: 'EACCES', durationMs: 80 },
          ],
        },
        {
          kind: 'blocked',
          at: '2026-08-02T04:00:00.000Z',
          total: 1,
          succeeded: 0,
          failed: 1,
          totalDurationMs: 0,
          calls: [{ name: 'delete_file', ok: false, durationMs: 0, error: 'blocked: missing permissions' }],
          missingPermissions: ['fs_delete'],
        },
      ],
    });
    render(<TrustPanel open={true} onClose={() => undefined} />);

    await waitFor(() =>
      expect(screen.getByText('2 tools ran: 1 ok, 1 failed (write_file) in 200ms')).toBeTruthy()
    );
    expect(screen.getByText(/⛔ Blocked — 1 tool needed: fs_delete/)).toBeTruthy();

    fireEvent.click(screen.getAllByText('Detail')[0]);
    expect(screen.getByText(/✗ write_file · 80ms — EACCES/)).toBeTruthy();
  });

  test('a live batch push prepends to the list', async () => {
    getSupervisorStatus.mockResolvedValue(healthyStatus);
    getCrmActivity.mockResolvedValue(activity);
    render(<TrustPanel open={true} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByText('No tool batches this session.')).toBeTruthy());

    const pushCallback = onBatchSummary.mock.calls[0][0];
    pushCallback({
      kind: 'executed',
      at: '2026-08-02T06:00:00.000Z',
      total: 1,
      succeeded: 1,
      failed: 0,
      totalDurationMs: 1500,
      calls: [{ name: 'read_file', ok: true, durationMs: 1500 }],
    });

    await waitFor(() => expect(screen.getByText('1 tool ran, all ok in 1.5s')).toBeTruthy());
  });
});
