/**
 * permission-audit-log.test.ts
 * Tests for src/main/permission-audit-log.ts — the JSONL permission decision log.
 *
 * Uses HOMEBOT_PERMISSION_AUDIT_DIR to point the log at an isolated temp dir so
 * each run is deterministic and never touches real userData.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  recordPermissionDecision,
  readPermissionAudit,
  clearPermissionAudit,
  permissionAuditLogPath,
  MAX_ENTRIES,
} from '../permission-audit-log';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-audit-'));
  process.env.HOMEBOT_PERMISSION_AUDIT_DIR = dir;
});

afterEach(() => {
  delete process.env.HOMEBOT_PERMISSION_AUDIT_DIR;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('permissionAuditLogPath', () => {
  test('honours the env override and lands under logs/', () => {
    expect(permissionAuditLogPath()).toBe(path.join(dir, 'logs', 'permission-audit.log'));
  });
});

describe('record + read round trip', () => {
  test('an empty/absent log reads as []', () => {
    expect(readPermissionAudit()).toEqual([]);
  });

  test('records a decision with full context and fills id/timestamp', () => {
    recordPermissionDecision({ permissions: ['write_file'], reason: 'Save a report', decision: 'allow_once' });
    const entries = readPermissionAudit();
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.permissions).toEqual(['write_file']);
    expect(e.reason).toBe('Save a report');
    expect(e.decision).toBe('allow_once');
    expect(typeof e.id).toBe('string');
    expect(e.id.length).toBeGreaterThan(0);
    expect(new Date(e.timestamp).toString()).not.toBe('Invalid Date');
  });

  test('preserves append order and all four decision kinds', () => {
    recordPermissionDecision({ permissions: ['a'], reason: 'r1', decision: 'allow_once' });
    recordPermissionDecision({ permissions: ['b'], reason: 'r2', decision: 'always_allow' });
    recordPermissionDecision({ permissions: ['c'], reason: 'r3', decision: 'cancel' });
    recordPermissionDecision({ permissions: ['d'], reason: 'r4', decision: 'expired' });
    const decisions = readPermissionAudit().map((e) => e.decision);
    expect(decisions).toEqual(['allow_once', 'always_allow', 'cancel', 'expired']);
  });

  test('keeps streamId only when provided', () => {
    recordPermissionDecision({ permissions: ['x'], reason: 'r', decision: 'cancel', streamId: 's-1' });
    recordPermissionDecision({ permissions: ['y'], reason: 'r', decision: 'cancel' });
    const [a, b] = readPermissionAudit();
    expect(a.streamId).toBe('s-1');
    expect(b.streamId).toBeUndefined();
  });
});

describe('resilience', () => {
  test('skips malformed JSON lines but keeps valid ones', () => {
    const logPath = permissionAuditLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const good = JSON.stringify({ id: 'a', timestamp: new Date().toISOString(), permissions: ['read_file'], reason: 'ok', decision: 'allow_once' });
    fs.writeFileSync(logPath, good + '\n' + '{ not valid json' + '\n', 'utf-8');
    const entries = readPermissionAudit();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('a');
  });

  test('coerces a non-array permissions field to []', () => {
    recordPermissionDecision({ permissions: undefined as any, reason: 'r', decision: 'cancel' });
    expect(readPermissionAudit()[0].permissions).toEqual([]);
  });
});

describe('bounding', () => {
  test('never keeps more than MAX_ENTRIES, retaining the newest', () => {
    const total = MAX_ENTRIES + 25;
    for (let i = 0; i < total; i++) {
      recordPermissionDecision({ permissions: [`p${i}`], reason: String(i), decision: 'allow_once' });
    }
    const entries = readPermissionAudit();
    expect(entries).toHaveLength(MAX_ENTRIES);
    // The oldest 25 should have been trimmed; the last reason is total-1.
    expect(entries[entries.length - 1].reason).toBe(String(total - 1));
    expect(entries[0].reason).toBe(String(total - MAX_ENTRIES));
  });
});

describe('clear', () => {
  test('removes all recorded decisions', () => {
    recordPermissionDecision({ permissions: ['a'], reason: 'r', decision: 'allow_once' });
    expect(readPermissionAudit()).toHaveLength(1);
    clearPermissionAudit();
    expect(readPermissionAudit()).toEqual([]);
  });

  test('clearing an already-empty log is a safe no-op', () => {
    expect(() => clearPermissionAudit()).not.toThrow();
    expect(readPermissionAudit()).toEqual([]);
  });
});
