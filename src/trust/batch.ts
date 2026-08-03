/**
 * Trust layer (Phase 2) — batch execution transparency.
 *
 * Pure shaping for the two remaining issue #6 items:
 *   1. Dry-run / preview: "what WOULD this batch do" — tools, argument
 *      summaries, permission state — without executing anything.
 *   2. Execution summaries: "what DID that batch do" — per-tool outcome and
 *      duration, plus one human line for the Trust panel.
 *
 * Same placement rationale as trust/activity: dependency-free in root src so
 * the required CI gate protects it. The Electron side gathers registry and
 * permission facts and hands them here for shaping.
 */

import { renderValue } from './activity';

// ── Preview (dry-run) ───────────────────────────────────────────────────────

/** Facts the widget gathers per call before shaping. */
export interface BatchCallFacts {
  name: string;
  args: Record<string, unknown>;
  /** Tool exists in the registry. */
  known: boolean;
  requiresConfirmation: boolean;
  requiredPermissions: string[];
  /** All permission checks for this call currently pass. */
  permissionGranted: boolean;
}

export interface BatchCallPreview {
  name: string;
  known: boolean;
  argsSummary: string;
  requiresConfirmation: boolean;
  requiredPermissions: string[];
  permission: 'granted' | 'needs_confirmation' | 'unknown_tool';
}

export interface BatchPreview {
  kind: 'preview';
  total: number;
  calls: BatchCallPreview[];
  unknownTools: string[];
  missingPermissions: string[];
  /** True when every tool is known and every permission is already granted. */
  wouldExecute: boolean;
}

const ARGS_SUMMARY_MAX_KEYS = 3;

/** `path: /tmp/report.txt, append: true (+2 more)` — values via renderValue. */
export function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args ?? {});
  if (keys.length === 0) return 'no arguments';
  const shown = keys.slice(0, ARGS_SUMMARY_MAX_KEYS).map((k) => `${k}: ${renderValue(args[k])}`);
  const more = keys.length > ARGS_SUMMARY_MAX_KEYS ? ` (+${keys.length - ARGS_SUMMARY_MAX_KEYS} more)` : '';
  return shown.join(', ') + more;
}

export function buildBatchPreview(facts: BatchCallFacts[]): BatchPreview {
  const calls: BatchCallPreview[] = facts.map((f) => ({
    name: f.name,
    known: f.known,
    argsSummary: summarizeArgs(f.args),
    requiresConfirmation: f.requiresConfirmation,
    requiredPermissions: f.requiredPermissions,
    permission: !f.known ? 'unknown_tool' : f.permissionGranted ? 'granted' : 'needs_confirmation',
  }));
  const unknownTools = [...new Set(calls.filter((c) => !c.known).map((c) => c.name))];
  const missingPermissions = [
    ...new Set(
      facts
        .filter((f) => f.known && !f.permissionGranted)
        .flatMap((f) => (f.requiredPermissions.length > 0 ? f.requiredPermissions : [f.name]))
    ),
  ];
  return {
    kind: 'preview',
    total: calls.length,
    calls,
    unknownTools,
    missingPermissions,
    wouldExecute: unknownTools.length === 0 && missingPermissions.length === 0,
  };
}

// ── Execution summaries ─────────────────────────────────────────────────────

export interface BatchCallOutcome {
  name: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface BatchSummary {
  kind: 'executed' | 'blocked';
  at: string;
  total: number;
  succeeded: number;
  failed: number;
  totalDurationMs: number;
  calls: BatchCallOutcome[];
  /** Present on kind 'blocked'. */
  missingPermissions?: string[];
}

export function buildBatchSummary(outcomes: BatchCallOutcome[], at: string = new Date().toISOString()): BatchSummary {
  const succeeded = outcomes.filter((o) => o.ok).length;
  return {
    kind: 'executed',
    at,
    total: outcomes.length,
    succeeded,
    failed: outcomes.length - succeeded,
    totalDurationMs: outcomes.reduce((sum, o) => sum + Math.max(0, o.durationMs), 0),
    calls: outcomes,
  };
}

export function buildBlockedSummary(
  callNames: string[],
  missingPermissions: string[],
  at: string = new Date().toISOString()
): BatchSummary {
  return {
    kind: 'blocked',
    at,
    total: callNames.length,
    succeeded: 0,
    failed: callNames.length,
    totalDurationMs: 0,
    calls: callNames.map((name) => ({ name, ok: false, durationMs: 0, error: 'blocked: missing permissions' })),
    missingPermissions: [...new Set(missingPermissions)],
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** One human line for a summary row in the Trust panel. */
export function batchSummaryLine(s: BatchSummary): string {
  const tools = `${s.total} tool${s.total === 1 ? '' : 's'}`;
  if (s.kind === 'blocked') {
    const needs = (s.missingPermissions ?? []).join(', ') || 'permissions';
    return `Blocked — ${tools} needed: ${needs}`;
  }
  if (s.failed === 0) return `${tools} ran, all ok in ${formatDuration(s.totalDurationMs)}`;
  const firstFail = s.calls.find((c) => !c.ok);
  const failNote = firstFail ? ` (${firstFail.name})` : '';
  return `${tools} ran: ${s.succeeded} ok, ${s.failed} failed${failNote} in ${formatDuration(s.totalDurationMs)}`;
}

// ── Chat-facing preview rendering (issue #6: dry-run / preview mode) ────────

/**
 * Render a BatchPreview as the chat text streamed BEFORE a batch executes,
 * when the "Preview tool batches" setting is on. previewBatch()/dryRun have
 * existed in the executor since the batch workstream but nothing ever called
 * them — this formatter plus the router wiring makes the capability real.
 *
 * One line per call using the same argsSummary vocabulary the Trust panel
 * uses, with a warning suffix for tools that are unknown or still need a
 * permission (those will trigger the normal permission flow next).
 */
export function formatBatchPreviewForChat(preview: BatchPreview): string {
  const lines: string[] = [];
  const plural = preview.total === 1 ? 'action' : 'actions';
  lines.push(`🔍 About to run ${preview.total} ${plural}:`);
  preview.calls.forEach((c, i) => {
    let suffix = '';
    if (c.permission === 'unknown_tool') suffix = ' — ⚠️ unknown tool, will be skipped';
    else if (c.permission === 'needs_confirmation') suffix = ' — 🔒 will ask permission first';
    lines.push(`  ${i + 1}. ${c.name} (${c.argsSummary})${suffix}`);
  });
  return `\n${lines.join('\n')}\n\n`;
}
