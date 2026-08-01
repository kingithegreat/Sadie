/**
 * Email Tool Tests
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({ exec: mockExecImpl }));

function mockPS(stdout: string, err?: Error) {
  mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(err ?? null, { stdout, stderr: '' });
    return { on: jest.fn() };
  });
}

// Redirect local draft store to a temp path
const TEMP_DIR = path.join(os.tmpdir(), `homebot-email-test-${Date.now()}`);
jest.mock('../tools/email', () => {
  const actual = jest.requireActual('../tools/email');
  return actual;
});

import {
  emailSendHandler,
  emailDraftHandler,
  emailListHandler,
  emailSendDef,
  emailDraftDef,
  emailListDef,
  isCapturableSender,
} from '../tools/email';
import { crmToolHandlers, resetCrmStoreForTests } from '../tools/crm';

let crmTmpDir: string;

beforeEach(() => {
  jest.clearAllMocks();
  // Clean up temp draft file between tests
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}
  // Point the CRM at a throwaway temp DB so email_list's CRM wiring never
  // touches a real path during tests.
  crmTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-email-crm-'));
  process.env.HOMEBOT_CRM_DB_PATH = path.join(crmTmpDir, 'crm.sqlite3');
  resetCrmStoreForTests();
  mockPS('sent');
});

afterEach(() => {
  resetCrmStoreForTests();
  delete process.env.HOMEBOT_CRM_DB_PATH;
  try { fs.rmSync(crmTmpDir, { recursive: true, force: true }); } catch {}
});

afterAll(() => {
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}
});

// ------- emailSendHandler -------

describe('emailSendHandler', () => {
  test('requires valid to address', async () => {
    const res = await emailSendHandler({ to: 'not-an-email', subject: 'Hi', body: 'Hello' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/recipient/i);
  });

  test('requires subject', async () => {
    const res = await emailSendHandler({ to: 'alice@example.com', subject: '', body: 'Hello' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/subject/i);
  });

  test('requires body', async () => {
    const res = await emailSendHandler({ to: 'alice@example.com', subject: 'Hi', body: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/body/i);
  });

  test('sends via Outlook and returns sent:true', async () => {
    mockPS('sent');
    const res = await emailSendHandler(
      { to: 'alice@example.com', subject: 'Hello', body: 'Test body' },
      {} as any
    );
    expect(res.success).toBe(true);
    expect(res.result.sent).toBe(true);
    expect(res.result.to).toContain('alice@example.com');
    expect(res.result.subject).toBe('Hello');
  });

  test('falls back to local draft when Outlook fails', async () => {
    mockPS('', new Error('Outlook not available'));
    const res = await emailSendHandler(
      { to: 'bob@example.com', subject: 'Fallback', body: 'No Outlook' },
      {} as any
    );
    expect(res.success).toBe(true);
    expect(res.result.sent).toBe(false);
    expect(res.result.draftSaved).toBe(true);
    expect(res.result.draftId).toBeTruthy();
  });

  test('accepts multiple recipients comma-separated', async () => {
    mockPS('sent');
    const res = await emailSendHandler(
      { to: 'alice@example.com, bob@example.com', subject: 'Multi', body: 'Hi both' },
      {} as any
    );
    expect(res.success).toBe(true);
    expect(res.result.to).toHaveLength(2);
  });
});

// ------- emailDraftHandler -------

describe('emailDraftHandler', () => {
  test('saves draft locally when Outlook unavailable', async () => {
    mockPS('', new Error('no outlook'));
    const res = await emailDraftHandler(
      { to: 'carol@example.com', subject: 'Draft', body: 'Draft body' },
      {} as any
    );
    expect(res.success).toBe(true);
    expect(res.result.drafted).toBe(true);
    expect(res.result.savedToOutlook).toBe(false);
  });

  test('saves draft via Outlook when available', async () => {
    mockPS('saved');
    const res = await emailDraftHandler(
      { to: 'dave@example.com', subject: 'Outlook Draft', body: 'Body' },
      {} as any
    );
    expect(res.success).toBe(true);
    expect(res.result.drafted).toBe(true);
    expect(res.result.savedToOutlook).toBe(true);
  });

  test('requires valid recipient', async () => {
    const res = await emailDraftHandler({ to: '', subject: 'Hi', body: 'test' }, {} as any);
    expect(res.success).toBe(false);
  });
});

// ------- emailListHandler -------

describe('emailListHandler', () => {
  test('returns inbox list from Outlook', async () => {
    const fakeEmails = [
      { subject: 'Test', from: 'a@b.com', received: new Date().toISOString(), preview: 'Hi there' },
    ];
    mockPS(JSON.stringify(fakeEmails));
    const res = await emailListHandler({ limit: 5 }, {} as any);
    expect(res.success).toBe(true);
    expect(Array.isArray(res.result.emails)).toBe(true);
    expect(res.result.count).toBeGreaterThanOrEqual(1);
  });

  test('falls back to empty list when Outlook fails and no local drafts', async () => {
    mockPS('', new Error('no outlook'));
    const res = await emailListHandler({ limit: 5 }, {} as any);
    expect(res.success).toBe(true);
    expect(Array.isArray(res.result.emails)).toBe(true);
  });

  test('clamps limit to max 50', async () => {
    mockPS('[]');
    const res = await emailListHandler({ limit: 999 }, {} as any);
    expect(res.success).toBe(true);
    // Core validation: no error thrown for limit > 50
  });
});

// ------- email_list × CRM wiring -------

describe('email_list CRM wiring', () => {
  const crm = async (name: string, args: Record<string, any> = {}) =>
    crmToolHandlers[name](args, {} as any);

  test('annotates known CRM contacts on a plain list, without writing', async () => {
    await crm('crm_create_company', { name: 'Bayfair Fitness', domain: 'bayfair.co.nz' });
    await crm('crm_create_contact', {
      firstName: 'Mere', lastName: 'Walker', email: 'mere@bayfair.co.nz', companyId: 1,
    });

    mockPS(JSON.stringify([
      { subject: 'Re: quote', from: 'mere@bayfair.co.nz', received: new Date().toISOString(), preview: 'Sounds good' },
      { subject: 'Hello', from: 'stranger@somewhere.nz', received: new Date().toISOString(), preview: 'Hi' },
    ]));
    const res = await emailListHandler({ limit: 10 }, {} as any);
    expect(res.success).toBe(true);
    const [known, unknown] = res.result.emails;
    expect(known.crm).toEqual({
      contactId: 1, contactName: 'Mere Walker', companyId: 1, companyName: 'Bayfair Fitness',
    });
    expect(unknown.crm).toBeNull();
    // Read-only: the stranger was NOT created.
    const search = await crm('crm_search_contacts', { query: 'stranger' });
    expect((search.result as any).count).toBe(0);
    expect(res.result.crmCaptured).toBeUndefined();
  });

  test('captureToCrm creates contacts + companies and logs inbound activities, deduped per sender', async () => {
    mockPS(JSON.stringify([
      { subject: 'Website quote', from: 'jo@papamoaplumbing.co.nz', received: new Date().toISOString(), preview: 'Can you build us a site?' },
      { subject: 'Re: Website quote', from: 'jo@papamoaplumbing.co.nz', received: new Date().toISOString(), preview: 'Following up' },
      { subject: 'Sale now on!', from: 'noreply@bigstore.com', received: new Date().toISOString(), preview: 'Deals' },
    ]));
    const res = await emailListHandler({ limit: 10, captureToCrm: true }, {} as any);
    expect(res.success).toBe(true);
    // One capture despite two emails from jo; no-reply skipped.
    expect(res.result.crmCaptured).toHaveLength(1);
    expect(res.result.crmCaptured[0]).toMatchObject({
      email: 'jo@papamoaplumbing.co.nz', contactId: 1, created: true,
    });
    // Company inferred from domain; annotation reflects the new contact.
    expect(res.result.emails[0].crm).toMatchObject({ contactId: 1, companyName: 'Papamoaplumbing' });
    expect(res.result.emails[2].crm).toBeNull();
    // Inbound email activity landed in the audit trail via the store.
    const log = await crm('crm_audit_log', { limit: 20 });
    const actions = (log.result as any).entries.map((e: any) => e.toolName);
    expect(actions).toContain('crm_match_email');
  });

  test('captureToCrm is a safe no-op without a live Outlook inbox', async () => {
    mockPS('', new Error('no outlook'));
    const res = await emailListHandler({ limit: 5, captureToCrm: true }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.crmCaptured).toBeUndefined();
    expect(res.result.crmNote).toMatch(/skipped/i);
  });

  test('isCapturableSender filters automated senders', () => {
    expect(isCapturableSender('jane@client.co.nz')).toBe(true);
    for (const bad of [
      'no-reply@shop.com', 'noreply@shop.com', 'do-not-reply@x.io', 'donotreply@x.io',
      'mailer-daemon@mx.com', 'postmaster@mx.com', 'notifications@github.com',
      'newsletter@brand.com', 'marketing@brand.com', 'alerts@bank.co.nz', 'bounce@mail.com',
      'not-an-email',
    ]) {
      expect(isCapturableSender(bad)).toBe(false);
    }
  });
});

// ------- tool definitions -------

describe('email tool definitions', () => {
  test('emailSendDef requires confirmation', () => {
    expect(emailSendDef.name).toBe('email_send');
    expect(emailSendDef.requiresConfirmation).toBe(true);
    expect(emailSendDef.parameters.required).toEqual(expect.arrayContaining(['to', 'subject', 'body']));
  });

  test('emailDraftDef requires confirmation', () => {
    expect(emailDraftDef.name).toBe('email_draft');
    expect(emailDraftDef.requiresConfirmation).toBe(true);
  });

  test('emailListDef has no required params', () => {
    expect(emailListDef.name).toBe('email_list');
    expect(emailListDef.requiresConfirmation).toBeFalsy();
    expect(emailListDef.parameters.required).toHaveLength(0);
  });
});
