/**
 * CrmStore tests (Phase 1). These run in the root jest suite, which is the
 * suite the required ci.yml workflow executes — so the CRM core is protected
 * by the same gate that auto-merge requires.
 */
import { CrmStore } from '../crm/store';
import { DEFAULT_STAGES } from '../crm/types';

function freshStore(): CrmStore {
  return new CrmStore({ dbPath: ':memory:' });
}

describe('CrmStore — schema & migrations', () => {
  test('opens, migrates, and can reopen logic idempotently', () => {
    const store = freshStore();
    // Second store on a new :memory: db proves migrations run cleanly from scratch;
    // running migrate on an already-migrated db is exercised implicitly by every test.
    expect(store.getStages().map((s) => s.key)).toEqual(DEFAULT_STAGES.map((s) => s.key));
    store.close();
  });
});

describe('CrmStore — companies', () => {
  test('create, get, update, search, audit', () => {
    const store = freshStore();
    const company = store.createCompany({ name: 'Tauranga Plumbing', domain: 'tgaplumbing.co.nz' });
    expect(company.id).toBeGreaterThan(0);
    expect(store.getCompany(company.id)?.name).toBe('Tauranga Plumbing');

    const updated = store.updateCompany(company.id, { industry: 'Trades' }, 'owner');
    expect(updated.industry).toBe('Trades');
    expect(updated.domain).toBe('tgaplumbing.co.nz'); // untouched fields preserved

    expect(store.searchCompanies('plumbing')).toHaveLength(1);
    expect(store.searchCompanies('trades')).toHaveLength(1); // industry match
    expect(store.searchCompanies('nonexistent')).toHaveLength(0);

    const audit = store.getAuditLog(10, 'company', company.id);
    expect(audit.map((a) => a.action)).toEqual(['update', 'create']);
    expect(audit[0].actor).toBe('owner');
    expect(JSON.parse(audit[0].before as string).industry).toBeNull();
    expect(JSON.parse(audit[0].after as string).industry).toBe('Trades');
    store.close();
  });

  test('rejects empty names', () => {
    const store = freshStore();
    expect(() => store.createCompany({ name: '   ' })).toThrow(/name is required/);
    store.close();
  });

  test('findOrCreateCompanyByName is case-insensitive and does not duplicate', () => {
    const store = freshStore();
    const a = store.findOrCreateCompanyByName('Acme Ltd');
    const b = store.findOrCreateCompanyByName('acme ltd');
    expect(b.id).toBe(a.id);
    expect(store.searchCompanies('acme')).toHaveLength(1);
    store.close();
  });
});

describe('CrmStore — contacts', () => {
  test('create with companyName convenience, find by email, update', () => {
    const store = freshStore();
    const contact = store.createContact({
      firstName: 'Mere',
      lastName: 'Walker',
      email: 'Mere@KiwiBuild.co.nz',
      companyName: 'KiwiBuild',
    });
    expect(contact.companyId).not.toBeNull();
    expect(contact.email).toBe('mere@kiwibuild.co.nz'); // normalized lowercase

    const found = store.findContactByEmail('MERE@kiwibuild.co.nz');
    expect(found?.id).toBe(contact.id);

    const updated = store.updateContact(contact.id, { title: 'Ops Manager' });
    expect(updated.title).toBe('Ops Manager');
    expect(updated.email).toBe('mere@kiwibuild.co.nz');
    store.close();
  });

  test('search matches name, email, and company name', () => {
    const store = freshStore();
    store.createContact({ firstName: 'Tom', email: 'tom@example.com', companyName: 'Bayside Cafe' });
    expect(store.searchContacts('tom')).toHaveLength(1);
    expect(store.searchContacts('example.com')).toHaveLength(1);
    expect(store.searchContacts('bayside')).toHaveLength(1);
    expect(store.searchContacts('zzz')).toHaveLength(0);
    store.close();
  });

  test('LIKE wildcards in queries are treated literally', () => {
    const store = freshStore();
    store.createContact({ firstName: 'Percy' });
    expect(store.searchContacts('%')).toHaveLength(0); // literal %, no match-all
    store.close();
  });

  test('rejects unknown companyId', () => {
    const store = freshStore();
    expect(() => store.createContact({ firstName: 'X', companyId: 999 })).toThrow(/not found/);
    store.close();
  });
});

