/**
 * HomeBot CRM Tools (Phase 1)
 *
 * Thin adapter over the CRM core (root src/crm) — the layer that turns SADIE
 * from a chatbot into a worker. All state lives in one SQLite file under
 * userData; every mutation is audited by the store itself.
 *
 * Naming: everything is crm_-prefixed to avoid colliding with the existing
 * Outlook-backed search_contacts/add_contact tools, which stay as-is for
 * personal-assistant use. The CRM is the business-of-record.
 */

import * as path from 'path';
import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { CrmStore } from '../../../../src/crm/store';
import type { ActivityType, ActivityDirection } from '../../../../src/crm/types';

// ============= STORE SINGLETON =============

let storeInstance: CrmStore | null = null;

/** Resolve the CRM db path: env override (tests/e2e) → electron userData → cwd. */
function resolveDbPath(): string {
  if (process.env.HOMEBOT_CRM_DB_PATH) return process.env.HOMEBOT_CRM_DB_PATH;
  try {
    // Lazy require so this module loads under plain jest without electron.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'crm', 'crm.sqlite3');
    }
  } catch {
    /* not running under electron */
  }
  return path.join(process.cwd(), 'memory', 'crm', 'crm.sqlite3');
}

export function getCrmStore(): CrmStore {
  if (!storeInstance) {
    storeInstance = new CrmStore({ dbPath: resolveDbPath() });
    console.log(`[HomeBot CRM] Store opened at ${storeInstance.databasePath}`);
  }
  return storeInstance;
}

/** Test hook: close and drop the singleton so a new db path can take effect. */
export function resetCrmStoreForTests(): void {
  if (storeInstance) {
    try {
      storeInstance.close();
    } catch {
      /* already closed */
    }
    storeInstance = null;
  }
}

// ============= HELPERS =============

