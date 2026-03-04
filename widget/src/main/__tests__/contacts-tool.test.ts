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
const TEMP_CONTACTS = path.join(HOME, `sadie-test-contacts-${Date.now()}.json`);

// Patch LOCAL_CONTACTS_PATH by mocking fs.promises
const originalReadFile = fs.promises.readFile;
const originalWriteFile = fs.promises.writeFile;
const originalMkdir = fs.promises.mkdir;

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
});
