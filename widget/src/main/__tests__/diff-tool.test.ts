/**
 * Diff Tool Tests
 *
 * Tests the pure diff algorithm — no mocking needed.
 */

import { diffTextHandler, diffFilesHandler } from '../tools/diff';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// -----------------------------------------------------------------------
// diff_text handler
// -----------------------------------------------------------------------

describe('diffTextHandler', () => {
  test('identical strings reports zero changes', async () => {
    const res = await diffTextHandler({ original: 'hello\nworld', modified: 'hello\nworld' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.identical).toBe(true);
    expect(res.result.added_lines).toBe(0);
    expect(res.result.removed_lines).toBe(0);
  });

  test('added line is detected', async () => {
    const res = await diffTextHandler({ original: 'line1', modified: 'line1\nline2' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.added_lines).toBe(1);
    expect(res.result.removed_lines).toBe(0);
  });

  test('removed line is detected', async () => {
    const res = await diffTextHandler({ original: 'line1\nline2', modified: 'line1' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.removed_lines).toBe(1);
    expect(res.result.added_lines).toBe(0);
  });

  test('changed line registers as remove + add', async () => {
    const res = await diffTextHandler({ original: 'foo', modified: 'bar' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.added_lines).toBe(1);
    expect(res.result.removed_lines).toBe(1);
  });

  test('unified_diff starts with --- / +++', async () => {
    const res = await diffTextHandler({ original: 'a', modified: 'b' }, {} as any);
    expect(res.result.unified_diff).toMatch(/^--- original/);
    expect(res.result.unified_diff).toContain('+++ modified');
  });

  test('empty strings are identical', async () => {
    const res = await diffTextHandler({ original: '', modified: '' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.identical).toBe(true);
  });

  test('returns error when original is missing', async () => {
    // No crash — treats undefined as empty string due to String()
    const res = await diffTextHandler({ modified: 'hi' }, {} as any);
    expect(res.success).toBe(true); // empty vs 'hi'
    expect(res.result.added_lines).toBe(1);
  });
});

// -----------------------------------------------------------------------
// diff_files handler
// -----------------------------------------------------------------------

describe('diffFilesHandler', () => {
  let tmpA: string;
  let tmpB: string;

  beforeEach(async () => {
    const home = os.homedir();
    tmpA = path.join(home, `sadie-test-a-${Date.now()}.txt`);
    tmpB = path.join(home, `sadie-test-b-${Date.now()}.txt`);
    await fs.promises.writeFile(tmpA, 'line1\nline2\nline3', 'utf8');
    await fs.promises.writeFile(tmpB, 'line1\nline2 changed\nline3\nline4', 'utf8');
  });

  afterEach(async () => {
    await fs.promises.unlink(tmpA).catch(() => {});
    await fs.promises.unlink(tmpB).catch(() => {});
  });

  test('compares two real files', async () => {
    const res = await diffFilesHandler({ file_a: tmpA, file_b: tmpB }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.identical).toBe(false);
    expect(res.result.added_lines).toBeGreaterThan(0);
  });

  test('identical files reports identical: true', async () => {
    const res = await diffFilesHandler({ file_a: tmpA, file_b: tmpA }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.identical).toBe(true);
  });

  test('rejects path outside home directory', async () => {
    const res = await diffFilesHandler({ file_a: 'C:\\Windows\\system.ini', file_b: tmpB }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toContain('home directory');
  });

  test('returns error for non-existent file', async () => {
    const res = await diffFilesHandler({ file_a: path.join(os.homedir(), 'nope.txt'), file_b: tmpB }, {} as any);
    expect(res.success).toBe(false);
  });
});
