/**
 * CRM tool handler tests — exercise the tools through the same handler layer
 * the model calls, on a temp-file database (WAL mode, like production).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('electron', () => ({ app: undefined }), { virtual: true });

import { crmToolDefs, crmToolHandlers, resetCrmStoreForTests } from '../tools/crm';

const ctx = {} as any;
const call = async (name: string, args: Record<string, any> = {}) => {
  const handler = crmToolHandlers[name];
  if (!handler) throw new Error(`No handler for ${name}`);
  return handler(args, ctx);
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-crm-test-'));
  process.env.HOMEBOT_CRM_DB_PATH = path.join(tmpDir, 'crm.sqlite3');
  resetCrmStoreForTests();
});

afterEach(() => {
  resetCrmStoreForTests();
  delete process.env.HOMEBOT_CRM_DB_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CRM tool wiring', () => {
  test('every def has a handler and every handler has a def', () => {
    const defNames = crmToolDefs.map((d) => d.name).sort();
    const handlerNames = Object.keys(crmToolHandlers).sort();
    expect(defNames).toEqual(handlerNames);
  });

  test('all defs are crm-prefixed, categorized, and have valid required arrays', () => {
    for (const def of crmToolDefs) {
      expect(def.name.startsWith('crm_')).toBe(true);
      expect(def.category).toBe('crm');
      for (const req of def.parameters.required) {
        expect(Object.keys(def.parameters.properties)).toContain(req);
      }
    }
  });
});

describe('CRM tools — end-to-end flow', () => {
  test('full sales flow: company → contact → deal → activity → advance → brief', async () => {
    const company = await call('crm_create_company', {
      name: 'Bayfair Fitness',
      domain: 'bayfairfitness.co.nz',
    });
    expect(company.success).toBe(true);
    const companyId = (company.result as any).id;

    const contact = await call('crm_create_contact', {
      firstName: 'Sam',
      lastName: 'Rangi',
      email: 'sam@bayfairfitness.co.nz',
      companyId,
    });
    expect(contact.success).toBe(true);
    const contactId = (contact.result as any).id;

    const deal = await call('crm_create_deal', {
      title: 'Website + booking system',
      valueCents: 450000,
      companyId,
      contactId,
    });
    expect(deal.success).toBe(true);
    const dealId = (deal.result as any).id;
    expect((deal.result as any).stage).toBe('lead');

    const activity = await call('crm_log_activity', {
      type: 'call',
      direction: 'outbound',
      subject: 'Discovery call',
      dealId,
      contactId,
    });
    expect(activity.success).toBe(true);

    const advanced = await call('crm_advance_deal', {
      id: dealId,
      stage: 'qualified',
      reason: 'budget confirmed',
    });
    expect(advanced.success).toBe(true);
    expect((advanced.result as any).stage).toBe('qualified');

    await call('crm_create_task', { title: 'Send proposal', dueDate: '2020-01-01', dealId });

    const brief = await call('crm_daily_brief', {});
    expect(brief.success).toBe(true);
    const b = brief.result as any;
    expect(b.openDealCount).toBe(1);
    expect(b.openPipelineValueCents).toBe(450000);
    expect(b.tasksOverdue).toHaveLength(1);

    const audit = await call('crm_audit_log', { entityType: 'deal', entityId: dealId });
    expect(audit.success).toBe(true);
    expect((audit.result as any).count).toBeGreaterThanOrEqual(2); // create + advance
  });

  test('search tools return counted result envelopes', async () => {
    await call('crm_create_contact', { firstName: 'Kiri', companyName: 'Mount Surf Co' });
    const contacts = await call('crm_search_contacts', { query: 'kiri' });
    expect((contacts.result as any).count).toBe(1);
    const companies = await call('crm_search_companies', { query: 'surf' });
    expect((companies.result as any).count).toBe(1);
    const deals = await call('crm_search_deals', {});
    expect((deals.result as any).count).toBe(0);
  });

  test('crm_match_email creates and then matches, logging inbound activity', async () => {
    const first = await call('crm_match_email', {
      fromEmail: 'ops@harbourside.co.nz',
      fromName: 'Pat Ngata',
      subject: 'Re: quote',
    });
    expect(first.success).toBe(true);
    expect((first.result as any).created).toBe(true);
    expect((first.result as any).company.domain).toBe('harbourside.co.nz');

    const second = await call('crm_match_email', { fromEmail: 'OPS@harbourside.co.nz' });
    expect((second.result as any).created).toBe(false);
    expect((second.result as any).contact.id).toBe((first.result as any).contact.id);
  });

  test('stage rename persists and stage validation errors are clean failures', async () => {
    const renamed = await call('crm_rename_stage', { key: 'proposal', label: 'Quote Sent' });
    expect(renamed.success).toBe(true);

    const stages = await call('crm_get_stages', {});
    expect(
      (stages.result as any).stages.find((s: any) => s.key === 'proposal').label
    ).toBe('Quote Sent');

    const deal = await call('crm_create_deal', { title: 'X' });
    const bad = await call('crm_advance_deal', { id: (deal.result as any).id, stage: 'nope' });
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/Unknown stage/);
  });

  test('handlers fail gracefully (never throw) on bad input', async () => {
    const noName = await call('crm_create_company', {});
    expect(noName.success).toBe(false);
    expect(noName.error).toMatch(/name is required/);

    const badId = await call('crm_update_contact', { id: 'abc', firstName: 'X' });
    expect(badId.success).toBe(false);

    const missing = await call('crm_complete_task', { id: 999 });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/not found/);
  });

  test('data persists across store reopen (file-backed, not memory)', async () => {
    await call('crm_create_contact', { firstName: 'Persist', email: 'p@durable.co.nz' });
    resetCrmStoreForTests(); // close + reopen same file
    const found = await call('crm_search_contacts', { query: 'persist' });
    expect((found.result as any).count).toBe(1);
  });
});

describe('crm_export', () => {
  test('exports CSVs + JSON to an explicit directory', async () => {
    await call('crm_create_company', { name: 'Export Co', domain: 'export.co.nz' });
    const target = path.join(tmpDir, 'out');
    const res = await call('crm_export', { targetDir: target });
    expect(res.success).toBe(true);
    const result = res.result as any;
    expect(result.directory).toBe(target);
    expect(result.counts.companies).toBe(1);
    for (const f of ['companies.csv', 'audit_log.csv', 'crm-export.json']) {
      expect(fs.existsSync(path.join(target, f))).toBe(true);
    }
  });

  test('defaults to a timestamped folder beside the database', async () => {
    await call('crm_create_company', { name: 'Default Dir Co' });
    const res = await call('crm_export', {});
    expect(res.success).toBe(true);
    const dir = (res.result as any).directory as string;
    expect(dir.startsWith(tmpDir)).toBe(true);
    expect(path.basename(dir)).toMatch(/^crm-export-\d{8}-\d{6}$/);
    expect(fs.existsSync(path.join(dir, 'crm-export.json'))).toBe(true);
  });
});
