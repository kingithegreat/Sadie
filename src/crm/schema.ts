/**
 * SADIE / HomeBot — CRM schema + migrations (Phase 1).
 * ---------------------------------------------------------------------------
 * Single SQLite file, WAL mode. Migrations are append-only: NEVER edit an
 * entry after it has shipped — add a new one. The store runs every migration
 * whose id is not yet in schema_migrations, inside one transaction each.
 */

export interface Migration {
  id: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001-initial-crm',
    statements: [
      `CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        domain TEXT,
        phone TEXT,
        address TEXT,
        industry TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name COLLATE NOCASE)`,
      `CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain COLLATE NOCASE)`,

      `CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        first_name TEXT NOT NULL,
        last_name TEXT,
        email TEXT,
        phone TEXT,
        title TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_activity_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email COLLATE NOCASE)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(first_name COLLATE NOCASE, last_name COLLATE NOCASE)`,

      `CREATE TABLE IF NOT EXISTS deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'lead',
        value_cents INTEGER,
        currency TEXT NOT NULL DEFAULT 'NZD',
        expected_close_date TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_activity_at TEXT,
        closed_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage)`,
      `CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id)`,
      `CREATE INDEX IF NOT EXISTS idx_deals_last_activity ON deals(last_activity_at)`,

      `CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        direction TEXT,
        subject TEXT NOT NULL,
        body TEXT,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
        actor TEXT NOT NULL DEFAULT 'sadie',
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id)`,
      `CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_activities_occurred ON activities(occurred_at)`,

      `CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        body TEXT NOT NULL,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
        actor TEXT NOT NULL DEFAULT 'sadie',
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        details TEXT,
        due_date TEXT,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
        completed_at TEXT,
        actor TEXT NOT NULL DEFAULT 'sadie',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed_at)`,

      `CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`,

      `CREATE TABLE IF NOT EXISTS crm_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
];
