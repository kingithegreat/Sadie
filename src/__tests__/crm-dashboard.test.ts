import { summarizeCrmDashboard, formatCentsShort } from '../crm/dashboard';
import { DailyBrief } from '../crm/types';

const emptyBrief: DailyBrief = {
  generatedAt: '2026-08-03T00:00:00Z',
  staleDeals: [],
  tasksOverdue: [],
  tasksDueToday: [],
  recentActivities: [],
  openDealCount: 0,
  openPipelineValueCents: 0,
};

describe('formatCentsShort', () => {
  it('rounds cents to whole dollars with separators', () => {
    expect(formatCentsShort(450000)).toBe('$4,500');
    expect(formatCentsShort(1_234_567)).toBe('$12,346');
    expect(formatCentsShort(0)).toBe('$0');
  });
  it('never throws on garbage', () => {
    expect(formatCentsShort(NaN)).toBe('$0');
    expect(formatCentsShort(Infinity)).toBe('$0');
  });
});

describe('summarizeCrmDashboard', () => {
  it('flags a truly empty CRM', () => {
    const s = summarizeCrmDashboard(emptyBrief);
    expect(s.isEmpty).toBe(true);
    expect(s.pipelineValueFormatted).toBe('$0');
  });
  it('summarizes a populated brief', () => {
    const s = summarizeCrmDashboard({
      ...emptyBrief,
      openDealCount: 3,
      openPipelineValueCents: 985000,
      staleDeals: [{} as any, {} as any],
      tasksDueToday: [{} as any],
      tasksOverdue: [{} as any, {} as any, {} as any],
    });
    expect(s.isEmpty).toBe(false);
    expect(s.openDealCount).toBe(3);
    expect(s.pipelineValueFormatted).toBe('$9,850');
    expect(s.staleDealCount).toBe(2);
    expect(s.tasksDueTodayCount).toBe(1);
    expect(s.tasksOverdueCount).toBe(3);
  });
  it('recent activity alone means not-empty (CRM is in use)', () => {
    const s = summarizeCrmDashboard({ ...emptyBrief, recentActivities: [{} as any] });
    expect(s.isEmpty).toBe(false);
  });
  it('degrades garbage fields to zeros instead of throwing', () => {
    const s = summarizeCrmDashboard({
      ...emptyBrief,
      openDealCount: NaN,
      openPipelineValueCents: undefined as any,
      staleDeals: null as any,
      tasksDueToday: undefined as any,
    });
    expect(s.openDealCount).toBe(0);
    expect(s.pipelineValueFormatted).toBe('$0');
    expect(s.isEmpty).toBe(true);
  });
});
