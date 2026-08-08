/**
 * trust-ipc tests — handlers registered on a mocked ipcMain, CRM store mocked
 * so no native module loads (the real store is covered by crm-tools tests).
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();

jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
}));

const getAuditLog = jest.fn();
const dailyBrief = jest.fn();
jest.mock('../tools/crm', () => ({
  getCrmStore: () => ({ getAuditLog, dailyBrief }),
}));

const getRecentBatchSummaries = jest.fn();
jest.mock('../tools/index', () => ({
  getRecentBatchSummaries: () => getRecentBatchSummaries(),
}));

import { registerTrustIpc, TRUST_CHANNELS } from '../trust-ipc';
import { SupervisorStatus } from '../../../../src/supervisor/types';

function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return Promise.resolve(fn({}, ...args));
}

const auditRow = {
  id: 42,
  toolName: 'crm_create_company',
  entityType: 'company' as const,
  entityId: 3,
  action: 'create' as const,
  actor: 'homebot',
  before: null,
  after: JSON.stringify({ name: 'Bayfair Fitness' }),
  createdAt: '2026-08-02T03:00:00.000Z',
};

describe('registerTrustIpc', () => {
  beforeEach(() => {
    handlers.clear();
    getAuditLog.mockReset();
    dailyBrief.mockReset();
    getRecentBatchSummaries.mockReset();
  });

  test('crm dashboard handler summarizes the daily brief', async () => {
    dailyBrief.mockReturnValue({
      generatedAt: '2026-08-03T00:00:00Z',
      staleDeals: [{}, {}],
      tasksOverdue: [{}],
      tasksDueToday: [{}, {}, {}],
      recentActivities: [],
      openDealCount: 4,
      openPipelineValueCents: 450000,
    });
    registerTrustIpc(() => null);
    const r = await invoke(TRUST_CHANNELS.GET_CRM_DASHBOARD);
    expect(r.success).toBe(true);
    expect(r.summary).toEqual(expect.objectContaining({
      openDealCount: 4,
      pipelineValueFormatted: '$4,500',
      staleDealCount: 2,
      tasksDueTodayCount: 3,
      tasksOverdueCount: 1,
      isEmpty: false,
    }));
  });

  test('crm dashboard handler degrades to success:false when the store throws', async () => {
    dailyBrief.mockImplementation(() => { throw new Error('db locked'); });
    registerTrustIpc(() => null);
    const r = await invoke(TRUST_CHANNELS.GET_CRM_DASHBOARD);
    expect(r.success).toBe(false);
    expect(r.summary).toBeNull();
    expect(r.error).toContain('db locked');
  });

  test('supervisor status handler returns the live status from the getter', async () => {
    const status: SupervisorStatus = { startedAt: 1, stopped: false, services: [] };
    registerTrustIpc(() => status);
    const r = await invoke(TRUST_CHANNELS.GET_SUPERVISOR_STATUS);
    expect(r).toEqual({ success: true, status });
  });

  test('supervisor status handler returns null when supervision is off (E2E)', async () => {
    registerTrustIpc(() => null);
    const r = await invoke(TRUST_CHANNELS.GET_SUPERVISOR_STATUS);
    expect(r).toEqual({ success: true, status: null });
  });

  test('a throwing status getter degrades to success:false, never throws across IPC', async () => {
    registerTrustIpc(() => {
      throw new Error('handle gone');
    });
    const r = await invoke(TRUST_CHANNELS.GET_SUPERVISOR_STATUS);
    expect(r.success).toBe(false);
    expect(r.status).toBeNull();
    expect(r.error).toContain('handle gone');
  });

  test('crm activity handler summarizes rows and applies the default limit', async () => {
    getAuditLog.mockReturnValue([auditRow]);
    registerTrustIpc(() => null);
    const r = await invoke(TRUST_CHANNELS.GET_CRM_ACTIVITY);
    expect(getAuditLog).toHaveBeenCalledWith(50);
    expect(r.success).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].summary).toBe('Created company “Bayfair Fitness”');
  });

  test('limit is clamped to [1, 200] and non-numbers fall back to the default', async () => {
    getAuditLog.mockReturnValue([]);
    registerTrustIpc(() => null);
    await invoke(TRUST_CHANNELS.GET_CRM_ACTIVITY, 9999);
    expect(getAuditLog).toHaveBeenLastCalledWith(200);
    await invoke(TRUST_CHANNELS.GET_CRM_ACTIVITY, -5);
    expect(getAuditLog).toHaveBeenLastCalledWith(1);
    await invoke(TRUST_CHANNELS.GET_CRM_ACTIVITY, 'lots');
    expect(getAuditLog).toHaveBeenLastCalledWith(50);
  });

  test('a failing store degrades to success:false with empty items', async () => {
    getAuditLog.mockImplementation(() => {
      throw new Error('db locked');
    });
    registerTrustIpc(() => null);
    const r = await invoke(TRUST_CHANNELS.GET_CRM_ACTIVITY);
    expect(r).toEqual({ success: false, items: [], error: expect.stringContaining('db locked') });
  });

  test('batch summaries handler returns the ring buffer', async () => {
    const summary = { kind: 'executed', at: 'x', total: 1, succeeded: 1, failed: 0, totalDurationMs: 5, calls: [] };
    getRecentBatchSummaries.mockReturnValue([summary]);
    registerTrustIpc(() => null);
    const r = await invoke(TRUST_CHANNELS.GET_BATCH_SUMMARIES);
    expect(r).toEqual({ success: true, summaries: [summary] });
  });

  test('a failing summaries source degrades to success:false with empty summaries', async () => {
    getRecentBatchSummaries.mockImplementation(() => {
      throw new Error('registry unavailable');
    });
    registerTrustIpc(() => null);
    const r = await invoke(TRUST_CHANNELS.GET_BATCH_SUMMARIES);
    expect(r).toEqual({ success: false, summaries: [], error: expect.stringContaining('registry unavailable') });
  });

  test('re-registration replaces handlers instead of stacking', async () => {
    registerTrustIpc(() => null);
    const status: SupervisorStatus = { startedAt: 2, stopped: false, services: [] };
    registerTrustIpc(() => status);
    const r = await invoke(TRUST_CHANNELS.GET_SUPERVISOR_STATUS);
    expect(r.status).toEqual(status);
  });
});
