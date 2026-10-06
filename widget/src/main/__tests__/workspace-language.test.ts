jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { queryWorkspaceLanguage, disposeWorkspaceLanguageServices } from '../workspace-language';
import type { WorkspaceLanguageAction } from '../../shared/workspace-language-types';
import * as userPaths from '../user-paths';
let root: string;
let entry: string;
let library: string;
const originalLibrary = 'export function greet(name: string): string { return name.toUpperCase(); }\n';
const originalEntry = 'import { greet } from "./library";\nconst message = greet("Ada");\nmessage.toUpperCase();\n';
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.homedir(), 'hb-language-'));
  entry = path.join(root, 'main.ts'); library = path.join(root, 'library.ts');
  fs.writeFileSync(entry, originalEntry); fs.writeFileSync(library, originalLibrary);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
});
afterEach(disposeWorkspaceLanguageServices);
afterAll(() => { disposeWorkspaceLanguageServices(); fs.rmSync(root, { recursive: true, force: true }); });
const query = (action: WorkspaceLanguageAction, content = originalEntry, position = content.indexOf('greet("') + 2, extra = {}) => queryWorkspaceLanguage({ root, path: entry, content, position, action, ...extra });
test('definition and references resolve across actual project files and do not write', () => {
  const definition = query('definition'); expect(definition.success).toBe(true);
  expect(definition.locations).toEqual(expect.arrayContaining([expect.objectContaining({ path: library, line: 1 })]));
  const references = query('references'); expect(references.locations?.some(item => item.path === entry)).toBe(true);
  expect(fs.readFileSync(entry, 'utf8')).toBe(originalEntry);
});
test('semantic member completions use imported return types and unsaved library edits', () => {
  const content = 'import { greet } from "./library";\nconst message = greet("Ada");\nmessage.';
  const stringResult = query('complete', content, content.length);
  expect(stringResult.entries?.some(item => item.label === 'toUpperCase')).toBe(true);
  const numberResult = query('complete', content, content.length, { buffers: [{ path: library, content: 'export function greet(name: string): number { return name.length; }' }] });
  expect(numberResult.entries?.some(item => item.label === 'toFixed')).toBe(true);
  expect(numberResult.entries?.some(item => item.label === 'toUpperCase')).toBe(false);
  expect(fs.readFileSync(library, 'utf8')).toBe(originalLibrary);
});
test('hover and signature expose compiler information for imported symbols', () => {
  expect(query('hover').text).toContain('name: string');
  expect(query('signature', originalEntry, originalEntry.indexOf('"Ada"') + 1).text).toContain('name: string');
});
test('rename produces guarded multi-file drafts and only semantic references', () => {
  const content = originalEntry + '// greet is merely a comment\nconst quote = "greet";\n';
  const result = queryWorkspaceLanguage({ root, path: library, content: originalLibrary, position: originalLibrary.indexOf('greet') + 2, action: 'rename', newName: 'welcome', buffers: [{ path: entry, content }] });
  expect(result.success).toBe(true); expect(result.edits?.length).toBe(2);
  const main = result.edits?.find(edit => edit.path === entry)!;
  expect(main.expectedContent).toBe(content);
  const renamed = main.changes.slice().sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.start + edit.length), content);
  expect(renamed).toContain('welcome("Ada")'); expect(renamed).toContain('// greet is merely a comment'); expect(renamed).toContain('"greet"');
  expect(fs.readFileSync(entry, 'utf8')).toBe(originalEntry);
});
test('format and diagnostics operate on unsaved text, preserving disk', () => {
  const content = 'const number:string=42;\n';
  expect(query('diagnostics', content, 0).diagnostics?.some(item => item.message.includes('not assignable'))).toBe(true);
  const result = query('format', content, 0); expect(result.success).toBe(true); expect(result.edits?.[0].changes.length).toBeGreaterThan(0);
  expect(result.edits?.[0].expectedContent).toBe(content); expect(fs.readFileSync(entry, 'utf8')).toBe(originalEntry);
});
test('compiler quick fixes are returned with exact source guards', () => {
  const content = 'const count = 1;\ncount = 2;\n';
  const result = query('fixes', content, content.indexOf('count = 2') + 2);
  expect(result.success).toBe(true); expect(result.fixes?.some(fix => fix.edits.some(edit => edit.changes.some(change => change.text.includes('let'))))).toBe(true);
});
test('symbols and file picker include project files while excluding dependencies', () => {
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(root, 'node_modules', 'junk.ts'), 'export const junk = 1;');
  const symbols = query('symbols'); expect(symbols).toEqual(expect.objectContaining({ success: true, locations: expect.arrayContaining([expect.objectContaining({ name: 'greet' })]) }));
  expect(query('files').files).toContain(entry); expect(query('files').files?.some(file => file.includes('junk.ts'))).toBe(false);
});
test('rejects root escape, unrelated buffers, invalid identifiers and unsupported languages honestly', () => {
  expect(queryWorkspaceLanguage({ root, path: path.join(os.homedir(), 'outside.ts'), content: '', action: 'hover' }).success).toBe(false);
  expect(query('rename', originalEntry, 0, { newName: 'bad-name' }).success).toBe(false);
  const other = fs.mkdtempSync(path.join(os.homedir(), 'hb-language-other-'));
  try {
    const foreign = path.join(other, 'foreign.ts'); fs.writeFileSync(foreign, 'const token = 1;');
    expect(query('hover', originalEntry, 0, { buffers: [{ path: foreign, content: 'const token = 2;' }] }).error).toMatch(/belong to this project/);
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
  const python = path.join(root, 'example.py'); fs.writeFileSync(python, 'print("hi")');
  expect(queryWorkspaceLanguage({ root, path: python, content: 'print("hi")', action: 'definition' }).error).toMatch(/currently support JavaScript and TypeScript/);
});

test('reads declared linked dependency types without permitting edits or unrelated package access', () => {
  const store = fs.mkdtempSync(path.join(os.homedir(), 'hb-language-store-'));
  const moduleDir = path.join(root, 'node_modules', 'typed-library');
  const unrelated = path.join(root, 'node_modules', 'private-library');
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(store, 'typed-library'));
  fs.mkdirSync(path.join(store, 'private-library'));
  fs.writeFileSync(path.join(store, 'typed-library', 'package.json'), JSON.stringify({ name: 'typed-library', types: 'index.d.ts' }));
  fs.writeFileSync(path.join(store, 'typed-library', 'index.d.ts'), 'export namespace Kit { export interface User { readonly displayName: string; render(): void; } export const user: User; }');
  fs.writeFileSync(path.join(store, 'private-library', 'package.json'), JSON.stringify({ name: 'private-library', types: 'index.d.ts' }));
  fs.writeFileSync(path.join(store, 'private-library', 'index.d.ts'), 'export const hiddenSecret: { secretProperty: number };');
  fs.symlinkSync(path.join(store, 'typed-library'), moduleDir, process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(path.join(store, 'private-library'), unrelated, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { 'typed-library': '1.0.0' } }));
  try {
    const content = 'import { Kit } from "typed-library";\nKit.user.';
    const result = query('complete', content, content.length);
    expect(result.success).toBe(true); expect(result.entries?.map(item => item.label)).toEqual(expect.arrayContaining(['displayName', 'render']));
    const privateContent = 'import { hiddenSecret } from "private-library";\nhiddenSecret.';
    expect(query('complete', privateContent, privateContent.length).entries?.some(item => item.label === 'secretProperty')).toBe(false);
    const target = queryWorkspaceLanguage({ root, path: path.join(store, 'typed-library', 'index.d.ts'), content: '', action: 'rename', newName: 'Other' });
    expect(target.success).toBe(false);
    disposeWorkspaceLanguageServices();
    const narrowedHome = jest.spyOn(userPaths, 'homeDir').mockReturnValue(root);
    try {
      // The same linked package becomes untrusted when its real store is
      // outside the profile boundary; a declared name never widens that bound.
      expect(query('complete', content, content.length).entries?.some(item => item.label === 'displayName')).toBe(false);
    } finally { narrowedHome.mockRestore(); }
  } finally {
    // Remove only the test's symlink entries before deleting their known stores.
    fs.unlinkSync(moduleDir); fs.unlinkSync(unrelated);
    fs.rmSync(store, { recursive: true, force: true }); fs.unlinkSync(path.join(root, 'package.json'));
  }
});