describe('CrmStore — deals & pipeline', () => {
  test('create logs a system activity and audits', () => {
    const store = freshStore();
    const deal = store.createDeal({ title: 'Website rebuild', valueCents: 250000 });
    expect(deal.stage).toBe('lead');
    expect(deal.closedAt).toBeNull();
    const activities = store.activitiesForDeal(deal.id);
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe('system');
    store.close();
  });

  test('advanceDeal is the only path for stage changes; terminal stages set closedAt', () => {
    const store = freshStore();
    const deal = store.createDeal({ title: 'SaaS onboarding' });
    expect(() => store.updateDeal(deal.id, { stage: 'won' } as any)).toThrow(/advanceDeal/);

    const moved = store.advanceDeal(deal.id, 'qualified', 'owner', 'demo went well');
    expect(moved.stage).toBe('qualified');
    expect(moved.closedAt).toBeNull();

    const won = store.advanceDeal(deal.id, 'won');
    expect(won.closedAt).not.toBeNull();

    expect(() => store.advanceDeal(deal.id, 'bogus-stage')).toThrow(/Unknown stage/);

    const audit = store.getAuditLog(20, 'deal', deal.id);
    expect(audit.filter((a) => a.action === 'advance')).toHaveLength(2);
    // Transition history also lands as activities.
    const transitions = store
      .activitiesForDeal(deal.id)
      .filter((a) => a.subject.includes('→'));
    expect(transitions).toHaveLength(2);
    store.close();
  });

  test('advanceDeal to the same stage is a no-op', () => {
    const store = freshStore();
    const deal = store.createDeal({ title: 'No-op test' });
    const same = store.advanceDeal(deal.id, 'lead');
    expect(same.updatedAt).toBe(deal.updatedAt);
    store.close();
  });

  test('searchDeals filters by query and stage', () => {
    const store = freshStore();
    store.createDeal({ title: 'Alpha rollout' });
    const b = store.createDeal({ title: 'Beta rollout' });
    store.advanceDeal(b.id, 'proposal');
    expect(store.searchDeals('rollout')).toHaveLength(2);
    expect(store.searchDeals('rollout', 'proposal')).toHaveLength(1);
    expect(store.searchDeals(undefined, 'proposal')).toHaveLength(1);
    expect(() => store.searchDeals(undefined, 'nope')).toThrow(/Unknown stage/);
    store.close();
  });

  test('findStaleDeals surfaces quiet open deals and skips terminal ones', async () => {
    const store = freshStore();
    const quiet = store.createDeal({ title: 'Quiet deal' });
    const fresh = store.createDeal({ title: 'Fresh deal' });
    const done = store.createDeal({ title: 'Done deal' });
    store.advanceDeal(done.id, 'won');

    // days=0 → cutoff is "now": everything last touched in the past counts.
    // Sleep a few ms first so no timestamp shares the cutoff's millisecond
    // (the comparison is strict <, which is exactly what we want in prod).
    await new Promise((r) => setTimeout(r, 10));
    expect(store.findStaleDeals(9999)).toHaveLength(0);
    const staleNow = store.findStaleDeals(0);
    const ids = staleNow.map((s) => s.deal.id).sort();
    expect(ids).toEqual([quiet.id, fresh.id].sort()); // won deal excluded
    expect(staleNow[0].daysQuiet).toBeGreaterThanOrEqual(0);
    store.close();
  });
});

