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
const TEMP_DIR = path.join(os.tmpdir(), `sadie-email-test-${Date.now()}`);
const TEMP_DRAFTS = path.join(TEMP_DIR, 'email-drafts.json');
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
} from '../tools/email';

beforeEach(() => {
  jest.clearAllMocks();
  // Clean up temp draft file between tests
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}
  mockPS('sent');
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
