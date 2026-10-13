import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-settings-ud-'));
jest.mock('electron', () => ({ app: { getPath: () => userData }, ipcMain: { handle: jest.fn(), removeHandler: jest.fn() } }));
jest.mock('../window-manager', () => ({ getMainWindow: () => null }));
import { handleIdeSettingsRequest } from '../ide-settings-ipc';
import { getIdeCaps } from '../ide-caps';
import { parseJsonc, validateIdeSettings, validateKeybindings, parseChord, chordMatches, effectiveKeybindings, SETTINGS_TEMPLATE, KEYBINDINGS_TEMPLATE } from '../../shared/ide-settings';

afterEach(() => { for (const name of ['settings.json', 'keybindings.json']) try { fs.rmSync(path.join(userData, name)); } catch { /* none */ } });

test('templates are valid and produce no problems', () => {
  expect(validateIdeSettings(parseJsonc(SETTINGS_TEMPLATE, 's').value).problems).toEqual([]);
  expect(validateKeybindings(parseJsonc(KEYBINDINGS_TEMPLATE, 'k').value).problems).toEqual([]);
});

test('broken JSON reports the line and column', () => {
  const result = parseJsonc('{\n  "editor.tabSize": 2\n  "editor.fontSize": 14\n}', 'settings.json');
  expect(result.error).toMatch(/^settings\.json: invalid JSON at line 3, column 3/);
});

test('settings are validated with specific messages and bad values are not used', () => {
  const { settings, problems } = validateIdeSettings({ 'editor.tabSize': 3, 'editor.fontSize': 16, 'editor.theme': 'neon', 'editor.formatOnSave': 'yes', 'editor.wordWrap': 'on' });
  expect(settings).toEqual({ 'editor.fontSize': 16 });
  expect(problems).toEqual([
    '"editor.tabSize" must be 2 or 4 (got 3).',
    '"editor.theme" must be "auto", "dark" or "light" (got "neon").',
    '"editor.formatOnSave" must be true or false (got "yes").',
    'Unknown setting "editor.wordWrap" was ignored.',
  ]);
});

test('keybindings use the VS Code shape and explain mistakes', () => {
  const { keybindings, problems } = validateKeybindings([
    { key: 'ctrl+alt+t', command: 'workbench.action.terminal.toggleTerminal' },
    { key: 'ctrl+t', command: '-workbench.action.gotoSymbol' },
    { key: 'k', command: 'workbench.action.quickOpen' },
    { key: 'ctrl+alt+q', command: 'editor.action.doesNotExist' },
    { key: 'ctrl+k ctrl+s', command: 'workbench.action.quickOpen' },
    { command: 'workbench.action.quickOpen' },
  ]);
  expect(keybindings).toEqual([{ key: 'ctrl+alt+t', command: 'workbench.action.terminal.toggleTerminal' }, { key: 'ctrl+t', command: 'workbench.action.gotoSymbol', remove: true }]);
  expect(problems[0]).toMatch(/Entry 3: "k": needs ctrl, alt or cmd/);
  expect(problems[1]).toMatch(/Entry 4: unknown command "editor.action.doesNotExist". Available:/);
  expect(problems[2]).toMatch(/Entry 5: .*multi-step chords are not supported/);
  expect(problems[3]).toMatch(/Entry 6: "key" must be a string/);
  const table = effectiveKeybindings(keybindings);
  expect(table.some(item => item.command === 'workbench.action.gotoSymbol')).toBe(false);
  const terminal = table.find(item => item.command === 'workbench.action.terminal.toggleTerminal' && item.chord.alt)!;
  expect(chordMatches(terminal.chord, { ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, key: 'T' })).toBe(true);
  expect(chordMatches(parseChord('ctrl+shift+p') as any, { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: 'p' })).toBe(false);
});

test('Open Settings (JSON) shows a template, saves, applies caps and reports problems', () => {
  const read = handleIdeSettingsRequest({ action: 'read', which: 'settings' }) as any;
  expect(read).toEqual(expect.objectContaining({ success: true, exists: false, problems: [] }));
  expect(read.text).toBe(SETTINGS_TEMPLATE);
  const saved = handleIdeSettingsRequest({ action: 'save', which: 'settings', text: '{ "editor.tabSize": 4, "ide.caps": { "maxFiles": 99999 }, }' }) as any;
  expect(saved.success).toBe(true);
  expect(saved.problems).toEqual([expect.stringMatching(/maxFiles" 99999 is outside the safe range 100–20000; using 20000/)]);
  expect(saved.snapshot.settings['editor.tabSize']).toBe(4);
  expect(getIdeCaps().maxFiles).toBe(20000);
  const keys = handleIdeSettingsRequest({ action: 'save', which: 'keybindings', text: '[{ "key": "ctrl+alt+t", "command": "nope" }]' }) as any;
  expect(keys.problems[0]).toMatch(/unknown command "nope"/);
  expect(keys.snapshot.keybindings).toEqual([]);
  const broken = handleIdeSettingsRequest({ action: 'save', which: 'settings', text: '{ "editor.tabSize": }' }) as any;
  expect(broken.success).toBe(true);
  expect(broken.problems[0]).toMatch(/invalid JSON at line 1/);
  expect(broken.snapshot.settings).toEqual({});
});