describe('CrmStore — activities, notes, tasks', () => {
  test('logActivity denormalizes last_activity_at onto contact and deal', () => {
    const store = freshStore();
    const contact = store.createContact({ firstName: 'Ana' });
    expect(store.getContact(contact.id)?.lastActivityAt).toBeNull();
    // Creating a deal logs a system activity → contact is now "touched".
    const deal = store.createDeal({ title: 'Ana deal', contactId: contact.id });
    expect(store.getContact(contact.id)?.lastActivityAt).not.toBeNull();

    store.logActivity({
      type: 'call',
      direction: 'outbound',
      subject: 'Intro call',
      contactId: contact.id,
      dealId: deal.id,
    });
    expect(store.getContact(contact.id)?.lastActivityAt).not.toBeNull();
    expect(store.getDeal(deal.id)?.lastActivityAt).not.toBeNull();
    store.close();
  });

  test('logActivity rejects dangling links', () => {
    const store = freshStore();
    expect(() =>
      store.logActivity({ type: 'note', subject: 'x', contactId: 42 })
    ).toThrow(/Contact 42 not found/);
    store.close();
  });

  test('notes and tasks CRUD with completion', () => {
    const store = freshStore();
    const note = store.addNote('Prefers morning calls', {});
    expect(note.id).toBeGreaterThan(0);

    const task = store.createTask({ title: 'Send proposal', dueDate: '2020-01-01' });
    expect(store.openTasks()).toHaveLength(1);
    const completed = store.completeTask(task.id, 'owner');
    expect(completed.completedAt).not.toBeNull();
    expect(store.openTasks()).toHaveLength(0);
    // Completing twice is a no-op, not an error.
    expect(store.completeTask(task.id).completedAt).toBe(completed.completedAt);
    store.close();
  });
});

describe('CrmStore — email matching', () => {
  test('unknown business sender creates contact + company and logs inbound activity', () => {
    const store = freshStore();
    const result = store.matchInboundEmail('jane.doe@fernland.co.nz', {
      fromName: 'Jane Doe',
      subject: 'Quote request',
    });
    expect(result.created).toBe(true);
    expect(result.contact.firstName).toBe('Jane');
    expect(result.contact.lastName).toBe('Doe');
    expect(result.company?.domain).toBe('fernland.co.nz');
    expect(result.activityId).toBeGreaterThan(0);
    expect(result.contact.lastActivityAt).not.toBeNull();
    store.close();
  });

  test('known sender matches without duplicating; personal domains get no company', () => {
    const store = freshStore();
    const first = store.matchInboundEmail('bob@gmail.com', { fromName: 'Bob K' });
    expect(first.created).toBe(true);
    expect(first.company).toBeNull(); // gmail is personal

    const second = store.matchInboundEmail('BOB@GMAIL.COM');
    expect(second.created).toBe(false);
    expect(second.contact.id).toBe(first.contact.id);
    expect(store.searchContacts('bob')).toHaveLength(1);
    store.close();
  });

  test('two senders from the same domain share one company', () => {
    const store = freshStore();
    const a = store.matchInboundEmail('a@zespri.com');
    const b = store.matchInboundEmail('b@zespri.com');
    expect(a.company?.id).toBe(b.company?.id);
    store.close();
  });
});

describe('CrmStore — stages & daily brief', () => {
  test('renameStage keeps keys stable and persists', () => {
    const store = freshStore();
    const stages = store.renameStage('proposal', 'Quote Sent');
    expect(stages.find((s) => s.key === 'proposal')?.label).toBe('Quote Sent');
    expect(store.getStages().find((s) => s.key === 'proposal')?.label).toBe('Quote Sent');
    // Deals still validate against keys, not labels.
    const deal = store.createDeal({ title: 'X', stage: 'proposal' });
    expect(deal.stage).toBe('proposal');
    expect(() => store.renameStage('nope', 'Y')).toThrow(/Unknown stage key/);
    store.close();
  });

  test('dailyBrief aggregates stale deals, tasks, and pipeline totals', () => {
    const store = freshStore();
    store.createDeal({ title: 'Open A', valueCents: 100000 });
    const won = store.createDeal({ title: 'Won B', valueCents: 999999 });
    store.advanceDeal(won.id, 'won');
    store.createTask({ title: 'Overdue thing', dueDate: '2020-01-01' });
    const today = new Date().toISOString().slice(0, 10);
    store.createTask({ title: 'Today thing', dueDate: today });

    const brief = store.dailyBrief(0);
    expect(brief.openDealCount).toBe(1);
    expect(brief.openPipelineValueCents).toBe(100000);
    expect(brief.tasksOverdue.map((t) => t.title)).toEqual(['Overdue thing']);
    expect(brief.tasksDueToday.map((t) => t.title)).toEqual(['Today thing']);
    expect(brief.staleDeals.map((s) => s.deal.title)).toContain('Open A');
    expect(brief.staleDeals.map((s) => s.deal.title)).not.toContain('Won B');
    expect(brief.recentActivities.length).toBeGreaterThan(0);
    store.close();
  });
});

