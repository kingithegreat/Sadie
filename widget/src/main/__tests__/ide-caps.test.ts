jest.setTimeout(15_000);
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-caps-ud-'));
jest.mock('electron', () => ({ app: { getPath: () => userData } }));
import { clampIdeCaps, getIdeCaps, IDE_CAP_DEFAULTS } from '../ide-caps';
import { stripJsonComments, resetIdeUserSettingsCache } from '../ide-user-settings';
import { queryWorkspaceLanguage, disposeWorkspaceLanguageServices } from '../workspace-language';
import { readWorkspaceSnapshot } from '../workspace-files';

const settingsFile = path.join(userData, 'settings.json');
const writeSettings = (value: unknown) => { fs.writeFileSync(settingsFile, typeof value === 'string' ? value : JSON.stringify(value)); resetIdeUserSettingsCache(); };
let root: string;
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), 'hb-caps-'))); });
afterEach(() => { disposeWorkspaceLanguageServices(); fs.rmSync(root, { recursive: true, force: true }); try { fs.rmSync(settingsFile); } catch { /* none */ } resetIdeUserSettingsCache(); });

test('caps default safely and clamp out-of-range values with a clear warning', () => {
  expect(clampIdeCaps(undefined).caps).toEqual(IDE_CAP_DEFAULTS);
  const { caps, warnings } = clampIdeCaps({ maxFiles: 1_000_000, maxDepth: 'deep', bogus: 1 });
  expect(caps.maxFiles).toBe(20_000);
  expect(caps.maxDepth).toBe(30);
  expect(warnings.join('\n')).toMatch(/maxFiles" 1000000 is outside the safe range 100–20000; using 20000/);
  expect(warnings.join('\n')).toMatch(/maxDepth" must be a number/);
  expect(warnings.join('\n')).toMatch(/Unknown cap "ide.caps.bogus"/);
});

test('settings.json with comments and trailing commas sets caps', () => {
  expect(JSON.parse(stripJsonComments('{ // c\n "a": "http://x", /* b */ "b": [1,], }'))).toEqual({ a: 'http://x', b: [1] });
  writeSettings('{\n // keep Quick Open small\n "ide.caps": { "maxFiles": 150, },\n}');
  expect(getIdeCaps().maxFiles).toBe(150);
});

test('Quick Open says how many files were skipped when the file cap is hit', () => {
  writeSettings({ 'ide.caps': { maxFiles: 100 } });
  for (let index = 0; index < 130; index++) fs.writeFileSync(path.join(root, `f${index}.ts`), 'export {};\n');
  const result = queryWorkspaceLanguage({ root, path: root, content: '', action: 'files' });
  expect(result.files).toHaveLength(100);
  expect(result.notices?.[0]).toMatch(/Only the first 100 files were indexed; the rest .* skipped/);
});

test('language analysis names large and too-deep files it skipped', () => {
  writeSettings({ 'ide.caps': { maxFileBytes: 65_536, maxDepth: 2 } });
  fs.writeFileSync(path.join(root, 'big.ts'), `export const s = "${'x'.repeat(70_000)}";\n`);
  const deep = path.join(root, 'a', 'b', 'c', 'd'); fs.mkdirSync(deep, { recursive: true }); fs.writeFileSync(path.join(deep, 'deep.ts'), 'export {};\n');
  const main = path.join(root, 'main.ts'); const content = 'import { s } from "./big";\nexport const n = s.length;\n'; fs.writeFileSync(main, content);
  const result = queryWorkspaceLanguage({ root, path: main, content, action: 'diagnostics' });
  expect(result.success).toBe(true);
  const text = (result.notices || []).join('\n');
  expect(text).toMatch(/larger than 64 KB .*skipped .*big\.ts/);
  expect(text).toMatch(/Folders deeper than 2 levels were skipped/);
});

test('opening a file over the editor cap explains the cap and how to raise it', () => {
  const file = path.join(root, 'large.txt'); fs.writeFileSync(file, 'x'.repeat(70_000));
  writeSettings({ 'ide.caps': { maxEditableBytes: 65_536 } });
  expect(() => readWorkspaceSnapshot(file)).toThrow(/68 KB is over the 64 KB editor cap. Raise "ide.caps.maxEditableBytes"/);
  writeSettings({});
  expect(readWorkspaceSnapshot(file).content).toHaveLength(70_000);
});
