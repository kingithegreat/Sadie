/**
 * Codebase Tool Tests
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Mock child_process for ripgrep
const mockExecImpl = jest.fn();
jest.mock('child_process', () => ({
  exec: mockExecImpl,
  execFile: jest.fn()
}));

import {
  grepCodeHandler,
  grepCodeDef,
  projectTreeHandler,
  projectTreeDef,
  analyzeFileHandler,
  analyzeFileDef
} from '../tools/codebase';

const HOME = os.homedir();
const TMP = os.tmpdir();

// Create a temp project structure for testing
const TEST_DIR = path.join(TMP, `sadie-codebase-test-${Date.now()}`);
const SRC_DIR = path.join(TEST_DIR, 'src');
const SUB_DIR = path.join(SRC_DIR, 'utils');

beforeAll(() => {
  fs.mkdirSync(SUB_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'node_modules', 'fake'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, '.github'), { recursive: true });

  fs.writeFileSync(path.join(TEST_DIR, 'package.json'), '{"name":"test"}', 'utf-8');
  fs.writeFileSync(path.join(SRC_DIR, 'index.ts'), [
    'import { helper } from "./utils/helper";',
    '',
    'export function main(): void {',
    '  // TODO: implement',
    '  console.log("hello");',
    '  helper();',
    '}',
    '',
    'export const VERSION = "1.0.0";'
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(SUB_DIR, 'helper.ts'), [
    '/**',
    ' * Helper utilities',
    ' */',
    '',
    'export function helper(): string {',
    '  return "helped";',
    '}',
    '',
    'export function formatDate(d: Date): string {',
    '  return d.toISOString();',
    '}'
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(TEST_DIR, '.github', 'workflows.yml'), 'name: CI\non: push', 'utf-8');
  fs.writeFileSync(path.join(TEST_DIR, 'node_modules', 'fake', 'index.js'), 'module.exports = {}', 'utf-8');
  fs.writeFileSync(path.join(TEST_DIR, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

beforeEach(() => jest.clearAllMocks());

// ── Tool Definitions ──

describe('tool definitions', () => {
  test('grep_code definition', () => {
    expect(grepCodeDef.name).toBe('grep_code');
    expect(grepCodeDef.category).toBe('utility');
    expect(grepCodeDef.parameters.required).toContain('pattern');
  });

  test('project_tree definition', () => {
    expect(projectTreeDef.name).toBe('project_tree');
    expect(projectTreeDef.parameters.required).toEqual([]);
  });

  test('analyze_file definition', () => {
    expect(analyzeFileDef.name).toBe('analyze_file');
    expect(analyzeFileDef.parameters.required).toContain('file_path');
  });
});

// ── grep_code ──

describe('grepCodeHandler', () => {
  // Force ripgrep to fail so Node fallback is used (deterministic in tests)
  beforeEach(() => {
    mockExecImpl.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (callback) callback(new Error('rg not found'), null);
      return { on: jest.fn() };
    });
  });

  test('rejects empty pattern', async () => {
    const r = await grepCodeHandler({ pattern: '' }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('required');
  });

  test('rejects path outside home', async () => {
    const r = await grepCodeHandler({ pattern: 'test', directory: '/usr/bin' }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('home directory');
  });

  test('finds matches with Node fallback', async () => {
    const r = await grepCodeHandler({ pattern: 'TODO', directory: TEST_DIR }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.match_count).toBeGreaterThan(0);
    const match = r.result.matches[0];
    expect(match.text).toContain('TODO');
    expect(match.line).toBe(4);
    expect(match.file).toContain('index.ts');
  });

  test('respects file_pattern filter', async () => {
    // Write a .js file to test filtering
    fs.writeFileSync(path.join(SRC_DIR, 'temp.js'), '// TODO in js', 'utf-8');
    try {
      const r = await grepCodeHandler({ pattern: 'TODO', directory: TEST_DIR, file_pattern: '*.ts' }, {} as any);
      expect(r.success).toBe(true);
      // Should only find the .ts file match, not .js
      const files = r.result.matches.map((m: any) => m.file);
      expect(files.every((f: string) => f.endsWith('.ts'))).toBe(true);
    } finally {
      fs.unlinkSync(path.join(SRC_DIR, 'temp.js'));
    }
  });

  test('case-insensitive by default', async () => {
    const r = await grepCodeHandler({ pattern: 'todo', directory: TEST_DIR }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.match_count).toBeGreaterThan(0);
  });

  test('case-sensitive when specified', async () => {
    const r = await grepCodeHandler({ pattern: 'todo', directory: TEST_DIR, case_sensitive: true }, {} as any);
    expect(r.success).toBe(true);
    // "TODO" is uppercase in the file, "todo" lowercase search should miss
    expect(r.result.match_count).toBe(0);
  });

  test('skips node_modules', async () => {
    const r = await grepCodeHandler({ pattern: 'module.exports', directory: TEST_DIR }, {} as any);
    expect(r.success).toBe(true);
    // Should NOT find the file inside node_modules
    const files = r.result.matches.map((m: any) => m.file);
    expect(files.every((f: string) => !f.includes('node_modules'))).toBe(true);
  });

  test('skips binary files', async () => {
    const r = await grepCodeHandler({ pattern: 'PNG', directory: TEST_DIR }, {} as any);
    expect(r.success).toBe(true);
    const files = r.result.matches.map((m: any) => m.file);
    expect(files.every((f: string) => !f.endsWith('.png'))).toBe(true);
  });

  test('handles invalid regex gracefully', async () => {
    const r = await grepCodeHandler({ pattern: '(unclosed', directory: TEST_DIR }, {} as any);
    // Should not crash — falls back to literal string match
    expect(r.success).toBe(true);
  });

  test('returns context lines when requested', async () => {
    const r = await grepCodeHandler({ pattern: 'TODO', directory: TEST_DIR, context_lines: 1 }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.matches[0].context).toBeDefined();
    expect(r.result.matches[0].context.length).toBeGreaterThan(0);
  });

  test('respects max_results limit', async () => {
    const r = await grepCodeHandler({ pattern: '\\w', directory: TEST_DIR, max_results: 2 }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.match_count).toBeLessThanOrEqual(2);
  });
});

// ── project_tree ──

describe('projectTreeHandler', () => {
  test('returns tree structure', async () => {
    const r = await projectTreeHandler({ directory: TEST_DIR }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.tree).toContain('src/');
    expect(r.result.tree).toContain('package.json');
    expect(r.result.total_items).toBeGreaterThan(0);
  });

  test('skips node_modules in tree', async () => {
    const r = await projectTreeHandler({ directory: TEST_DIR }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.tree).not.toContain('node_modules');
  });

  test('shows .github (not in SKIP_DIRS)', async () => {
    const r = await projectTreeHandler({ directory: TEST_DIR }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.tree).toContain('.github');
  });

  test('directory-only mode', async () => {
    const r = await projectTreeHandler({ directory: TEST_DIR, show_files: false }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.tree).toContain('src/');
    expect(r.result.tree).not.toContain('package.json');
  });

  test('file_pattern filter', async () => {
    const r = await projectTreeHandler({ directory: TEST_DIR, file_pattern: '*.ts' }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.tree).toContain('index.ts');
    expect(r.result.tree).not.toContain('package.json');
  });

  test('max_depth limits traversal', async () => {
    const r = await projectTreeHandler({ directory: TEST_DIR, max_depth: 1 }, {} as any);
    expect(r.success).toBe(true);
    // Should show src/ dir but not its contents
    expect(r.result.tree).toContain('src/');
    expect(r.result.tree).not.toContain('helper.ts');
  });

  test('max_items caps output size', async () => {
    const full = await projectTreeHandler({ directory: TEST_DIR, max_items: 500 }, {} as any);
    const capped = await projectTreeHandler({ directory: TEST_DIR, max_items: 10 }, {} as any);
    expect(full.success).toBe(true);
    expect(capped.success).toBe(true);
    // Capped should have equal or fewer items
    expect(capped.result.total_items).toBeLessThanOrEqual(full.result.total_items);
  });

  test('rejects path outside home', async () => {
    const r = await projectTreeHandler({ directory: '/usr/bin' }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('home directory');
  });
});

// ── analyze_file ──

describe('analyzeFileHandler', () => {
  test('analyzes TypeScript file', async () => {
    const r = await analyzeFileHandler({ file_path: path.join(SRC_DIR, 'index.ts') }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.language).toBe('TypeScript');
    expect(r.result.lines).toBeGreaterThan(0);
    expect(r.result.imports.length).toBeGreaterThan(0);
    expect(r.result.imports[0]).toContain('import');
    expect(r.result.exports.length).toBeGreaterThan(0);
    expect(r.result.symbols).toBeDefined();
    expect(r.result.symbols.some((s: string) => s.includes('main'))).toBe(true);
  });

  test('extracts first comment block', async () => {
    const r = await analyzeFileHandler({ file_path: path.join(SUB_DIR, 'helper.ts') }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.first_comment).toContain('Helper utilities');
  });

  test('detects multiple exports and functions', async () => {
    const r = await analyzeFileHandler({ file_path: path.join(SUB_DIR, 'helper.ts') }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.exports.length).toBe(2);
    expect(r.result.symbols.some((s: string) => s.includes('helper'))).toBe(true);
    expect(r.result.symbols.some((s: string) => s.includes('formatDate'))).toBe(true);
  });

  test('rejects empty path', async () => {
    const r = await analyzeFileHandler({ file_path: '' }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('required');
  });

  test('rejects path outside home', async () => {
    const r = await analyzeFileHandler({ file_path: '/usr/bin/bash' }, {} as any);
    expect(r.success).toBe(false);
    expect(r.error).toContain('home directory');
  });

  test('rejects non-existent file', async () => {
    const r = await analyzeFileHandler({ file_path: path.join(TEST_DIR, 'nope.ts') }, {} as any);
    expect(r.success).toBe(false);
  });

  test('returns size_bytes', async () => {
    const r = await analyzeFileHandler({ file_path: path.join(SRC_DIR, 'index.ts') }, {} as any);
    expect(r.success).toBe(true);
    expect(r.result.size_bytes).toBeGreaterThan(0);
  });
});
