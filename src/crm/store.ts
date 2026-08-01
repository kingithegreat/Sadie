/**
 * SADIE / HomeBot — CrmStore (Phase 1).
 * ---------------------------------------------------------------------------
 * SQLite-backed CRM data layer. Design rules:
 *
 *  1. ONE file, WAL mode → trivial backup/export, no server.
 *  2. Every mutation writes an audit_log row (append-only) with before/after
 *     JSON snapshots. The Phase 2 trust UI renders straight from this table.
 *  3. Activities are the spine: communications and SADIE's own actions all
 *     land as activity rows, and they drive `last_activity_at` denorms which
 *     power find_stale_deals / daily_brief.
 *  4. No electron imports here — the widget adapter supplies the db path.
 *     This keeps the store testable under plain jest in the gating CI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MIGRATIONS } from './schema';
import {
  Activity,
  ActivityInput,
  AuditEntry,
  Company,
  CompanyInput,
  Contact,
  ContactInput,
  DailyBrief,
  Deal,
  DealInput,
  DEFAULT_STAGES,
  EmailMatchResult,
  Note,
  StaleDeal,
  Task,
  TaskInput,
  TERMINAL_STAGES,
} from './types';

type Db = any; // better-sqlite3 Database — typed loosely to avoid a hard @types coupling

/**
 * Lazy-load better-sqlite3 at construction time, NOT module import time.
 * Rationale: in the widget, `npm ci` triggers electron-builder's
 * install-app-deps which rebuilds the native binding against Electron's ABI.
 * Any plain-node process (e.g. the jest permissions smoke test) that merely
 * IMPORTS the tool registry would crash on an ABI mismatch if this require
 * lived at top level. Deferring it means importing/registering CRM tools is
 * always safe; only actually opening the store needs a compatible binding.
 */
function loadDatabaseDriver(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('better-sqlite3');
  } catch (err: any) {
    throw new Error(
      `CRM storage engine failed to load (better-sqlite3): ${err?.message || err}. ` +
        'If running under plain node after an Electron-targeted install, rebuild ' +
        'the binding for your node version (npm rebuild better-sqlite3).'
    );
  }
}

const nowIso = (): string => new Date().toISOString();
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Escape LIKE wildcards in user-supplied search text. */
function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email || '').trim().toLowerCase();
  return e.length > 0 ? e : null;
}

// ---------------------------------------------------------------------------
// Row → entity mappers (snake_case DB → camelCase TS)
// ---------------------------------------------------------------------------

