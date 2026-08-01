/**
 * SADIE / HomeBot — CRM core types (Phase 1).
 * ---------------------------------------------------------------------------
 * The CRM is the layer that turns SADIE from "a chatbot" into "a worker":
 * companies, contacts, deals, activities, notes, tasks — all local, all in one
 * SQLite file, every mutation audited.
 *
 * This module is pure types: no electron, no sqlite, no side effects, so it is
 * safe to import from anywhere (root registry, widget main process, tests).
 */

/** Activity types — the spine of the CRM. Every touchpoint is an activity. */
export type ActivityType =
  | 'email'
  | 'call'
  | 'meeting'
  | 'note'
  | 'task'
  | 'system';

/** Direction of a communication activity (emails/calls). */
export type ActivityDirection = 'inbound' | 'outbound' | 'internal';

/**
 * Default deal pipeline. Owners can rename stage labels (stored in settings),
 * but stage KEYS are stable so tool calls and analytics never break when a
 * label changes. 'won' and 'lost' are terminal.
 */
export const DEFAULT_STAGES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'lead', label: 'Lead' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

export const TERMINAL_STAGES: ReadonlyArray<string> = ['won', 'lost'];

export interface Company {
  id: number;
  name: string;
  domain: string | null;
  phone: string | null;
  address: string | null;
  industry: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: number;
  companyId: number | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp of the most recent linked activity (denormalized). */
  lastActivityAt: string | null;
}

export interface Deal {
  id: number;
  companyId: number | null;
  contactId: number | null;
  title: string;
  /** Stage KEY (stable), not label. */
  stage: string;
  /** Value in whole cents to dodge floating point. Null = unknown. */
  valueCents: number | null;
  currency: string;
  expectedCloseDate: string | null; // ISO date (YYYY-MM-DD)
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp of the most recent linked activity (denormalized). */
  lastActivityAt: string | null;
  closedAt: string | null;
}

export interface Activity {
  id: number;
  type: ActivityType;
  direction: ActivityDirection | null;
  subject: string;
  body: string | null;
  contactId: number | null;
  companyId: number | null;
  dealId: number | null;
  /** Who/what performed it: 'sadie' for autonomous actions, 'owner' for user. */
  actor: string;
  occurredAt: string;
  createdAt: string;
}

export interface Note {
  id: number;
  body: string;
  contactId: number | null;
  companyId: number | null;
  dealId: number | null;
  actor: string;
  createdAt: string;
}

export interface Task {
  id: number;
  title: string;
  details: string | null;
  dueDate: string | null; // ISO date (YYYY-MM-DD)
  contactId: number | null;
  companyId: number | null;
  dealId: number | null;
  completedAt: string | null;
  actor: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Append-only audit row. `before`/`after` are JSON snapshots so the trust-layer
 * UI (Phase 2) can render diffs without re-deriving anything.
 */
export interface AuditEntry {
  id: number;
  toolName: string;
  entityType: 'company' | 'contact' | 'deal' | 'activity' | 'note' | 'task' | 'settings' | 'export';
  entityId: number | null;
  action: 'create' | 'update' | 'delete' | 'complete' | 'advance' | 'export';
  actor: string;
  before: string | null;
  after: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Input shapes (what tool handlers pass in — no ids/timestamps)
// ---------------------------------------------------------------------------

export interface CompanyInput {
  name: string;
  domain?: string | null;
  phone?: string | null;
  address?: string | null;
  industry?: string | null;
  notes?: string | null;
}

export interface ContactInput {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  notes?: string | null;
  companyId?: number | null;
  /** Convenience: resolve/create company by name instead of id. */
  companyName?: string | null;
}

export interface DealInput {
  title: string;
  stage?: string;
  valueCents?: number | null;
  currency?: string;
  expectedCloseDate?: string | null;
  notes?: string | null;
  companyId?: number | null;
  contactId?: number | null;
}

export interface ActivityInput {
  type: ActivityType;
  subject: string;
  body?: string | null;
  direction?: ActivityDirection | null;
  contactId?: number | null;
  companyId?: number | null;
  dealId?: number | null;
  actor?: string;
  occurredAt?: string;
}

export interface TaskInput {
  title: string;
  details?: string | null;
  dueDate?: string | null;
  contactId?: number | null;
  companyId?: number | null;
  dealId?: number | null;
  actor?: string;
}

/** Result of matching an inbound email to the CRM. */
export interface EmailMatchResult {
  contact: Contact;
  company: Company | null;
  created: boolean;
  activityId: number;
}

/** A stale deal plus context for the daily brief / follow-up drafting. */
export interface StaleDeal {
  deal: Deal;
  contact: Contact | null;
  company: Company | null;
  daysQuiet: number;
}

export interface DailyBrief {
  generatedAt: string;
  staleDeals: StaleDeal[];
  tasksOverdue: Task[];
  tasksDueToday: Task[];
  recentActivities: Activity[];
  openDealCount: number;
  openPipelineValueCents: number;
}

/** Result of a full CRM data export (CSV per table + one combined JSON). */
export interface CrmExportResult {
  /** Absolute directory the export was written into. */
  directory: string;
  /** Files written, relative to `directory`. */
  files: string[];
  /** Row counts per exported table. */
  counts: Record<string, number>;
  exportedAt: string;
}