const asStr = (v: unknown): string => (v == null ? '' : String(v)).trim();
const asOptStr = (v: unknown): string | null => {
  const s = asStr(v);
  return s.length > 0 ? s : null;
};
const asOptId = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid id: ${v}`);
  return n;
};
const asActor = (v: unknown): string => asOptStr(v) || 'sadie';

function ok(result: unknown): ToolResult {
  return { success: true, result };
}

function wrap(name: string, fn: (args: Record<string, any>) => unknown): ToolHandler {
  return async (args): Promise<ToolResult> => {
    try {
      return ok(fn(args || {}));
    } catch (err: any) {
      return { success: false, error: `${name} failed: ${err?.message || err}` };
    }
  };
}

// Shared param fragments
const actorParam = {
  actor: {
    type: 'string' as const,
    description: "Who performed this: 'sadie' (default) or 'owner'",
  },
};
const linkParams = {
  contactId: { type: 'number' as const, description: 'Linked contact id (optional)' },
  companyId: { type: 'number' as const, description: 'Linked company id (optional)' },
  dealId: { type: 'number' as const, description: 'Linked deal id (optional)' },
};

// ============= TOOL DEFINITIONS + HANDLERS =============

// ---- Companies ----

export const crmCreateCompanyDef: ToolDefinition = {
  name: 'crm_create_company',
  description:
    'Create a company in the CRM. Use for businesses the owner deals with. Returns the created company with its id.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Company name (required)' },
      domain: { type: 'string', description: 'Website domain, e.g. acme.co.nz' },
      phone: { type: 'string', description: 'Phone number' },
      address: { type: 'string', description: 'Physical address' },
      industry: { type: 'string', description: 'Industry, e.g. Trades, Hospitality' },
      notes: { type: 'string', description: 'Freeform notes' },
      ...actorParam,
    },
    required: ['name'],
  },
};

export const crmUpdateCompanyDef: ToolDefinition = {
  name: 'crm_update_company',
  description:
    'Update fields on an existing CRM company by id. Only provided fields change; the update is audited.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Company id (required)' },
      name: { type: 'string', description: 'New name' },
      domain: { type: 'string', description: 'New domain' },
      phone: { type: 'string', description: 'New phone' },
      address: { type: 'string', description: 'New address' },
      industry: { type: 'string', description: 'New industry' },
      notes: { type: 'string', description: 'New notes' },
      ...actorParam,
    },
    required: ['id'],
  },
};

export const crmSearchCompaniesDef: ToolDefinition = {
  name: 'crm_search_companies',
  description: 'Search CRM companies by name, domain, or industry. Returns matches with ids.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text (required)' },
      limit: { type: 'number', description: 'Max results (default 10, max 50)', default: 10 },
    },
    required: ['query'],
  },
};

// ---- Contacts ----

export const crmCreateContactDef: ToolDefinition = {
  name: 'crm_create_contact',
  description:
    'Create a person in the CRM. Link to a company by companyId, or pass companyName to find-or-create one.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      firstName: { type: 'string', description: 'First name (required)' },
      lastName: { type: 'string', description: 'Last name' },
      email: { type: 'string', description: 'Email address (used for inbound email matching)' },
      phone: { type: 'string', description: 'Phone number' },
      title: { type: 'string', description: 'Job title' },
      notes: { type: 'string', description: 'Freeform notes' },
      companyId: { type: 'number', description: 'Existing company id to link' },
      companyName: { type: 'string', description: 'Company name to find-or-create and link' },
      ...actorParam,
    },
    required: ['firstName'],
  },
};

export const crmUpdateContactDef: ToolDefinition = {
  name: 'crm_update_contact',
  description: 'Update fields on an existing CRM contact by id. Only provided fields change; audited.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Contact id (required)' },
      firstName: { type: 'string', description: 'New first name' },
      lastName: { type: 'string', description: 'New last name' },
      email: { type: 'string', description: 'New email' },
      phone: { type: 'string', description: 'New phone' },
      title: { type: 'string', description: 'New job title' },
      notes: { type: 'string', description: 'New notes' },
      companyId: { type: 'number', description: 'New linked company id' },
      companyName: { type: 'string', description: 'Company name to find-or-create and link' },
      ...actorParam,
    },
    required: ['id'],
  },
};

export const crmSearchContactsDef: ToolDefinition = {
  name: 'crm_search_contacts',
  description:
    'Search CRM contacts by name, email, or company name. This is the business CRM — for the personal Outlook address book use search_contacts instead.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text (required)' },
      limit: { type: 'number', description: 'Max results (default 10, max 50)', default: 10 },
    },
    required: ['query'],
  },
};

// ---- Deals ----

export const crmCreateDealDef: ToolDefinition = {
  name: 'crm_create_deal',
  description:
    'Create a deal/opportunity in the pipeline. Stages: lead, contacted, qualified, proposal, won, lost. Value is in whole cents.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Deal title (required)' },
      stage: { type: 'string', description: "Stage key (default 'lead')" },
      valueCents: { type: 'number', description: 'Deal value in cents (e.g. $2,500 = 250000)' },
      currency: { type: 'string', description: "Currency code (default 'NZD')" },
      expectedCloseDate: { type: 'string', description: 'Expected close date, YYYY-MM-DD' },
      notes: { type: 'string', description: 'Freeform notes' },
      companyId: { type: 'number', description: 'Linked company id' },
      contactId: { type: 'number', description: 'Linked contact id' },
      ...actorParam,
    },
    required: ['title'],
  },
};

export const crmUpdateDealDef: ToolDefinition = {
  name: 'crm_update_deal',
  description:
    'Update fields on a deal by id (title, value, dates, links, notes). To change the STAGE use crm_advance_deal instead.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Deal id (required)' },
      title: { type: 'string', description: 'New title' },
      valueCents: { type: 'number', description: 'New value in cents' },
      currency: { type: 'string', description: 'New currency code' },
      expectedCloseDate: { type: 'string', description: 'New expected close date, YYYY-MM-DD' },
      notes: { type: 'string', description: 'New notes' },
      companyId: { type: 'number', description: 'New linked company id' },
      contactId: { type: 'number', description: 'New linked contact id' },
      ...actorParam,
    },
    required: ['id'],
  },
};

export const crmAdvanceDealDef: ToolDefinition = {
  name: 'crm_advance_deal',
  description:
    "Move a deal to a new pipeline stage (lead → contacted → qualified → proposal → won/lost). Logs the transition to the deal's history.",
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Deal id (required)' },
      stage: { type: 'string', description: 'Target stage key (required)' },
      reason: { type: 'string', description: 'Why the deal moved (goes in the history)' },
      ...actorParam,
    },
    required: ['id', 'stage'],
  },
};

export const crmSearchDealsDef: ToolDefinition = {
  name: 'crm_search_deals',
  description: 'Search deals by title/notes text and/or filter by stage key. Returns matches with ids.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text (optional)' },
      stage: { type: 'string', description: 'Filter by stage key (optional)' },
      limit: { type: 'number', description: 'Max results (default 20, max 100)', default: 20 },
    },
    required: [],
  },
};

// ---- Activities / notes / tasks ----

export const crmLogActivityDef: ToolDefinition = {
  name: 'crm_log_activity',
  description:
    'Log a touchpoint (email, call, meeting, note) against a contact/company/deal. Activities drive stale-deal detection — log every real interaction.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Activity type',
        enum: ['email', 'call', 'meeting', 'note', 'task', 'system'],
      },
      subject: { type: 'string', description: 'Short summary (required)' },
      body: { type: 'string', description: 'Full detail' },
      direction: {
        type: 'string',
        description: 'inbound / outbound / internal',
        enum: ['inbound', 'outbound', 'internal'],
      },
      ...linkParams,
      ...actorParam,
    },
    required: ['type', 'subject'],
  },
};

export const crmAddNoteDef: ToolDefinition = {
  name: 'crm_add_note',
  description: 'Attach a freeform note to a contact, company, or deal.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      body: { type: 'string', description: 'Note text (required)' },
      ...linkParams,
      ...actorParam,
    },
    required: ['body'],
  },
};

export const crmCreateTaskDef: ToolDefinition = {
  name: 'crm_create_task',
  description: 'Create a follow-up task, optionally linked to a contact/company/deal, with a due date.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Task title (required)' },
      details: { type: 'string', description: 'Extra detail' },
      dueDate: { type: 'string', description: 'Due date, YYYY-MM-DD' },
      ...linkParams,
      ...actorParam,
    },
    required: ['title'],
  },
};

export const crmCompleteTaskDef: ToolDefinition = {
  name: 'crm_complete_task',
  description: 'Mark a CRM task as completed by id.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Task id (required)' },
      ...actorParam,
    },
    required: ['id'],
  },
};

// ---- Intelligence ----

export const crmFindStaleDealsDef: ToolDefinition = {
  name: 'crm_find_stale_deals',
  description:
    'Find open deals with no activity for N days (default 7) — the deals that went quiet and need a follow-up. Returns each deal with its contact, company, and days quiet.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Quiet threshold in days (default 7)', default: 7 },
      limit: { type: 'number', description: 'Max results (default 20)', default: 20 },
    },
    required: [],
  },
};

export const crmDailyBriefDef: ToolDefinition = {
  name: 'crm_daily_brief',
  description:
    "The morning briefing: stale deals needing follow-up, overdue and due-today tasks, recent activity, and open pipeline totals. Use this to open the owner's day.",
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      staleDays: { type: 'number', description: 'Stale threshold in days (default 7)', default: 7 },
    },
    required: [],
  },
};

export const crmMatchEmailDef: ToolDefinition = {
  name: 'crm_match_email',
  description:
    'Match an inbound email sender to the CRM: finds the contact by address or creates one (with a company from the domain), and logs the email as an inbound activity. Call this when processing incoming email.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      fromEmail: { type: 'string', description: 'Sender email address (required)' },
      fromName: { type: 'string', description: "Sender display name, e.g. 'Jane Doe'" },
      subject: { type: 'string', description: 'Email subject line' },
      body: { type: 'string', description: 'Email body (stored on the activity)' },
    },
    required: ['fromEmail'],
  },
};

export const crmGetStagesDef: ToolDefinition = {
  name: 'crm_get_stages',
  description: 'List the pipeline stages (stable keys + owner-renamable labels).',
  category: 'crm',
  parameters: { type: 'object', properties: {}, required: [] },
};

export const crmRenameStageDef: ToolDefinition = {
  name: 'crm_rename_stage',
  description:
    "Rename a pipeline stage's display label (the key stays stable so history and tools keep working).",
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Stage key to rename (required)' },
      label: { type: 'string', description: 'New display label (required)' },
    },
    required: ['key', 'label'],
  },
};

export const crmAuditLogDef: ToolDefinition = {
  name: 'crm_audit_log',
  description:
    'Read the append-only CRM audit log — every create/update/advance with before/after snapshots. Optionally filter to one entity.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max rows (default 50, max 1000)', default: 50 },
      entityType: {
        type: 'string',
        description: 'Filter by entity type',
        enum: ['company', 'contact', 'deal', 'activity', 'note', 'task', 'settings'],
      },
      entityId: { type: 'number', description: 'Filter by entity id (requires entityType)' },
    },
    required: [],
  },
};

export const crmExportDef: ToolDefinition = {
  name: 'crm_export',
  description:
    'Export the entire CRM to files the owner can open anywhere: one CSV per table ' +
    '(companies, contacts, deals, activities, notes, tasks, audit log) plus a combined ' +
    'crm-export.json. Defaults to a timestamped folder next to the database.',
  category: 'crm',
  parameters: {
    type: 'object',
    properties: {
      targetDir: {
        type: 'string',
        description: 'Optional absolute directory to write into (created if missing)',
      },
    },
    required: [],
  },
};

// ============= HANDLERS =============

export const crmToolHandlers: Record<string, ToolHandler> = {
  crm_create_company: wrap('crm_create_company', (a) =>
    getCrmStore().createCompany(
      {
        name: asStr(a.name),
        domain: asOptStr(a.domain),
        phone: asOptStr(a.phone),
        address: asOptStr(a.address),
        industry: asOptStr(a.industry),
        notes: asOptStr(a.notes),
      },
      asActor(a.actor)
    )
  ),

  crm_update_company: wrap('crm_update_company', (a) => {
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'domain', 'phone', 'address', 'industry', 'notes']) {
      if (a[k] !== undefined) patch[k] = asOptStr(a[k]) ?? '';
    }
    if (a.name !== undefined) patch.name = asStr(a.name);
    return getCrmStore().updateCompany(asOptId(a.id)!, patch, asActor(a.actor));
  }),

  crm_search_companies: wrap('crm_search_companies', (a) => {
    const results = getCrmStore().searchCompanies(asStr(a.query), Number(a.limit) || 10);
    return { count: results.length, companies: results };
  }),

  crm_create_contact: wrap('crm_create_contact', (a) =>
    getCrmStore().createContact(
      {
        firstName: asStr(a.firstName),
        lastName: asOptStr(a.lastName),
        email: asOptStr(a.email),
        phone: asOptStr(a.phone),
        title: asOptStr(a.title),
        notes: asOptStr(a.notes),
        companyId: asOptId(a.companyId),
        companyName: asOptStr(a.companyName),
      },
      asActor(a.actor)
    )
  ),

  crm_update_contact: wrap('crm_update_contact', (a) => {
    const patch: Record<string, unknown> = {};
    for (const k of ['firstName', 'lastName', 'email', 'phone', 'title', 'notes']) {
      if (a[k] !== undefined) patch[k] = asOptStr(a[k]) ?? '';
    }
    if (a.firstName !== undefined) patch.firstName = asStr(a.firstName);
    if (a.companyId !== undefined) patch.companyId = asOptId(a.companyId);
    if (a.companyName !== undefined) patch.companyName = asOptStr(a.companyName);
    return getCrmStore().updateContact(asOptId(a.id)!, patch, asActor(a.actor));
  }),

  crm_search_contacts: wrap('crm_search_contacts', (a) => {
    const results = getCrmStore().searchContacts(asStr(a.query), Number(a.limit) || 10);
    return { count: results.length, contacts: results };
  }),

  crm_create_deal: wrap('crm_create_deal', (a) =>
    getCrmStore().createDeal(
      {
        title: asStr(a.title),
        stage: asOptStr(a.stage) || undefined,
        valueCents: a.valueCents == null ? null : Math.round(Number(a.valueCents)),
        currency: asOptStr(a.currency) || undefined,
        expectedCloseDate: asOptStr(a.expectedCloseDate),
        notes: asOptStr(a.notes),
        companyId: asOptId(a.companyId),
        contactId: asOptId(a.contactId),
      },
      asActor(a.actor)
    )
  ),

  crm_update_deal: wrap('crm_update_deal', (a) => {
    const patch: Record<string, unknown> = {};
    if (a.title !== undefined) patch.title = asStr(a.title);
    if (a.valueCents !== undefined) {
      patch.valueCents = a.valueCents == null ? null : Math.round(Number(a.valueCents));
    }
    if (a.currency !== undefined) patch.currency = asStr(a.currency);
    if (a.expectedCloseDate !== undefined) patch.expectedCloseDate = asOptStr(a.expectedCloseDate);
    if (a.notes !== undefined) patch.notes = asOptStr(a.notes) ?? '';
    if (a.companyId !== undefined) patch.companyId = asOptId(a.companyId);
    if (a.contactId !== undefined) patch.contactId = asOptId(a.contactId);
    return getCrmStore().updateDeal(asOptId(a.id)!, patch, asActor(a.actor));
  }),

  crm_advance_deal: wrap('crm_advance_deal', (a) =>
    getCrmStore().advanceDeal(
      asOptId(a.id)!,
      asStr(a.stage),
      asActor(a.actor),
      asOptStr(a.reason) || undefined
    )
  ),

  crm_search_deals: wrap('crm_search_deals', (a) => {
    const results = getCrmStore().searchDeals(
      asOptStr(a.query) || undefined,
      asOptStr(a.stage) || undefined,
      Number(a.limit) || 20
    );
    return { count: results.length, deals: results };
  }),

  crm_log_activity: wrap('crm_log_activity', (a) =>
    getCrmStore().logActivity({
      type: asStr(a.type) as ActivityType,
      subject: asStr(a.subject),
      body: asOptStr(a.body),
      direction: (asOptStr(a.direction) as ActivityDirection | null) || null,
      contactId: asOptId(a.contactId),
      companyId: asOptId(a.companyId),
      dealId: asOptId(a.dealId),
      actor: asActor(a.actor),
    })
  ),

  crm_add_note: wrap('crm_add_note', (a) =>
    getCrmStore().addNote(
      asStr(a.body),
      {
        contactId: asOptId(a.contactId),
        companyId: asOptId(a.companyId),
        dealId: asOptId(a.dealId),
      },
      asActor(a.actor)
    )
  ),

  crm_create_task: wrap('crm_create_task', (a) =>
    getCrmStore().createTask(
      {
        title: asStr(a.title),
        details: asOptStr(a.details),
        dueDate: asOptStr(a.dueDate),
        contactId: asOptId(a.contactId),
        companyId: asOptId(a.companyId),
        dealId: asOptId(a.dealId),
      },
      asActor(a.actor)
    )
  ),

  crm_complete_task: wrap('crm_complete_task', (a) =>
    getCrmStore().completeTask(asOptId(a.id)!, asActor(a.actor))
  ),

  crm_find_stale_deals: wrap('crm_find_stale_deals', (a) => {
    const results = getCrmStore().findStaleDeals(
      a.days == null ? 7 : Number(a.days),
      Number(a.limit) || 20
    );
    return { count: results.length, staleDeals: results };
  }),

  crm_daily_brief: wrap('crm_daily_brief', (a) =>
    getCrmStore().dailyBrief(a.staleDays == null ? 7 : Number(a.staleDays))
  ),

  crm_match_email: wrap('crm_match_email', (a) =>
    getCrmStore().matchInboundEmail(asStr(a.fromEmail), {
      fromName: asOptStr(a.fromName) || undefined,
      subject: asOptStr(a.subject) || undefined,
      body: asOptStr(a.body) || undefined,
    })
  ),

  crm_get_stages: wrap('crm_get_stages', () => ({ stages: getCrmStore().getStages() })),

  crm_rename_stage: wrap('crm_rename_stage', (a) => ({
    stages: getCrmStore().renameStage(asStr(a.key), asStr(a.label), 'owner'),
  })),

  crm_audit_log: wrap('crm_audit_log', (a) => {
    const entries = getCrmStore().getAuditLog(
      Number(a.limit) || 50,
      asOptStr(a.entityType) || undefined,
      a.entityId == null ? undefined : Number(a.entityId)
    );
    return { count: entries.length, entries };
  }),

  crm_export: wrap('crm_export', (a) =>
    getCrmStore().exportAll(asOptStr(a.targetDir) || undefined, 'owner')
  ),
};

// ============= EXPORTS =============

export const crmToolDefs: ToolDefinition[] = [
  crmCreateCompanyDef,
  crmUpdateCompanyDef,
  crmSearchCompaniesDef,
  crmCreateContactDef,
  crmUpdateContactDef,
  crmSearchContactsDef,
  crmCreateDealDef,
  crmUpdateDealDef,
  crmAdvanceDealDef,
  crmSearchDealsDef,
  crmLogActivityDef,
  crmAddNoteDef,
  crmCreateTaskDef,
  crmCompleteTaskDef,
  crmFindStaleDealsDef,
  crmDailyBriefDef,
  crmMatchEmailDef,
  crmGetStagesDef,
  crmRenameStageDef,
  crmAuditLogDef,
  crmExportDef,
];
