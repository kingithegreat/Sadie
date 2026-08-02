/**
 * Trust layer (Phase 2) — activity summarization.
 *
 * Turns raw CRM audit_log rows (append-only, before/after JSON snapshots —
 * written by every CrmStore mutation since Phase 1) into human-readable
 * activity items for the Trust UI: "what did SADIE change, when, and exactly
 * which fields."
 *
 * Pure and dependency-free on purpose: lives in root src so the required CI
 * gate (tsc + jest) protects it, same placement as the CRM core and the
 * supervisor. The Electron side only maps over these functions.
 */

import { AuditEntry } from '../crm/types';

export interface TrustFieldChange {
  field: string;
  from: string;
  to: string;
}

export interface TrustActivityItem {
  id: number;
  at: string;
  source: 'crm';
  actor: string;
  toolName: string;
  entityType: AuditEntry['entityType'];
  entityId: number | null;
  action: AuditEntry['action'];
  /** One human line, e.g. `Updated deal “Website rebuild”: stage qualified → proposal`. */
  summary: string;
  /** Field-level diff for updates (empty for create/delete/export). */
  changes: TrustFieldChange[];
}

/** Fields that change on every write and carry no user meaning in a diff. */
const NOISE_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

const MAX_VALUE_LEN = 60;

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Render one field value for display: scalars verbatim (truncated), structures abbreviated. */
export function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
  else if (Array.isArray(v)) s = `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  else s = '{…}';
  return s.length > MAX_VALUE_LEN ? `${s.slice(0, MAX_VALUE_LEN - 1)}…` : s;
}

/**
 * Field-level diff between two audit snapshots. Noise fields are skipped;
 * unchanged fields are skipped; malformed/absent JSON yields an empty diff
 * rather than throwing.
 */
export function diffSnapshots(beforeJson: string | null, afterJson: string | null): TrustFieldChange[] {
  const before = parseJson(beforeJson);
  const after = parseJson(afterJson);
  if (!before || !after) return [];
  const changes: TrustFieldChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (NOISE_FIELDS.has(key)) continue;
    const from = renderValue(before[key]);
    const to = renderValue(after[key]);
    if (from !== to) changes.push({ field: key, from, to });
  }
  return changes;
}

/** Best display name for the entity from a snapshot: name → title → subject → #id. */
function entityLabel(entry: AuditEntry): string {
  const snap = parseJson(entry.after) ?? parseJson(entry.before);
  if (snap) {
    for (const key of ['name', 'title', 'subject']) {
      const v = snap[key];
      if (typeof v === 'string' && v.trim() !== '') return `“${renderValue(v.trim())}”`;
    }
  }
  return entry.entityId !== null ? `#${entry.entityId}` : '';
}

function joinLabel(entityType: string, label: string): string {
  return label ? `${entityType} ${label}` : entityType;
}

/** One raw audit row → one renderable activity item. Never throws. */
export function summarizeAuditEntry(entry: AuditEntry): TrustActivityItem {
  const label = entityLabel(entry);
  const subject = joinLabel(entry.entityType, label);
  const changes = entry.action === 'update' || entry.action === 'advance' ? diffSnapshots(entry.before, entry.after) : [];

  let summary: string;
  switch (entry.action) {
    case 'create':
      summary = `Created ${subject}`;
      break;
    case 'delete':
      summary = `Deleted ${subject}`;
      break;
    case 'complete':
      summary = `Completed ${subject}`;
      break;
    case 'export':
      summary = 'Exported CRM data';
      break;
    case 'advance': {
      const stage = changes.find((c) => c.field === 'stage' || c.field === 'stageKey');
      summary = stage
        ? `Advanced ${subject}: ${stage.from} → ${stage.to}`
        : `Advanced ${subject}`;
      break;
    }
    case 'update': {
      if (changes.length === 0) {
        summary = `Updated ${subject}`;
      } else {
        const first = changes[0];
        const more = changes.length > 1 ? ` (+${changes.length - 1} more)` : '';
        summary = `Updated ${subject}: ${first.field} ${first.from} → ${first.to}${more}`;
      }
      break;
    }
    default:
      summary = `${String(entry.action)} ${subject}`.trim();
  }

  return {
    id: entry.id,
    at: entry.createdAt,
    source: 'crm',
    actor: entry.actor,
    toolName: entry.toolName,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    summary,
    changes,
  };
}

/** Map a page of audit rows (newest-first, as CrmStore returns them). */
export function summarizeAuditLog(entries: AuditEntry[]): TrustActivityItem[] {
  return entries.map(summarizeAuditEntry);
}
