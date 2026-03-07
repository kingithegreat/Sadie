/**
 * filesystem.test.ts
 * Tests for src/main/tools/filesystem.ts
 *
 * Uses real fs operations against a temp directory under os.tmpdir()
 * (which is under HOME_DIR on Windows: C:\Users\<user>\AppData\Local\Temp)
 */

// Mock heavy document-generation libraries so the module loads fast
jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'docx line1\ndocx line2\ndocx line3' }),
}));
jest.mock('docx', () => ({
  Document: jest.fn(),
  Packer: { toBuffer: jest.fn().mockResolvedValue(Buffer.from('DOCX')) },
  Paragraph: jest.fn(),
  TextRun: jest.fn(),
  HeadingLevel: { HEADING_1: 1, HEADING_2: 2, HEADING_3: 3 },
  Table: jest.fn(),
  TableRow: jest.fn(),
  TableCell: jest.fn(),
  WidthType: { DXA: 'DXA' },
  BorderStyle: { SINGLE: 'single' },
  AlignmentType: { LEFT: 'left' },
}));
jest.mock('exceljs', () => ({
  default: { Workbook: jest.fn() },
  Workbook: jest.fn().mockImplementation(() => ({
    creator: '',
    created: null,
    addWorksheet: jest.fn().mockReturnValue({
      addRow: jest.fn().mockReturnValue({ eachCell: jest.fn() }),
      columns: [],
    }),
    xlsx: { writeFile: jest.fn().mockResolvedValue(undefined) },
  })),
}));
jest.mock('pdfkit', () =>
  jest.fn().mockImplementation(() => ({
    fontSize: jest.fn().mockReturnThis(),
    font: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    moveDown: jest.fn().mockReturnThis(),
    end: jest.fn(),
    pipe: jest.fn(),
  }))
);

import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  resolveUserPath,
  listDirectoryHandler,
  readFileHandler,
  createDirectoryHandler,
  writeFileHandler,
  deleteFileHandler,
  moveFileHandler,
  copyFileHandler,
  getFileInfoHandler,
  searchFilesHandler,
} from '../tools/filesystem';

// All test files live inside os.tmpdir() which is under HOME_DIR on Windows
let tmpDir: string;

beforeAll(() => {
  tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'sadie-fs-test-'));
});

