import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const nativeFs: typeof import('fs') = jest.requireActual('fs');
let mockHome: string;
jest.mock('electron', () => ({ app: { getPath: () => require('path').join(mockHome, 'profile') } }));
jest.mock('../user-paths', () => ({ homeDir: () => mockHome }));
jest.mock('../window-manager', () => ({ getMainWindow: jest.fn() }));
jest.mock('../config-manager', () => ({ getSettings: jest.fn(() => ({})) }));
import { readWorkspaceRules } from '../workspace-code-context';

let root: string, outside: string;
beforeEach(() => {
  mockHome = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-rules-'));
  root = path.join(mockHome, 'project'); outside = path.join(mockHome, 'other-project');
  fs.mkdirSync(root); fs.mkdirSync(outside);
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(mockHome, { recursive: true, force: true }); });
function write(relative: string, text: string) {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file;
}
const prompt = () => readWorkspaceRules(root).map(rule => `${rule.path}\n${rule.text}`).join('\n\n');

test('the existing renderer-shaped prompt carries root and nested instructions with explicit subtree precedence', () => {
  const top = write('AGENTS.md', 'ROOT_RULE: prefer descriptive names.');
  write('CLAUDE.md', 'ROOT_CLAUDE_RULE'); write('.cursor/rules/style.mdc', 'ROOT_CURSOR_RULE');
  const packageRule = write('packages/AGENTS.md', 'PACKAGE_RULE: use package exports.');
  const featureRule = write('packages/mobile/AGENTS.md', 'MOBILE_RULE: preserve native adapters.');
  const siblingRule = write('services/AGENTS.md', 'SERVICE_RULE: use service conventions.');
  const rules = readWorkspaceRules(root), rendered = rules.map(rule => `${rule.path}\n${rule.text}`).join('\n\n');
  expect(rules.find(rule => rule.path === top)?.text).toBe('ROOT_RULE: prefer descriptive names.');
  expect(rendered).toContain('ROOT_CLAUDE_RULE'); expect(rendered).toContain('ROOT_CURSOR_RULE');
  expect(rules.find(rule => rule.path === packageRule)?.text).toContain('applies only to project directory "packages/" and its descendants, never to sibling directories');
  expect(rules.find(rule => rule.path === featureRule)?.text).toContain('applies only to project directory "packages/mobile/"');
  expect(rules.find(rule => rule.path === featureRule)?.text).toContain('this file overrides conflicting ancestor instructions here');
  expect(rules.find(rule => rule.path === siblingRule)?.text).toContain('applies only to project directory "services/"');
  expect(rendered.indexOf('ROOT_RULE')).toBeLessThan(rendered.indexOf('PACKAGE_RULE'));
  expect(rendered.indexOf('PACKAGE_RULE')).toBeLessThan(rendered.indexOf('MOBILE_RULE'));
  expect(rendered).toContain('A deeper AGENTS.md overrides this file only in that deeper subtree');
});
test('fresh discovery observes added, updated, and deleted scoped rules', () => {
  write('AGENTS.md', 'ROOT_RULE'); const nested = write('src/AGENTS.md', 'NESTED_OLD');
  expect(prompt()).toContain('NESTED_OLD'); fs.writeFileSync(nested, 'NESTED_NEW');
  expect(prompt()).toContain('NESTED_NEW'); expect(prompt()).not.toContain('NESTED_OLD');
  fs.unlinkSync(nested); expect(prompt()).not.toContain('NESTED_NEW');
  write('src/ui/AGENTS.md', 'UI_NEW'); expect(prompt()).toContain('UI_NEW');
});
test('generated trees and real junction/symlink escapes cannot contribute project instructions', () => {
  write('AGENTS.md', 'ROOT_RULE');
  for (const directory of ['node_modules', '.git', 'dist', 'out', 'build', '.next', '.venv', '__pycache__']) write(`${directory}/pkg/AGENTS.md`, 'IGNORED_GENERATED_RULE');
  fs.writeFileSync(path.join(outside, 'AGENTS.md'), 'OUTSIDE_SECRET_RULE');
  fs.writeFileSync(path.join(outside, 'secret.mdc'), 'OUTSIDE_CURSOR_SECRET');
  fs.symlinkSync(outside, path.join(root, 'foreign'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(root, '.cursor')); fs.symlinkSync(outside, path.join(root, '.cursor', 'rules'), process.platform === 'win32' ? 'junction' : 'dir');
  const rendered = prompt(); expect(rendered).toContain('ROOT_RULE');
  expect(rendered).not.toContain('OUTSIDE_SECRET_RULE'); expect(rendered).not.toContain('OUTSIDE_CURSOR_SECRET'); expect(rendered).not.toContain('IGNORED_GENERATED_RULE');
});
test('instruction text and file-count limits are visible rather than implying complete discovery', () => {
  write('AGENTS.md', 'ROOT_RULE'); for (let i = 0; i < 35; i++) write(`p${String(i).padStart(2, '0')}/AGENTS.md`, `RULE_${i}`);
  const rules = readWorkspaceRules(root);
  expect(rules.length).toBeLessThanOrEqual(30); expect(rules[0].text).toBe('ROOT_RULE');
  expect(rules.some(rule => rule.text.includes('Instruction discovery is incomplete'))).toBe(true);
  expect(rules.map(rule => rule.text).join('').length).toBeLessThanOrEqual(40_000);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'A'.repeat(60_000));
  const limited = readWorkspaceRules(root); expect(limited.map(rule => rule.text).join('').length).toBeLessThanOrEqual(40_000);
  expect(limited.some(rule => rule.text.includes('missing or truncated'))).toBe(true);
});
test('directory discovery stops at its bound and discloses missing scopes', () => {
  write('AGENTS.md', 'ROOT_RULE');
  for (let i = 0; i < 210; i++) fs.mkdirSync(path.join(root, `d${String(i).padStart(3, '0')}`));
  const opened = jest.spyOn(nativeFs, 'opendirSync');
  expect(prompt()).toContain('Instruction discovery is incomplete');
  expect(opened.mock.calls.length).toBeLessThanOrEqual(200);
});
test('supported-depth instructions are retained while deeper scopes are explicitly undiscovered', () => {
  write('AGENTS.md', 'ROOT_RULE');
  const supported = Array.from({ length: 12 }, (_, i) => `level${i}`).join('/'); write(`${supported}/AGENTS.md`, 'SUPPORTED_DEPTH_RULE');
  const deep = Array.from({ length: 14 }, (_, i) => `level${i}`).join('/'); write(`${deep}/AGENTS.md`, 'TOO_DEEP_RULE');
  const rendered = prompt(); expect(rendered).toContain('SUPPORTED_DEPTH_RULE'); expect(rendered).not.toContain('TOO_DEEP_RULE'); expect(rendered).toContain('Instruction discovery is incomplete');
});
test('an oversized instruction is omitted without hiding other scoped rules', () => {
  write('AGENTS.md', 'ROOT_RULE'); write('oversized/AGENTS.md', 'X'.repeat(100_001)); write('supported/AGENTS.md', 'SUPPORTED_RULE');
  const rendered = prompt(); expect(rendered).not.toContain('X'.repeat(1000)); expect(rendered).toContain('SUPPORTED_RULE'); expect(rendered).toContain('Instruction discovery is incomplete');
});
test('the global entry bound stops a large flat directory without depending on another budget', () => {
  write('AGENTS.md', 'ENTRY_ROOT');
  for (let i = 0; i < 2005; i++) fs.writeFileSync(path.join(root, `file${i}.txt`), '');
  const entryRules = readWorkspaceRules(root);
  expect(entryRules[0].text).toBe('ENTRY_ROOT'); expect(entryRules.some(rule => rule.text.includes('entry, or depth limit'))).toBe(true);
});
test('a file redirected during open is rejected by its held descriptor identity', () => {
  const instruction = write('AGENTS.md', 'ROOT_RULE'); fs.writeFileSync(path.join(outside, 'AGENTS.md'), 'OUTSIDE_OPEN_RACE');
  const original = fs.openSync;
  jest.spyOn(nativeFs, 'openSync').mockImplementation(((file: any, flags: any, mode: any) => original(file === instruction ? path.join(outside, 'AGENTS.md') : file, flags, mode)) as any);
  expect(prompt()).not.toContain('OUTSIDE_OPEN_RACE');
});
