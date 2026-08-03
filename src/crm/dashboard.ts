/**
 * CRM dashboard summary — pure shaping of a DailyBrief into the numbers the
 * Dashboard landing page renders (pipeline card, stale-deals card, tasks
 * card). Until now the CRM had zero visual presence on the landing page —
 * it was chat-tools-only, with the Trust panel's activity feed the only
 * render surface.
 *
 * Pure and dependency-free on purpose: lives in root src so the required CI
 * gate (tsc + jest) protects it — same placement as the CRM store itself,
 * the supervisor, and the trust summarizers. The IPC adapter and renderer
 * only map over this.
 */

import { DailyBrief } from './types';

export interface CrmDashboardSummary {
  /** Count of deals not in a terminal stage. */
  openDealCount: number;
  /** Total open pipeline value in cents (integer, as stored). */
  openPipelineValueCents: number;
  /** Human money string, e.g. "$4,500" (NZD, whole dollars). */
  pipelineValueFormatted: string;
  /** Deals with no activity for the stale window. */
  staleDealCount: number;
  tasksDueTodayCount: number;
  tasksOverdueCount: number;
  /** True when the CRM has literally nothing to show yet. */
  isEmpty: boolean;
}

/**
 * Format integer cents as a whole-dollar money string with thousands
 * separators. Deal values are stored in cents (NZD default); sub-dollar
 * precision is noise on a glanceable card, so cents round to the nearest
 * dollar.
 */
export function formatCentsShort(cents: number): string {
  const n = Number.isFinite(cents) ? Math.round(cents / 100) : 0;
  return `$${n.toLocaleString('en-NZ')}`;
}

export function summarizeCrmDashboard(brief: DailyBrief): CrmDashboardSummary {
  const openDealCount = Number.isFinite(brief.openDealCount) ? brief.openDealCount : 0;
  const openPipelineValueCents = Number.isFinite(brief.openPipelineValueCents)
    ? brief.openPipelineValueCents
    : 0;
  const staleDealCount = Array.isArray(brief.staleDeals) ? brief.staleDeals.length : 0;
  const tasksDueTodayCount = Array.isArray(brief.tasksDueToday) ? brief.tasksDueToday.length : 0;
  const tasksOverdueCount = Array.isArray(brief.tasksOverdue) ? brief.tasksOverdue.length : 0;
  const recentCount = Array.isArray(brief.recentActivities) ? brief.recentActivities.length : 0;

  return {
    openDealCount,
    openPipelineValueCents,
    pipelineValueFormatted: formatCentsShort(openPipelineValueCents),
    staleDealCount,
    tasksDueTodayCount,
    tasksOverdueCount,
    isEmpty:
      openDealCount === 0 &&
      staleDealCount === 0 &&
      tasksDueTodayCount === 0 &&
      tasksOverdueCount === 0 &&
      recentCount === 0,
  };
}