afterAll(() => {
  try { fsSync.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Helper: absolute path under tmpDir */
const p = (...parts: string[]) => path.join(tmpDir, ...parts);

// ─── resolveUserPath ─────────────────────────────────────────────────────────

describe('resolveUserPath', () => {
  test('returns an absolute path for a valid absolute input', () => {
    const resolved = resolveUserPath(tmpDir);
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(path.resolve(tmpDir));
  });

  test('resolves ~ to user home directory', () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const resolved = resolveUserPath('~');
    expect(resolved).toBe(path.resolve(homeDir));
  });

  test('resolves ~/subpath to home + subpath', () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const resolved = resolveUserPath('~/testfile.txt');
    expect(resolved).toBe(path.resolve(path.join(homeDir, 'testfile.txt')));
  });

  test('returns non-home path unchanged (not validated here)', () => {
    // resolveUserPath only returns the resolved value; it does NOT enforce security
    const resolved = resolveUserPath(tmpDir);
    expect(resolved.length).toBeGreaterThan(0);
  });
});

// ─── listDirectoryHandler ────────────────────────────────────────────────────

describe('listDirectoryHandler', () => {
  test('returns error for empty path', async () => {
    const res = await listDirectoryHandler({ path: '' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/path|required/i);
  });

  test('returns access denied for path outside home', async () => {
    const res = await listDirectoryHandler({ path: 'C:\\Windows\\System32' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('returns entries for a valid directory', async () => {
    const subDir = p('list-basic');
    fsSync.mkdirSync(subDir, { recursive: true });
    fsSync.writeFileSync(path.join(subDir, 'visible.txt'), 'hello');
    fsSync.writeFileSync(path.join(subDir, '.hidden'), 'secret');

    const res = await listDirectoryHandler({ path: subDir }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.entries.some((e: any) => e.name === 'visible.txt')).toBe(true);
    // Hidden excluded by default
    expect(res.result.entries.some((e: any) => e.name === '.hidden')).toBe(false);
  });

  test('includes hidden files when showHidden=true', async () => {
    const subDir = p('list-hidden');
    fsSync.mkdirSync(subDir, { recursive: true });
    fsSync.writeFileSync(path.join(subDir, '.hidden'), 'secret');

    const res = await listDirectoryHandler({ path: subDir, showHidden: true }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.entries.some((e: any) => e.name === '.hidden')).toBe(true);
  });

  test('returns error for non-existent directory', async () => {
    const res = await listDirectoryHandler({ path: p('nonexistent-dir-xyz123') }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Failed to list/i);
  });

  test('sorts directories before files', async () => {
    const subDir = p('list-sort');
    fsSync.mkdirSync(path.join(subDir, 'aFolder'), { recursive: true });
    fsSync.writeFileSync(path.join(subDir, 'aFile.txt'), 'content');

    const res = await listDirectoryHandler({ path: subDir }, {} as any);
    expect(res.success).toBe(true);
    const entries = res.result.entries as Array<{ type: string }>;
    expect(entries[0].type).toBe('directory');
    expect(entries[1].type).toBe('file');
  });

  test('includes directory type in result', async () => {
    const subDir = p('list-types');
    fsSync.mkdirSync(path.join(subDir, 'sub'), { recursive: true });
    fsSync.writeFileSync(path.join(subDir, 'file.txt'), 'x');

    const res = await listDirectoryHandler({ path: subDir }, {} as any);
    expect(res.success).toBe(true);
    const dir = res.result.entries.find((e: any) => e.name === 'sub');
    const file = res.result.entries.find((e: any) => e.name === 'file.txt');
    expect(dir?.type).toBe('directory');
    expect(dir?.size).toBeNull();
    expect(file?.type).toBe('file');
    expect(typeof file?.size).toBe('number');
  });
});

// ─── readFileHandler ─────────────────────────────────────────────────────────

describe('readFileHandler', () => {
  test('returns error for empty path', async () => {
    const res = await readFileHandler({ path: '' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('returns error when target is a directory', async () => {
    const subDir = p('read-dir-test');
    fsSync.mkdirSync(subDir, { recursive: true });

    const res = await readFileHandler({ path: subDir }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/directory/i);
  });

  test('reads text file successfully', async () => {
    const filePath = p('readable.txt');
    fsSync.writeFileSync(filePath, 'Hello, world!\nLine 2\nLine 3');

    const res = await readFileHandler({ path: filePath }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.content).toContain('Hello, world!');
    expect(res.result.totalLines).toBe(3);
    expect(res.result.truncated).toBe(false);
  });

  test('truncates file at custom maxLines', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const filePath = p('big-text.txt');
    fsSync.writeFileSync(filePath, lines);

    const res = await readFileHandler({ path: filePath, maxLines: 5 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.truncated).toBe(true);
    expect(res.result.content.split('\n').length).toBe(5);
  });

  test('returns error for file exceeding 5 MB', async () => {
    const filePath = p('fake-large.bin');
    fsSync.writeFileSync(filePath, 'x');

    jest.spyOn(fsSync.promises, 'stat').mockResolvedValueOnce({
      isDirectory: () => false,
      size: 6 * 1024 * 1024,
    } as any);

    const res = await readFileHandler({ path: filePath }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/too large/i);
  });

  test('reads .docx file via mammoth and returns format flag', async () => {
    const filePath = p('doc.docx');
    fsSync.writeFileSync(filePath, Buffer.from('fake docx bytes'));

    const res = await readFileHandler({ path: filePath }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.format).toBe('docx');
    expect(res.result.content).toContain('docx line1');
  });

  test('.docx truncates at maxLines', async () => {
    const filePath = p('bigdoc.docx');
    fsSync.writeFileSync(filePath, Buffer.from('fake docx'));
    // mammoth already mocked to return 3 lines; request fewer
    const res = await readFileHandler({ path: filePath, maxLines: 2 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.truncated).toBe(true);
    expect(res.result.content.split('\n').length).toBe(2);
  });
});

// ─── writeFileHandler ────────────────────────────────────────────────────────

describe('writeFileHandler', () => {
  test('returns error for empty path', async () => {
    const res = await writeFileHandler({ path: '', content: 'hello' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('writes a new file', async () => {
    const filePath = p('newfile.txt');
    const res = await writeFileHandler({ path: filePath, content: 'hello world' }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.readFileSync(filePath, 'utf-8')).toBe('hello world');
    expect(res.result.message).toMatch(/written/i);
  });

  test('overwrites existing file by default', async () => {
    const filePath = p('overwrite.txt');
    fsSync.writeFileSync(filePath, 'old content');

    const res = await writeFileHandler({ path: filePath, content: 'new content' }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.readFileSync(filePath, 'utf-8')).toBe('new content');
  });

  test('appends to file when append=true', async () => {
    const filePath = p('appendable.txt');
    fsSync.writeFileSync(filePath, 'first');

    const res = await writeFileHandler({ path: filePath, content: ' second', append: true }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.readFileSync(filePath, 'utf-8')).toBe('first second');
    expect(res.result.message).toMatch(/appended/i);
  });

  test('reports correct byte size in result', async () => {
    const filePath = p('sized.txt');
    const content = 'abc';
    const res = await writeFileHandler({ path: filePath, content }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.size).toBe(Buffer.byteLength(content, 'utf-8'));
  });

  test('creates parent directory when it does not exist', async () => {
    const filePath = p('deep-new', 'sub', 'file.txt');
    const res = await writeFileHandler({ path: filePath, content: 'nested' }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.existsSync(filePath)).toBe(true);
  });
});

// ─── createDirectoryHandler ──────────────────────────────────────────────────

describe('createDirectoryHandler', () => {
  test('returns error for empty path', async () => {
    const res = await createDirectoryHandler({ path: '' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('creates a new directory and reports alreadyExisted=false', async () => {
    const newDir = p('brand-new-dir');
    expect(fsSync.existsSync(newDir)).toBe(false);

    const res = await createDirectoryHandler({ path: newDir }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.alreadyExisted).toBe(false);
    expect(fsSync.existsSync(newDir)).toBe(true);
  });

  test('succeeds when directory already exists (non-root) with alreadyExisted=true', async () => {
    const existingDir = p('already-exists-dir');
    fsSync.mkdirSync(existingDir, { recursive: true });

    const res = await createDirectoryHandler({ path: existingDir }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.alreadyExisted).toBe(true);
  });

  test('returns error with helpful message when ~ already exists (root dir confusion)', async () => {
    // ~ expands to HOME_DIR which is a protected root dir that always exists
    const res = await createDirectoryHandler({ path: '~' }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already exists/i);
  });
});

// ─── deleteFileHandler ───────────────────────────────────────────────────────

describe('deleteFileHandler', () => {
  test('returns error for empty path', async () => {
    const res = await deleteFileHandler({ path: '' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('deletes a file', async () => {
    const filePath = p('to-delete.txt');
    fsSync.writeFileSync(filePath, 'bye');

    const res = await deleteFileHandler({ path: filePath }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.existsSync(filePath)).toBe(false);
  });

  test('deletes an empty directory (non-recursive)', async () => {
    const dirPath = p('empty-del-dir');
    fsSync.mkdirSync(dirPath, { recursive: true });

    const res = await deleteFileHandler({ path: dirPath }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.existsSync(dirPath)).toBe(false);
  });

  test('deletes a directory recursively', async () => {
    const dirPath = p('recursive-del');
    fsSync.mkdirSync(path.join(dirPath, 'nested'), { recursive: true });
    fsSync.writeFileSync(path.join(dirPath, 'nested', 'file.txt'), 'content');

    const res = await deleteFileHandler({ path: dirPath, recursive: true }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.existsSync(dirPath)).toBe(false);
  });

  test('returns error for non-existent path', async () => {
    const res = await deleteFileHandler({ path: p('nonexistent-xyz.txt') }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Failed to delete/i);
  });
});

// ─── moveFileHandler ─────────────────────────────────────────────────────────

describe('moveFileHandler', () => {
  test('returns error for empty source path', async () => {
    const res = await moveFileHandler({ source: '', destination: p('dest.txt') }, {} as any);
    expect(res.success).toBe(false);
  });

  test('returns error for empty destination path', async () => {
    const srcFile = p('move-src-empty-dest.txt');
    fsSync.writeFileSync(srcFile, 'data');
    const res = await moveFileHandler({ source: srcFile, destination: '' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('moves file successfully', async () => {
    const src = p('move-src.txt');
    const dest = p('move-dest.txt');
    fsSync.writeFileSync(src, 'move me');

    const res = await moveFileHandler({ source: src, destination: dest }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.existsSync(dest)).toBe(true);
    expect(fsSync.existsSync(src)).toBe(false);
    expect(fsSync.readFileSync(dest, 'utf-8')).toBe('move me');
  });

  test('returns error when source does not exist', async () => {
    const res = await moveFileHandler({ source: p('no-such-file.txt'), destination: p('moved.txt') }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Failed to move/i);
  });
});

// ─── copyFileHandler ─────────────────────────────────────────────────────────

describe('copyFileHandler', () => {
  test('returns error for empty source path', async () => {
    const res = await copyFileHandler({ source: '', destination: p('copy-dest.txt') }, {} as any);
    expect(res.success).toBe(false);
  });

  test('returns error when source does not exist', async () => {
    const res = await copyFileHandler({ source: p('no-such.txt'), destination: p('copy-out.txt') }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Failed to copy/i);
  });

  test('copies a file, preserving source', async () => {
    const src = p('copy-src.txt');
    const dest = p('copy-out.txt');
    fsSync.writeFileSync(src, 'copy me');

    const res = await copyFileHandler({ source: src, destination: dest }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.readFileSync(dest, 'utf-8')).toBe('copy me');
    expect(fsSync.existsSync(src)).toBe(true);
  });

  test('copies a directory recursively', async () => {
    const srcDir = p('copy-dir-src');
    const destDir = p('copy-dir-dest');
    fsSync.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
    fsSync.writeFileSync(path.join(srcDir, 'sub', 'inner.txt'), 'deep content');

    const res = await copyFileHandler({ source: srcDir, destination: destDir }, {} as any);
    expect(res.success).toBe(true);
    expect(fsSync.readFileSync(path.join(destDir, 'sub', 'inner.txt'), 'utf-8')).toBe('deep content');
  });
});

// ─── getFileInfoHandler ──────────────────────────────────────────────────────

describe('getFileInfoHandler', () => {
  test('returns error for empty path', async () => {
    const res = await getFileInfoHandler({ path: '' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('returns info for a file', async () => {
    const filePath = p('info-file.txt');
    fsSync.writeFileSync(filePath, 'some content');

    const res = await getFileInfoHandler({ path: filePath }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.type).toBe('file');
    expect(res.result.size).toBe(12);
    expect(res.result.modified).toBeTruthy();
    expect(typeof res.result.isReadOnly).toBe('boolean');
  });

  test('returns info for a directory', async () => {
    const dirPath = p('info-dir');
    fsSync.mkdirSync(dirPath, { recursive: true });

    const res = await getFileInfoHandler({ path: dirPath }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.type).toBe('directory');
  });

  test('returns error for non-existent path', async () => {
    const res = await getFileInfoHandler({ path: p('nonexistent-info.xyz') }, {} as any);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Failed to get file info/i);
  });

  test('result includes name, created, accessed timestamps', async () => {
    const filePath = p('timestamps.txt');
    fsSync.writeFileSync(filePath, 'ts');

    const res = await getFileInfoHandler({ path: filePath }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.name).toBe('timestamps.txt');
    expect(res.result.created).toBeTruthy();
    expect(res.result.accessed).toBeTruthy();
  });
});

// ─── searchFilesHandler ──────────────────────────────────────────────────────

describe('searchFilesHandler', () => {
  test('returns error for path outside home', async () => {
    const res = await searchFilesHandler({ directory: 'C:\\Windows' }, {} as any);
    expect(res.success).toBe(false);
  });

  test('searches by filename pattern', async () => {
    const searchDir = p('search-pattern');
    fsSync.mkdirSync(searchDir, { recursive: true });
    fsSync.writeFileSync(path.join(searchDir, 'match.txt'), 'content');
    fsSync.writeFileSync(path.join(searchDir, 'nope.json'), '{}');

    const res = await searchFilesHandler({ directory: searchDir, filename_pattern: '*.txt' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.results.some((r: any) => r.file.endsWith('match.txt'))).toBe(true);
    expect(res.result.results.every((r: any) => !r.file.endsWith('nope.json'))).toBe(true);
  });

  test('searches by content query', async () => {
    const searchDir = p('search-content');
    fsSync.mkdirSync(searchDir, { recursive: true });
    fsSync.writeFileSync(path.join(searchDir, 'hit.txt'), 'the needle is here\nline 2');
    fsSync.writeFileSync(path.join(searchDir, 'miss.txt'), 'nothing relevant here');

    const res = await searchFilesHandler({ directory: searchDir, content_query: 'needle' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.results.some((r: any) => r.file.endsWith('hit.txt'))).toBe(true);
    expect(res.result.results.every((r: any) => !r.file.endsWith('miss.txt'))).toBe(true);
  });

  test('returns empty result when no files match pattern', async () => {
    const searchDir = p('search-nomatch');
    fsSync.mkdirSync(searchDir, { recursive: true });

    const res = await searchFilesHandler({ directory: searchDir, filename_pattern: '*.xyz' }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBe(0);
  });

  test('respects max_results limit', async () => {
    const searchDir = p('search-limit');
    fsSync.mkdirSync(searchDir, { recursive: true });
    for (let i = 0; i < 10; i++) {
      fsSync.writeFileSync(path.join(searchDir, `file${i}.txt`), 'data');
    }

    const res = await searchFilesHandler({ directory: searchDir, max_results: 3 }, {} as any);
    expect(res.success).toBe(true);
    expect(res.result.count).toBeLessThanOrEqual(3);
  });

  test('content search result includes line numbers and text', async () => {
    const searchDir = p('search-lines');
    fsSync.mkdirSync(searchDir, { recursive: true });
    fsSync.writeFileSync(path.join(searchDir, 'data.txt'), 'line one\nhas the keyword\nline three');

    const res = await searchFilesHandler({ directory: searchDir, content_query: 'keyword' }, {} as any);
    expect(res.success).toBe(true);
    const match = res.result.results[0];
    expect(match.matches).toBeDefined();
    expect(match.matches[0].line).toBe(2);
    expect(match.matches[0].text).toContain('keyword');
  });
});
