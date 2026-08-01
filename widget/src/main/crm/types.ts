/**
 * HomeBot CRM — Type Definitions
 *
 * The CRM is a local-first SQLite store (better-sqlite3, WAL mode, single
 * file). Activities are the spine: every email, call, meeting and note is an
 * activity row linked to a contact / company / deal, and every write is also
 * recorded in an append-only, hash-chained audit log.
 */

export type DealStatus = 'open' | 'won' | 'lost';

export type ActivityType =
  | 'email'
  | 'call'
  | 'meeting'
  | 'note'
  | 'task'
  | 'system';

export type ActivityDirection = 'inbound' | 'outbound' | 'internal';

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  company_id: string | null;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  name: string;
  /** Deal value in cents to avoid floating point money bugs. */
  value_cents: number;
  currency: string;
  stage: string;
  status: DealStatus;
  expected_close: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  direction: ActivityDirection;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  subject: string;
  body: string | null;
  /** ISO timestamp of when the activity actually happened. */
  occurred_at: string;
  /** Where this came from: 'user', 'sadie', 'email-sync', 'calendar-sync'… */
  source: string;
  created_at: string;
}

export interface Note {
  id: string;
  entity_type: 'company' | 'contact' | 'deal';
  entity_id: string;
  body: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  due_at: string | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  done_at: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  payload: string;
  prev_hash: string;
  entry_hash: string;
}

export interface StaleDeal extends Deal {
  last_activity_at: string;
  days_quiet: number;
  contact_name: string | null;
  company_name: string | null;
}

export interface DailyBrief {
  generated_at: string;
  stale_deals: StaleDeal[];
  tasks_overdue: Task[];
  tasks_due_today: Task[];
  closing_soon: Deal[];
  pipeline: {
    open_deals: number;
    open_value_cents: number;
    won_this_month: number;
    won_value_cents_this_month: number;
  };
  counts: { companies: number; contacts: number; deals: number };
}
