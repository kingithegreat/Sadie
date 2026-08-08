import { AuditEntry } from '../crm/types';
import { diffSnapshots, renderValue, summarizeAuditEntry, summarizeAuditLog } from '../trust/activity';

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: 1,
    toolName: 'crm_update_deal',
    entityType: 'deal',
    entityId: 7,
    action: 'update',
    actor: 'homebot',
    before: null,
    after: null,
    createdAt: '2026-08-02T03:00:00.000Z',
    ...overrides,
  };
}

describe('trust/activity', () => {
  test('create summarizes with the entity name from the after snapshot', () => {
    const item = summarizeAuditEntry(
      entry({
        action: 'create',
        toolName: 'crm_create_company',
        entityType: 'company',
        after: JSON.stringify({ id: 3, name: 'Bayfair Fitness', createdAt: 'x' }),
      })
    );
    expect(item.summary).toBe('Created company “Bayfair Fitness”');
    expect(item.changes).toEqual([]);
    expect(item.source).toBe('crm');
  });

  test('update summarizes first changed field and counts the rest; noise fields excluded', () => {
    const item = summarizeAuditEntry(
      entry({
        before: JSON.stringify({ name: 'Website deal', valueCents: 450000, stage: 'lead', updatedAt: 'a' }),
        after: JSON.stringify({ name: 'Website deal', valueCents: 500000, stage: 'contacted', updatedAt: 'b' }),
      })
    );
    expect(item.changes).toHaveLength(2); // valueCents + stage, updatedAt skipped
    expect(item.changes.map((c) => c.field).sort()).toEqual(['stage', 'valueCents']);
    expect(item.summary).toMatch(/^Updated deal “Website deal”: /);
    expect(item.summary).toMatch(/\(\+1 more\)$/);
  });

  test('advance names the stage transition explicitly', () => {
    const item = summarizeAuditEntry(
      entry({
        action: 'advance',
        toolName: 'crm_advance_deal',
        before: JSON.stringify({ name: 'Website deal', stage: 'qualified' }),
        after: JSON.stringify({ name: 'Website deal', stage: 'proposal' }),
      })
    );
    expect(item.summary).toBe('Advanced deal “Website deal”: qualified → proposal');
  });

  test('delete falls back to the before snapshot for the label', () => {
    const item = summarizeAuditEntry(
      entry({
        action: 'delete',
        entityType: 'contact',
        before: JSON.stringify({ name: 'Jane Doe' }),
        after: null,
      })
    );
    expect(item.summary).toBe('Deleted contact “Jane Doe”');
  });

  test('export renders a fixed line and complete uses the task subject', () => {
    expect(summarizeAuditEntry(entry({ action: 'export', entityType: 'export', entityId: null })).summary).toBe(
      'Exported CRM data'
    );
    expect(
      summarizeAuditEntry(
        entry({ action: 'complete', entityType: 'task', after: JSON.stringify({ title: 'Send proposal' }) })
      ).summary
    ).toBe('Completed task “Send proposal”');
  });

  test('malformed JSON never throws — falls back to #id and empty diff', () => {
    const item = summarizeAuditEntry(entry({ before: '{not json', after: 'also not json' }));
    expect(item.summary).toBe('Updated deal #7');
    expect(item.changes).toEqual([]);
  });

  test('long values are truncated with an ellipsis', () => {
    const long = 'x'.repeat(200);
    expect(renderValue(long).length).toBe(60);
    expect(renderValue(long).endsWith('…')).toBe(true);
  });

  test('diffSnapshots reports cleared and newly-set fields via the — placeholder', () => {
    const changes = diffSnapshots(
      JSON.stringify({ phone: '027 555 1234', email: '' }),
      JSON.stringify({ phone: '', email: 'a@b.nz' })
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: 'phone', from: '027 555 1234', to: '—' },
        { field: 'email', from: '—', to: 'a@b.nz' },
      ])
    );
  });

  test('summarizeAuditLog maps a page preserving order', () => {
    const items = summarizeAuditLog([
      entry({ id: 9, action: 'export', entityType: 'export', entityId: null }),
      entry({ id: 8, action: 'create', entityType: 'company', after: JSON.stringify({ name: 'A' }) }),
    ]);
    expect(items.map((i) => i.id)).toEqual([9, 8]);
  });
});