function mapCompany(r: any): Company {
  return {
    id: r.id,
    name: r.name,
    domain: r.domain ?? null,
    phone: r.phone ?? null,
    address: r.address ?? null,
    industry: r.industry ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapContact(r: any): Contact {
  return {
    id: r.id,
    companyId: r.company_id ?? null,
    firstName: r.first_name,
    lastName: r.last_name ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    title: r.title ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastActivityAt: r.last_activity_at ?? null,
  };
}

function mapDeal(r: any): Deal {
  return {
    id: r.id,
    companyId: r.company_id ?? null,
    contactId: r.contact_id ?? null,
    title: r.title,
    stage: r.stage,
    valueCents: r.value_cents ?? null,
    currency: r.currency,
    expectedCloseDate: r.expected_close_date ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastActivityAt: r.last_activity_at ?? null,
    closedAt: r.closed_at ?? null,
  };
}

function mapActivity(r: any): Activity {
  return {
    id: r.id,
    type: r.type,
    direction: r.direction ?? null,
    subject: r.subject,
    body: r.body ?? null,
    contactId: r.contact_id ?? null,
    companyId: r.company_id ?? null,
    dealId: r.deal_id ?? null,
    actor: r.actor,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };
}

function mapNote(r: any): Note {
  return {
    id: r.id,
    body: r.body,
    contactId: r.contact_id ?? null,
    companyId: r.company_id ?? null,
    dealId: r.deal_id ?? null,
    actor: r.actor,
    createdAt: r.created_at,
  };
}

function mapTask(r: any): Task {
  return {
    id: r.id,
    title: r.title,
    details: r.details ?? null,
    dueDate: r.due_date ?? null,
    contactId: r.contact_id ?? null,
    companyId: r.company_id ?? null,
    dealId: r.deal_id ?? null,
    completedAt: r.completed_at ?? null,
    actor: r.actor,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapAudit(r: any): AuditEntry {
  return {
    id: r.id,
    toolName: r.tool_name,
    entityType: r.entity_type,
    entityId: r.entity_id ?? null,
    action: r.action,
    actor: r.actor,
    before: r.before_json ?? null,
    after: r.after_json ?? null,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface CrmStoreOptions {
  /** Absolute path to the sqlite file, or ':memory:' for tests. */
  dbPath: string;
}

export class CrmStore {
  private readonly db: Db;

  constructor(options: CrmStoreOptions) {
    if (options.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(options.dbPath), { recursive: true });
    }
    const Database = loadDatabaseDriver();
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  /** Absolute file path of the database (for backup/export tooling). */
  get databasePath(): string {
    return this.db.name;
  }

  private migrate(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`
    );
    const applied = new Set<string>(
      this.db
        .prepare('SELECT id FROM schema_migrations')
        .all()
        .map((r: any) => r.id as string)
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      const run = this.db.transaction(() => {
        for (const stmt of migration.statements) this.db.exec(stmt);
        this.db
          .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
          .run(migration.id, nowIso());
      });
      run();
    }
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  private audit(
    toolName: string,
    entityType: AuditEntry['entityType'],
    entityId: number | null,
    action: AuditEntry['action'],
    actor: string,
    before: unknown | null,
    after: unknown | null
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (tool_name, entity_type, entity_id, action, actor, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        toolName,
        entityType,
        entityId,
        action,
        actor,
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
        nowIso()
      );
  }

  getAuditLog(limit = 100, entityType?: string, entityId?: number): AuditEntry[] {
    const cap = Math.min(Math.max(1, limit), 1000);
    if (entityType && entityId != null) {
      return this.db
        .prepare(
          'SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?'
        )
        .all(entityType, entityId, cap)
        .map(mapAudit);
    }
    return this.db
      .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(cap)
      .map(mapAudit);
  }

  // -------------------------------------------------------------------------
  // Stage settings (owner-renamable labels over stable keys)
  // -------------------------------------------------------------------------

  getStages(): Array<{ key: string; label: string }> {
    const row = this.db
      .prepare('SELECT value FROM crm_settings WHERE key = ?')
      .get('deal_stages');
    if (!row) return DEFAULT_STAGES.map((s) => ({ ...s }));
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed) && parsed.every((s) => s && s.key && s.label)) {
        return parsed;
      }
    } catch {
      /* fall through to defaults */
    }
    return DEFAULT_STAGES.map((s) => ({ ...s }));
  }

  renameStage(stageKey: string, newLabel: string, actor = 'owner'): Array<{ key: string; label: string }> {
    const stages = this.getStages();
    const target = stages.find((s) => s.key === stageKey);
    if (!target) {
      throw new Error(
        `Unknown stage key '${stageKey}'. Valid keys: ${stages.map((s) => s.key).join(', ')}`
      );
    }
    const before = { key: target.key, label: target.label };
    target.label = newLabel;
    this.db
      .prepare(
        `INSERT INTO crm_settings (key, value, updated_at) VALUES ('deal_stages', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(stages), nowIso());
    this.audit('crm_rename_stage', 'settings', null, 'update', actor, before, {
      key: stageKey,
      label: newLabel,
    });
    return stages;
  }

  private assertStageKey(stage: string): void {
    const keys = this.getStages().map((s) => s.key);
    if (!keys.includes(stage)) {
      throw new Error(`Unknown stage '${stage}'. Valid stages: ${keys.join(', ')}`);
    }
  }

  // -------------------------------------------------------------------------
  // Companies
  // -------------------------------------------------------------------------

  createCompany(input: CompanyInput, actor = 'sadie'): Company {
    const name = input.name.trim();
    if (!name) throw new Error('Company name is required');
    const ts = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO companies (name, domain, phone, address, industry, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        input.domain?.trim() || null,
        input.phone?.trim() || null,
        input.address?.trim() || null,
        input.industry?.trim() || null,
        input.notes?.trim() || null,
        ts,
        ts
      );
    const company = this.getCompany(Number(info.lastInsertRowid))!;
    this.audit('crm_create_company', 'company', company.id, 'create', actor, null, company);
    return company;
  }

  getCompany(id: number): Company | null {
    const row = this.db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
    return row ? mapCompany(row) : null;
  }

  updateCompany(id: number, patch: Partial<CompanyInput>, actor = 'sadie'): Company {
    const before = this.getCompany(id);
    if (!before) throw new Error(`Company ${id} not found`);
    const merged = {
      name: patch.name !== undefined ? patch.name.trim() : before.name,
      domain: patch.domain !== undefined ? patch.domain?.trim() || null : before.domain,
      phone: patch.phone !== undefined ? patch.phone?.trim() || null : before.phone,
      address: patch.address !== undefined ? patch.address?.trim() || null : before.address,
      industry: patch.industry !== undefined ? patch.industry?.trim() || null : before.industry,
      notes: patch.notes !== undefined ? patch.notes?.trim() || null : before.notes,
    };
    if (!merged.name) throw new Error('Company name cannot be empty');
    this.db
      .prepare(
        `UPDATE companies SET name = ?, domain = ?, phone = ?, address = ?, industry = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(merged.name, merged.domain, merged.phone, merged.address, merged.industry, merged.notes, nowIso(), id);
    const after = this.getCompany(id)!;
    this.audit('crm_update_company', 'company', id, 'update', actor, before, after);
    return after;
  }

  searchCompanies(query: string, limit = 10): Company[] {
    const cap = Math.min(Math.max(1, limit), 50);
    const q = `%${likeEscape(query.trim())}%`;
    return this.db
      .prepare(
        `SELECT * FROM companies
         WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR domain LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR industry LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(q, q, q, cap)
      .map(mapCompany);
  }

  /** Find a company by exact name (case-insensitive) or create it. */
  findOrCreateCompanyByName(name: string, actor = 'sadie'): Company {
    const trimmed = name.trim();
    const row = this.db
      .prepare('SELECT * FROM companies WHERE name = ? COLLATE NOCASE')
      .get(trimmed);
    if (row) return mapCompany(row);
    return this.createCompany({ name: trimmed }, actor);
  }

  // -------------------------------------------------------------------------
  // Contacts
  // -------------------------------------------------------------------------

  createContact(input: ContactInput, actor = 'sadie'): Contact {
    const firstName = input.firstName.trim();
    if (!firstName) throw new Error('Contact firstName is required');
    let companyId = input.companyId ?? null;
    if (companyId == null && input.companyName && input.companyName.trim()) {
      companyId = this.findOrCreateCompanyByName(input.companyName, actor).id;
    }
    if (companyId != null && !this.getCompany(companyId)) {
      throw new Error(`Company ${companyId} not found`);
    }
    const ts = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO contacts (company_id, first_name, last_name, email, phone, title, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        companyId,
        firstName,
        input.lastName?.trim() || null,
        normalizeEmail(input.email),
        input.phone?.trim() || null,
        input.title?.trim() || null,
        input.notes?.trim() || null,
        ts,
        ts
      );
    const contact = this.getContact(Number(info.lastInsertRowid))!;
    this.audit('crm_create_contact', 'contact', contact.id, 'create', actor, null, contact);
    return contact;
  }

  getContact(id: number): Contact | null {
    const row = this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    return row ? mapContact(row) : null;
  }

  findContactByEmail(email: string): Contact | null {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const row = this.db
      .prepare('SELECT * FROM contacts WHERE email = ? COLLATE NOCASE')
      .get(normalized);
    return row ? mapContact(row) : null;
  }

  updateContact(id: number, patch: Partial<ContactInput>, actor = 'sadie'): Contact {
    const before = this.getContact(id);
    if (!before) throw new Error(`Contact ${id} not found`);
    let companyId = patch.companyId !== undefined ? patch.companyId : before.companyId;
    if (patch.companyName && patch.companyName.trim()) {
      companyId = this.findOrCreateCompanyByName(patch.companyName, actor).id;
    }
    if (companyId != null && !this.getCompany(companyId)) {
      throw new Error(`Company ${companyId} not found`);
    }
    const merged = {
      firstName: patch.firstName !== undefined ? patch.firstName.trim() : before.firstName,
      lastName: patch.lastName !== undefined ? patch.lastName?.trim() || null : before.lastName,
      email: patch.email !== undefined ? normalizeEmail(patch.email) : before.email,
      phone: patch.phone !== undefined ? patch.phone?.trim() || null : before.phone,
      title: patch.title !== undefined ? patch.title?.trim() || null : before.title,
      notes: patch.notes !== undefined ? patch.notes?.trim() || null : before.notes,
    };
    if (!merged.firstName) throw new Error('Contact firstName cannot be empty');
    this.db
      .prepare(
        `UPDATE contacts SET company_id = ?, first_name = ?, last_name = ?, email = ?, phone = ?, title = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        companyId,
        merged.firstName,
        merged.lastName,
        merged.email,
        merged.phone,
        merged.title,
        merged.notes,
        nowIso(),
        id
      );
    const after = this.getContact(id)!;
    this.audit('crm_update_contact', 'contact', id, 'update', actor, before, after);
    return after;
  }

  searchContacts(query: string, limit = 10): Contact[] {
    const cap = Math.min(Math.max(1, limit), 50);
    const q = `%${likeEscape(query.trim())}%`;
    return this.db
      .prepare(
        `SELECT c.* FROM contacts c
         LEFT JOIN companies co ON co.id = c.company_id
         WHERE c.first_name LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR c.last_name LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR c.email LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR co.name LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY c.updated_at DESC LIMIT ?`
      )
      .all(q, q, q, q, cap)
      .map(mapContact);
  }

  // -------------------------------------------------------------------------
  // Deals
  // -------------------------------------------------------------------------

  createDeal(input: DealInput, actor = 'sadie'): Deal {
    const title = input.title.trim();
    if (!title) throw new Error('Deal title is required');
    const stage = input.stage || 'lead';
    this.assertStageKey(stage);
    if (input.contactId != null && !this.getContact(input.contactId)) {
      throw new Error(`Contact ${input.contactId} not found`);
    }
    if (input.companyId != null && !this.getCompany(input.companyId)) {
      throw new Error(`Company ${input.companyId} not found`);
    }
    const ts = nowIso();
    const closedAt = TERMINAL_STAGES.includes(stage) ? ts : null;
    const info = this.db
      .prepare(
        `INSERT INTO deals (company_id, contact_id, title, stage, value_cents, currency, expected_close_date, notes, created_at, updated_at, last_activity_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.companyId ?? null,
        input.contactId ?? null,
        title,
        stage,
        input.valueCents ?? null,
        (input.currency || 'NZD').toUpperCase(),
        input.expectedCloseDate || null,
        input.notes?.trim() || null,
        ts,
        ts,
        ts,
        closedAt
      );
    const deal = this.getDeal(Number(info.lastInsertRowid))!;
    this.audit('crm_create_deal', 'deal', deal.id, 'create', actor, null, deal);
    this.logActivity(
      {
        type: 'system',
        subject: `Deal created: ${title} (stage: ${stage})`,
        dealId: deal.id,
        contactId: deal.contactId,
        companyId: deal.companyId,
        actor,
      },
      'crm_create_deal'
    );
    return this.getDeal(deal.id)!;
  }

  getDeal(id: number): Deal | null {
    const row = this.db.prepare('SELECT * FROM deals WHERE id = ?').get(id);
    return row ? mapDeal(row) : null;
  }

  updateDeal(id: number, patch: Partial<DealInput>, actor = 'sadie'): Deal {
    const before = this.getDeal(id);
    if (!before) throw new Error(`Deal ${id} not found`);
    if (patch.stage !== undefined) {
      // Stage changes must go through advanceDeal so the transition is logged.
      throw new Error('Use advanceDeal to change a deal stage');
    }
    if (patch.contactId != null && !this.getContact(patch.contactId)) {
      throw new Error(`Contact ${patch.contactId} not found`);
    }
    if (patch.companyId != null && !this.getCompany(patch.companyId)) {
      throw new Error(`Company ${patch.companyId} not found`);
    }
    const merged = {
      title: patch.title !== undefined ? patch.title.trim() : before.title,
      valueCents: patch.valueCents !== undefined ? patch.valueCents : before.valueCents,
      currency:
        patch.currency !== undefined ? patch.currency.toUpperCase() : before.currency,
      expectedCloseDate:
        patch.expectedCloseDate !== undefined
          ? patch.expectedCloseDate || null
          : before.expectedCloseDate,
      notes: patch.notes !== undefined ? patch.notes?.trim() || null : before.notes,
      companyId: patch.companyId !== undefined ? patch.companyId : before.companyId,
      contactId: patch.contactId !== undefined ? patch.contactId : before.contactId,
    };
    if (!merged.title) throw new Error('Deal title cannot be empty');
    this.db
      .prepare(
        `UPDATE deals SET company_id = ?, contact_id = ?, title = ?, value_cents = ?, currency = ?, expected_close_date = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        merged.companyId,
        merged.contactId,
        merged.title,
        merged.valueCents,
        merged.currency,
        merged.expectedCloseDate,
        merged.notes,
        nowIso(),
        id
      );
    const after = this.getDeal(id)!;
    this.audit('crm_update_deal', 'deal', id, 'update', actor, before, after);
    return after;
  }

  /**
   * Move a deal to a new stage. The only sanctioned way to change stage —
   * logs both an audit row and an activity so the pipeline history is complete.
   */
  advanceDeal(id: number, toStage: string, actor = 'sadie', reason?: string): Deal {
    const before = this.getDeal(id);
    if (!before) throw new Error(`Deal ${id} not found`);
    this.assertStageKey(toStage);
    if (before.stage === toStage) return before;
    const ts = nowIso();
    const closedAt = TERMINAL_STAGES.includes(toStage) ? ts : null;
    this.db
      .prepare('UPDATE deals SET stage = ?, closed_at = ?, updated_at = ?, last_activity_at = ? WHERE id = ?')
      .run(toStage, closedAt, ts, ts, id);
    const after = this.getDeal(id)!;
    this.audit('crm_advance_deal', 'deal', id, 'advance', actor, before, after);
    this.logActivity(
      {
        type: 'system',
        subject: `Deal '${before.title}' moved ${before.stage} → ${toStage}${reason ? ` (${reason})` : ''}`,
        dealId: id,
        contactId: before.contactId,
        companyId: before.companyId,
        actor,
      },
      'crm_advance_deal'
    );
    return this.getDeal(id)!;
  }

  searchDeals(query?: string, stage?: string, limit = 20): Deal[] {
    const cap = Math.min(Math.max(1, limit), 100);
    const clauses: string[] = [];
    const params: any[] = [];
    if (query && query.trim()) {
      clauses.push("(title LIKE ? ESCAPE '\\' COLLATE NOCASE OR notes LIKE ? ESCAPE '\\' COLLATE NOCASE)");
      const q = `%${likeEscape(query.trim())}%`;
      params.push(q, q);
    }
    if (stage && stage.trim()) {
      this.assertStageKey(stage.trim());
      clauses.push('stage = ?');
      params.push(stage.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(cap);
    return this.db
      .prepare(`SELECT * FROM deals ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params)
      .map(mapDeal);
  }

  /**
   * Open (non-terminal) deals whose most recent activity is older than
   * `days`. This is the query behind the "three deals went quiet" moment.
   */
  findStaleDeals(days = 7, limit = 20): StaleDeal[] {
    const cap = Math.min(Math.max(1, limit), 100);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM deals
         WHERE stage NOT IN (${TERMINAL_STAGES.map(() => '?').join(', ')})
           AND COALESCE(last_activity_at, created_at) < ?
         ORDER BY COALESCE(last_activity_at, created_at) ASC
         LIMIT ?`
      )
      .all(...TERMINAL_STAGES, cutoff, cap);
    const now = Date.now();
    return rows.map((r: any) => {
      const deal = mapDeal(r);
      const lastTouch = new Date(deal.lastActivityAt || deal.createdAt).getTime();
      return {
        deal,
        contact: deal.contactId != null ? this.getContact(deal.contactId) : null,
        company: deal.companyId != null ? this.getCompany(deal.companyId) : null,
        daysQuiet: Math.floor((now - lastTouch) / (24 * 60 * 60 * 1000)),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Activities (the spine)
  // -------------------------------------------------------------------------

  logActivity(input: ActivityInput, toolName = 'crm_log_activity'): Activity {
    const subject = input.subject.trim();
    if (!subject) throw new Error('Activity subject is required');
    const actor = input.actor || 'sadie';
    const ts = nowIso();
    const occurredAt = input.occurredAt || ts;
    if (input.contactId != null && !this.getContact(input.contactId)) {
      throw new Error(`Contact ${input.contactId} not found`);
    }
    if (input.companyId != null && !this.getCompany(input.companyId)) {
      throw new Error(`Company ${input.companyId} not found`);
    }
    if (input.dealId != null && !this.getDeal(input.dealId)) {
      throw new Error(`Deal ${input.dealId} not found`);
    }
    const info = this.db
      .prepare(
        `INSERT INTO activities (type, direction, subject, body, contact_id, company_id, deal_id, actor, occurred_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.type,
        input.direction ?? null,
        subject,
        input.body?.trim() || null,
        input.contactId ?? null,
        input.companyId ?? null,
        input.dealId ?? null,
        actor,
        occurredAt,
        ts
      );
    // Denormalize freshness onto linked contact/deal.
    if (input.contactId != null) {
      this.db
        .prepare('UPDATE contacts SET last_activity_at = ? WHERE id = ? AND COALESCE(last_activity_at, \'\') < ?')
        .run(occurredAt, input.contactId, occurredAt);
    }
    if (input.dealId != null) {
      this.db
        .prepare('UPDATE deals SET last_activity_at = ? WHERE id = ? AND COALESCE(last_activity_at, \'\') < ?')
        .run(occurredAt, input.dealId, occurredAt);
    }
    const row = this.db
      .prepare('SELECT * FROM activities WHERE id = ?')
      .get(Number(info.lastInsertRowid));
    const activity = mapActivity(row);
    this.audit(toolName, 'activity', activity.id, 'create', actor, null, activity);
    return activity;
  }

  recentActivities(limit = 20): Activity[] {
    const cap = Math.min(Math.max(1, limit), 200);
    return this.db
      .prepare('SELECT * FROM activities ORDER BY occurred_at DESC LIMIT ?')
      .all(cap)
      .map(mapActivity);
  }

  activitiesForDeal(dealId: number, limit = 50): Activity[] {
    const cap = Math.min(Math.max(1, limit), 200);
    return this.db
      .prepare('SELECT * FROM activities WHERE deal_id = ? ORDER BY occurred_at DESC LIMIT ?')
      .all(dealId, cap)
      .map(mapActivity);
  }

  // -------------------------------------------------------------------------
  // Notes
  // -------------------------------------------------------------------------

  addNote(
    body: string,
    links: { contactId?: number | null; companyId?: number | null; dealId?: number | null },
    actor = 'sadie'
  ): Note {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Note body is required');
    const info = this.db
      .prepare(
        `INSERT INTO notes (body, contact_id, company_id, deal_id, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        trimmed,
        links.contactId ?? null,
        links.companyId ?? null,
        links.dealId ?? null,
        actor,
        nowIso()
      );
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(info.lastInsertRowid));
    const note = mapNote(row);
    this.audit('crm_add_note', 'note', note.id, 'create', actor, null, note);
    return note;
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  createTask(input: TaskInput, actor?: string): Task {
    const title = input.title.trim();
    if (!title) throw new Error('Task title is required');
    const who = actor || input.actor || 'sadie';
    const ts = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO tasks (title, details, due_date, contact_id, company_id, deal_id, actor, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        title,
        input.details?.trim() || null,
        input.dueDate || null,
        input.contactId ?? null,
        input.companyId ?? null,
        input.dealId ?? null,
        who,
        ts,
        ts
      );
    const task = this.getTask(Number(info.lastInsertRowid))!;
    this.audit('crm_create_task', 'task', task.id, 'create', who, null, task);
    return task;
  }

  getTask(id: number): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? mapTask(row) : null;
  }

  completeTask(id: number, actor = 'sadie'): Task {
    const before = this.getTask(id);
    if (!before) throw new Error(`Task ${id} not found`);
    if (before.completedAt) return before;
    const ts = nowIso();
    this.db.prepare('UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id);
    const after = this.getTask(id)!;
    this.audit('crm_complete_task', 'task', id, 'complete', actor, before, after);
    return after;
  }

  openTasks(limit = 50): Task[] {
    const cap = Math.min(Math.max(1, limit), 200);
    return this.db
      .prepare(
        `SELECT * FROM tasks WHERE completed_at IS NULL
         ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC LIMIT ?`
      )
      .all(cap)
      .map(mapTask);
  }

  // -------------------------------------------------------------------------
  // Email matching (the sync integration point)
  // -------------------------------------------------------------------------

  /**
   * Match an inbound email to a contact, creating one if unknown. Attempts to
   * attach a company from the email domain. Always logs the email as an
   * inbound activity. This is the hook the email pipeline calls.
   */
  matchInboundEmail(
    fromEmail: string,
    options?: { fromName?: string; subject?: string; body?: string; actor?: string }
  ): EmailMatchResult {
    const email = normalizeEmail(fromEmail);
    if (!email) throw new Error('A sender email address is required');
    const actor = options?.actor || 'sadie';

    let contact = this.findContactByEmail(email);
    let created = false;

    if (!contact) {
      // Derive a name: "Jane Smith <jane@x.com>" style fromName, else the
      // local part of the address.
      const rawName = (options?.fromName || '').trim();
      let firstName: string;
      let lastName: string | null = null;
      if (rawName) {
        const parts = rawName.split(/\s+/);
        firstName = parts[0];
        lastName = parts.slice(1).join(' ') || null;
      } else {
        firstName = email.split('@')[0];
      }

      // Company from domain (skip common personal providers).
      const domain = email.split('@')[1] || '';
      const personal = new Set([
        'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
        'xtra.co.nz', 'protonmail.com', 'proton.me', 'live.com', 'aol.com',
      ]);
      let companyId: number | null = null;
      if (domain && !personal.has(domain)) {
        const existing = this.db
          .prepare('SELECT * FROM companies WHERE domain = ? COLLATE NOCASE')
          .get(domain);
        if (existing) {
          companyId = mapCompany(existing).id;
        } else {
          const companyName = domain.split('.')[0];
          const company = this.createCompany(
            { name: companyName.charAt(0).toUpperCase() + companyName.slice(1), domain },
            actor
          );
          companyId = company.id;
        }
      }

      contact = this.createContact({ firstName, lastName, email, companyId }, actor);
      created = true;
    }

    const activity = this.logActivity(
      {
        type: 'email',
        direction: 'inbound',
        subject: options?.subject?.trim() || `Email from ${email}`,
        body: options?.body || null,
        contactId: contact.id,
        companyId: contact.companyId,
        actor,
      },
      'crm_match_email'
    );

    // Refresh contact (last_activity_at was just denormalized).
    contact = this.getContact(contact.id)!;
    const company = contact.companyId != null ? this.getCompany(contact.companyId) : null;
    return { contact, company, created, activityId: activity.id };
  }

  // -------------------------------------------------------------------------
  // Daily brief — the demo moment
  // -------------------------------------------------------------------------

  dailyBrief(staleDays = 7): DailyBrief {
    const today = todayIso();
    const openDeals = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(value_cents), 0) AS v FROM deals
         WHERE stage NOT IN (${TERMINAL_STAGES.map(() => '?').join(', ')})`
      )
      .get(...TERMINAL_STAGES);
    const tasksOverdue = this.db
      .prepare(
        `SELECT * FROM tasks WHERE completed_at IS NULL AND due_date IS NOT NULL AND due_date < ?
         ORDER BY due_date ASC LIMIT 25`
      )
      .all(today)
      .map(mapTask);
    const tasksDueToday = this.db
      .prepare('SELECT * FROM tasks WHERE completed_at IS NULL AND due_date = ? ORDER BY id ASC LIMIT 25')
      .all(today)
      .map(mapTask);
    return {
      generatedAt: nowIso(),
      staleDeals: this.findStaleDeals(staleDays, 10),
      tasksOverdue,
      tasksDueToday,
      recentActivities: this.recentActivities(10),
      openDealCount: Number(openDeals.n),
      openPipelineValueCents: Number(openDeals.v),
    };
  }
}
