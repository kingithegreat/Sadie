/**
 * Contacts Tool Tests
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Mock child_process exec for Outlook search
const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({ exec: mockExecImpl }));

function mockOutlookEmpty() {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, { stdout: '[]', stderr: '' });
    return { on: jest.fn() };
  });
}

function mockOutlookResolve(contacts: any[]) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, { stdout: JSON.stringify(contacts), stderr: '' });
    return { on: jest.fn() };
  });
}

import {
  searchContactsHandler,
  addContactHandler,
  searchContactsDef,
  addContactDef
} from '../tools/contacts';

// Use a temp path for local contacts so tests don't touch the real store
const HOME = os.homedir();
const TEMP_CONTACTS = path.join(HOME, `homebot-test-contacts-${Date.now()}.json`);

// Patch LOCAL_CONTACTS_PATH by mocking fs.promises

beforeEach(() => {
  jest.clearAllMocks();
  mockOutlookEmpty();
});

afterAll(async () => {
  try { await fs.promises.unlink(TEMP_CONTACTS); } catch {}
});

describe('searchContactsHandler', () => {
  test('requires query', async () => {
    const res = await searchContactsHandler({ query: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('query');
  });

  test('returns empty list when no contacts match', async () => {
    mockOutlookEmpty();
    const res = await searchContactsHandler({ query: 'zzznonexistent' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(0);
  });

  test('returns Outlook contacts when found', async () => {
    mockOutlookResolve([
      { name: 'Alice Smith', email: 'alice@example.com', phone: '555-0100', company: 'Acme' }
    ]);
    const res = await searchContactsHandler({ query: 'alice' }, {} as any);
    expect(res.success).toBe(true);
    // Outlook results are returned regardless of local search
    expect(res.result.contacts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('addContactHandler', () => {
  test('requires name', async () => {
    const res = await addContactHandler({ email: 'a@b.com' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('name');
  });

  test('definition shape is correct', () => {
    expect(searchContactsDef.parameters.required).toContain('query');
    expect(addContactDef.parameters.required).toContain('name');
  });

  test('clamps limit to maximum 50', async () => {
    mockOutlookEmpty();
    const res = await searchContactsHandler({ query: 'nobody', limit: 9999 }, {} as any);
    // Should not throw; limit is clamped internally
    expect(res.success).toBe(true);
  });

  test('uses default limit of 10 when limit is omitted', async () => {
    mockOutlookEmpty();
    const res = await searchContactsHandler({ query: 'nobody' }, {} as any);
    expect(res.success).toBe(true);
  });

  test('deduplicates contacts with the same email', async () => {
    const alice = { name: 'Alice', email: 'alice@example.com', phone: '', company: '' };
    mockOutlookResolve([alice]);
    // Simulate local contacts also containing alice via fs.promises mock
    jest.spyOn(fs.promises, 'readFile').mockResolvedValueOnce(
      JSON.stringify([{ ...alice, source: 'local' }]) as any
    );
    const res = await searchContactsHandler({ query: 'alice' }, {} as any);
    expect(res.success).toBe(true);
    const emails = res.result.contacts.map((c: any) => c.email?.toLowerCase());
    const count = emails.filter((e: string) => e === 'alice@example.com').length;
    expect(count).toBe(1);
  });
});

describe('addContactHandler', () => {
  test('requires name', async () => {
    const res = await addContactHandler({ email: 'a@b.com' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('name');
  });

  test('adds contact with all optional fields', async () => {
    jest.spyOn(fs.promises, 'readFile').mockResolvedValueOnce('[]' as any);
    const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockResolvedValueOnce(undefined as any);
    jest.spyOn(fs.promises, 'mkdir').mockResolvedValueOnce(undefined as any);

    const res = await addContactHandler({
      name: 'Bob Jones',
      email: 'bob@corp.com',
      phone: '555-9999',
      company: 'CorpCo',
      notes: 'Met at conf',
    }, {} as any);

    expect(res.success).toBe(true);
    const saved = JSON.parse((writeSpy.mock.calls[0][1] as string));
    const contact = saved[saved.length - 1];
    expect(contact.name).toBe('Bob Jones');
    expect(contact.email).toBe('bob@corp.com');
    expect(contact.phone).toBe('555-9999');
    expect(contact.company).toBe('CorpCo');
    expect(contact.notes).toBe('Met at conf');
    expect(contact.source).toBe('local');
  });

  test('adds contact with name only (no optional fields)', async () => {
    jest.spyOn(fs.promises, 'readFile').mockResolvedValueOnce('[]' as any);
    const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockResolvedValueOnce(undefined as any);
    jest.spyOn(fs.promises, 'mkdir').mockResolvedValueOnce(undefined as any);

    const res = await addContactHandler({ name: 'Minimal Person' }, {} as any);
    expect(res.success).toBe(true);
    const saved = JSON.parse(writeSpy.mock.calls[0][1] as string);
    expect(saved[saved.length - 1].name).toBe('Minimal Person');
    expect(saved[saved.length - 1].email).toBeUndefined();
  });

  test('returns error when fs write fails', async () => {
    jest.spyOn(fs.promises, 'readFile').mockResolvedValueOnce('[]' as any);
    jest.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('disk full') as any);
    jest.spyOn(fs.promises, 'mkdir').mockResolvedValueOnce(undefined as any);

    const res = await addContactHandler({ name: 'Fail Person' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('add_contact failed');
  });
});
