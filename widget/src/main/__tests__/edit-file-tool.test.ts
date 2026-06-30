/**
 * edit_file & read_file line-range Tests
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Mock heavy document-generation libraries so the module loads fast
jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: '' }),
}));
jest.mock('docx', () => ({
  Document: jest.fn(), Packer: { toBuffer: jest.fn().mockResolvedValue(Buffer.from('')) },
  Paragraph: jest.fn(), TextRun: jest.fn(),
  HeadingLevel: { HEADING_1: 1, HEADING_2: 2, HEADING_3: 3 },
  Table: jest.fn(), TableRow: jest.fn(), TableCell: jest.fn(),
  WidthType: { DXA: 'DXA' }, BorderStyle: { SINGLE: 'single' }, AlignmentType: { LEFT: 'left' },
}));
jest.mock('exceljs', () => ({
  default: { Workbook: jest.fn() },
  Workbook: jest.fn().mockImplementation(() => ({
    creator: '', created: null, addWorksheet: jest.fn(() => ({
      columns: [], addRow: jest.fn(), getRow: jest.fn(() => ({ font: {} })),
    })),
    xlsx: { writeBuffer: jest.fn().mockResolvedValue(Buffer.from('')) },
  })),
}));
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const stream = new (require('stream').PassThrough)();
    return Object.assign(stream, {
      fontSize: jest.fn().mockReturnThis(), text: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(), end: jest.fn(() => stream.end()),
      pipe: jest.fn((s: any) => { stream.end(); return s; }),
    });
  });
});

import { editFileHandler, editFileDef, readFileHandler, readFileDef } from '../tools/filesystem';

const TMP = os.tmpdir();
const TEST_DIR = path.join(TMP, `homebot-edit-test-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── edit_file definition ──

describe('editFileDef', () => {
  test('has correct name and category', () => {
    expect(editFileDef.name).toBe('edit_file');
    expect(editFileDef.category).toBe('filesystem');
    expect(editFileDef.requiresConfirmation).toBe(true);
  });

  test('requires path, old_string, new_string', () => {
    expect(editFileDef.parameters.required).toContain('path');
    expect(editFileDef.parameters.required).toContain('old_string');
    expect(editFileDef.parameters.required).toContain('new_string');
  });
});

// ── edit_file handler ──

describe('editFileHandler', () => {
  const FILE = path.join(TEST_DIR, 'editable.txt');

  beforeEach(() => {
    fs.writeFileSync(FILE, [
      'line one',
      'line two',
      'line three',
      'line two again',
      'line five'
    ].join('\n'), 'utf-8');
  });

  test('replaces unique string', async () => {
    const r = await editFileHandler({
      path: FILE, old_string: 'line one', new_string: 'LINE ONE'
    }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.replacements).toBe(1);
    const content = fs.readFileSync(FILE, 'utf-8');
    expect(content).toContain('LINE ONE');
    expect(content).not.toContain('line one');
  });

  test('rejects non-unique old_string (appears twice)', async () => {
    const r = await editFileHandler({
      path: FILE, old_string: 'line two', new_string: 'LINE TWO'
    }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('2 times');
  });

  test('replace_all replaces all occurrences', async () => {
    const r = await editFileHandler({
      path: FILE, old_string: 'line two', new_string: 'LINE TWO', replace_all: true
    }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.replacements).toBe(2);
    const content = fs.readFileSync(FILE, 'utf-8');
    expect(content).not.toContain('line two');
    expect(content.match(/LINE TWO/g)!.length).toBe(2);
  });

  test('rejects when old_string not found', async () => {
    const r = await editFileHandler({
      path: FILE, old_string: 'nonexistent text', new_string: 'replacement'
    }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('not found');
  });

  test('shows nearby lines hint on miss', async () => {
    const r = await editFileHandler({
      path: FILE, old_string: 'line xxx', new_string: 'replacement'
    }, {} as any);
    expect(r.success).toBe(false);
    // Should find "line" in nearby lines as a hint
    expect(r.error).toContain('line');
  });

  test('rejects identical old_string and new_string', async () => {
    const r = await editFileHandler({
      path: FILE, old_string: 'line one', new_string: 'line one'
    }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('identical');
  });

  test('rejects empty old_string', async () => {
    const r = await editFileHandler({
      path: FILE, old_string: '', new_string: 'stuff'
    }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('required');
  });

  test('rejects non-existent file', async () => {
    const r = await editFileHandler({
      path: path.join(TEST_DIR, 'nope.txt'), old_string: 'a', new_string: 'b'
    }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('not found');
  });

  test('rejects path outside home directory', async () => {
    const r = await editFileHandler({
      path: '/usr/bin/bash', old_string: 'a', new_string: 'b'
    }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('home directory');
  });

  test('preserves multiline content', async () => {
    const multilineFile = path.join(TEST_DIR, 'multi.txt');
    fs.writeFileSync(multilineFile, 'function foo() {\n  return 1;\n}\n', 'utf-8');
    const r = await editFileHandler({
      path: multilineFile,
      old_string: 'function foo() {\n  return 1;\n}',
      new_string: 'function foo() {\n  return 42;\n}'
    }, {} as any);
    expect(r.success).toBe(true);
    const content = fs.readFileSync(multilineFile, 'utf-8');
    expect(content).toContain('return 42;');
  });

  test('returns correct metadata', async () => {
    const r = await editFileHandler({
      path: FILE, old_string: 'line one', new_string: 'LINE ONE REPLACED'
    }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.path).toBe(FILE);
    expect(r.result.old_length).toBe('line one'.length);
    expect(r.result.new_length).toBe('LINE ONE REPLACED'.length);
    expect(r.result.file_lines).toBeGreaterThan(0);
  });
});

// ── read_file line ranges ──

describe('readFileHandler line ranges', () => {
  const FILE = path.join(TEST_DIR, 'lines.txt');

  beforeAll(() => {
    // Create a 20-line file
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1} content`);
    fs.writeFileSync(FILE, lines.join('\n'), 'utf-8');
  });

  test('reads specific line range', async () => {
    const r = await readFileHandler({ path: FILE, start_line: 5, end_line: 10 }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.start_line).toBe(5);
    expect(r.result.end_line).toBe(10);
    expect(r.result.content).toContain('5: line 5 content');
    expect(r.result.content).toContain('10: line 10 content');
    expect(r.result.content).not.toContain('4: ');
    expect(r.result.content).not.toContain('11: ');
  });

  test('defaults end_line to start_line + 99', async () => {
    const r = await readFileHandler({ path: FILE, start_line: 1 }, {} as any);
    expect(r.success).toBe(true);
    // File has 20 lines, so end_line should be capped at 20
    expect(r.result.end_line).toBe(20);
    expect(r.result.content).toContain('1: line 1 content');
    expect(r.result.content).toContain('20: line 20 content');
  });

  test('rejects start_line beyond file length', async () => {
    const r = await readFileHandler({ path: FILE, start_line: 999 }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('exceeds file length');
  });

  test('clamps end_line to file length', async () => {
    const r = await readFileHandler({ path: FILE, start_line: 18, end_line: 100 }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.end_line).toBe(20);
  });

  test('returns totalLines and truncated flag', async () => {
    const r = await readFileHandler({ path: FILE, start_line: 1, end_line: 5 }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.totalLines).toBe(20);
    expect(r.result.truncated).toBe(true);
  });

  test('truncated is false when reading to end', async () => {
    const r = await readFileHandler({ path: FILE, start_line: 1, end_line: 20 }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.truncated).toBe(false);
  });

  test('lines are numbered in output', async () => {
    const r = await readFileHandler({ path: FILE, start_line: 10, end_line: 12 }, {} as any);
    expect(r.success).toBe(true);
    const outputLines = r.result.content.split('\n');
    expect(outputLines[0]).toMatch(/^10: /);
    expect(outputLines[1]).toMatch(/^11: /);
    expect(outputLines[2]).toMatch(/^12: /);
  });

  test('start_line clamped to 1 minimum', async () => {
    const r = await readFileHandler({ path: FILE, start_line: -5, end_line: 3 }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.start_line).toBe(1);
  });

  test('still works with maxLines when no start_line', async () => {
    const r = await readFileHandler({ path: FILE, maxLines: 5 }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.content.split('\n').length).toBe(5);
    expect(r.result.truncated).toBe(true);
  });
});

// ── readFileDef definition ──

describe('readFileDef', () => {
  test('has start_line and end_line params', () => {
    expect(readFileDef.parameters.properties).toHaveProperty('start_line');
    expect(readFileDef.parameters.properties).toHaveProperty('end_line');
  });

  test('description mentions line ranges', () => {
    expect(readFileDef.description).toContain('line range');
  });
});