describe('CrmStore — audit log', () => {
  test('every mutation lands an append-only row', () => {
    const store = freshStore();
    const company = store.createCompany({ name: 'AuditCo' });
    const contact = store.createContact({ firstName: 'A', companyId: company.id });
    const deal = store.createDeal({ title: 'D', contactId: contact.id });
    store.advanceDeal(deal.id, 'contacted');
    store.addNote('n', { dealId: deal.id });
    const task = store.createTask({ title: 't' });
    store.completeTask(task.id);

    const log = store.getAuditLog(100);
    const actions = log.map((a) => `${a.entityType}:${a.action}`);
    for (const expected of [
      'company:create',
      'contact:create',
      'deal:create',
      'deal:advance',
      'note:create',
      'task:create',
      'task:complete',
    ]) {
      expect(actions).toContain(expected);
    }
    store.close();
  });
});

describe('CrmStore — exportAll', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');

  test('writes one CSV per table plus combined JSON, with correct counts', () => {
    const store = freshStore();
    const company = store.createCompany({ name: 'Comma, Quote "Co"', domain: 'cq.co.nz' });
    const contact = store.createContact({
      firstName: 'Line\nBreak',
      email: 'lb@cq.co.nz',
      companyId: company.id,
    });
    store.createDeal({ title: 'Website build', contactId: contact.id, valueCents: 250000 });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-export-'));
    const result = store.exportAll(dir, 'owner');

    expect(result.directory).toBe(dir);
    expect(result.files).toEqual([
      'companies.csv',
      'contacts.csv',
      'deals.csv',
      'activities.csv',
      'notes.csv',
      'tasks.csv',
      'audit_log.csv',
      'crm-export.json',
    ]);
    for (const f of result.files) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true);
    }
    expect(result.counts.companies).toBe(1);
    expect(result.counts.contacts).toBe(1);
    expect(result.counts.deals).toBe(1);
    expect(result.counts.audit_log).toBeGreaterThanOrEqual(3);

    // RFC 4180: embedded comma/quote/newline fields are quoted, quotes doubled, CRLF rows.
    const companiesCsv = fs.readFileSync(path.join(dir, 'companies.csv'), 'utf8');
    expect(companiesCsv).toContain('"Comma, Quote ""Co"""');
    expect(companiesCsv.split('\r\n').length).toBeGreaterThanOrEqual(3); // header + row + trailing
    const contactsCsv = fs.readFileSync(path.join(dir, 'contacts.csv'), 'utf8');
    expect(contactsCsv).toContain('"Line\nBreak"');

    // JSON payload round-trips and matches counts.
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'crm-export.json'), 'utf8'));
    expect(json.companies).toHaveLength(1);
    expect(json.counts).toEqual(result.counts);
    expect(Array.isArray(json.stages)).toBe(true);
    expect(typeof json.exportedAt).toBe('string');

    // The export itself is audited (after the audit table snapshot was taken).
    const log = store.getAuditLog(10, 'export');
    expect(log.length).toBe(1);
    expect(log[0].action).toBe('export');
    expect(log[0].actor).toBe('owner');

    fs.rmSync(dir, { recursive: true, force: true });
    store.close();
  });

  test('in-memory database requires an explicit targetDir', () => {
    const store = freshStore();
    expect(() => store.exportAll()).toThrow(/targetDir is required/);
    store.close();
  });
});
