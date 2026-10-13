/**
 * User-level IDE settings.json and keybindings.json: shapes, validation with
 * plain-language errors, and VS Code-style key chord parsing. Shared by the
 * main process (reading/saving) and the renderer (applying).
 */
export type IdeTheme = 'auto' | 'dark' | 'light';
export interface IdeSettings {
  'editor.tabSize'?: 2 | 4;
  'editor.fontSize'?: number;
  'editor.formatOnSave'?: boolean;
  'editor.aiSuggestions'?: boolean;
  'editor.theme'?: IdeTheme;
  'ide.caps'?: Record<string, number>;
}
export interface IdeKeybinding { key: string; command: string; remove?: boolean }
export interface IdeSettingsSnapshot {
  settings: IdeSettings;
  keybindings: IdeKeybinding[];
  settingsProblems: string[];
  keybindingsProblems: string[];
}

export const IDE_COMMANDS: Record<string, string> = {
  'workbench.action.quickOpen': 'Quick Open a project file',
  'workbench.action.showCommands': 'Show the command palette',
  'workbench.action.gotoSymbol': 'Go to a project symbol',
  'workbench.action.files.save': 'Save the active file',
  'workbench.action.terminal.toggleTerminal': 'Toggle the terminal',
  'workbench.action.findInFiles': 'Search across project files',
  'workbench.view.scm': 'Show source control',
  'workbench.action.problems': 'Show problems and tasks',
  'workbench.action.openSettingsJson': 'Open Settings (JSON)',
  'workbench.action.openGlobalKeybindingsFile': 'Open Keybindings (JSON)',
  'homebot.assistant.toggle': 'Toggle the coding assistant',
};
export const DEFAULT_KEYBINDINGS: IdeKeybinding[] = [
  { key: 'ctrl+s', command: 'workbench.action.files.save' },
  { key: 'ctrl+p', command: 'workbench.action.quickOpen' },
  { key: 'ctrl+shift+p', command: 'workbench.action.showCommands' },
  { key: 'ctrl+t', command: 'workbench.action.gotoSymbol' },
  { key: 'ctrl+`', command: 'workbench.action.terminal.toggleTerminal' },
  { key: 'ctrl+shift+f', command: 'workbench.action.findInFiles' },
  { key: 'ctrl+,', command: 'workbench.action.openSettingsJson' },
];

export const SETTINGS_TEMPLATE = `// HomeBot IDE user settings. JSON with comments; trailing commas are allowed.
// Values here override the Editor settings panel. Unknown keys are reported, not used.
{
  // 2 or 4
  "editor.tabSize": 2,
  // 10–30
  "editor.fontSize": 14,
  // Uses the project's Prettier when allowed, otherwise built-in JS/TS formatting.
  "editor.formatOnSave": false,
  // Local ghost-text completion (needs a small local coder model; never downloads by itself).
  "editor.aiSuggestions": false,
  // "auto" follows HomeBot's light/dark theme.
  "editor.theme": "auto",
  // Safety caps, clamped to safe maximums.
  "ide.caps": {
    "maxFiles": 2000,          // 100–20000
    "maxFileBytes": 2097152,   // 64 KB–10 MB
    "maxDepth": 30,            // 2–64
    "findTimeoutMs": 2000,     // 250–10000
    "maxEditableBytes": 2097152 // 64 KB–10 MB
  }
}
`;
export const KEYBINDINGS_TEMPLATE = `// HomeBot IDE keybindings, VS Code shape: [{ "key": "ctrl+alt+t", "command": "..." }].
// Prefix a command with "-" to remove its default key, e.g. { "key": "ctrl+t", "command": "-workbench.action.gotoSymbol" }.
// Commands: ${Object.keys(IDE_COMMANDS).join(', ')}
[
]
`;

/** Strip // and /* *\/ comments and trailing commas, leaving string contents intact. */
export function stripJsonComments(text: string): string {
  let out = '', inString = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index], next = text[index + 1];
    if (inString) { out += character; if (character === '\\') { out += next ?? ''; index++; } else if (character === '"') inString = false; continue; }
    if (character === '"') { inString = true; out += character; continue; }
    if (character === '/' && next === '/') { while (index < text.length && text[index] !== '\n') index++; out += '\n'; continue; }
    if (character === '/' && next === '*') { index += 2; out += '  '; while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) { out += text[index] === '\n' ? '\n' : ' '; index++; } index++; out += '  '; continue; }
    out += character;
  }
  return out.replace(/,(\s*[}\]])/g, ' $1');
}

/** Index of the first syntax error in strict JSON (engines differ in whether they report it). */
export function jsonErrorIndex(text: string): number {
  let index = 0;
  const space = () => { while (/\s/.test(text[index] || '')) index++; };
  const fail = (): never => { throw index; };
  const value = (): void => {
    space(); const character = text[index];
    if (character === '{') { index++; space(); if (text[index] === '}') { index++; return; } for (;;) { space(); if (text[index] !== '"') fail(); string(); space(); if (text[index] !== ':') fail(); index++; value(); space(); if (text[index] === ',') { index++; continue; } if (text[index] === '}') { index++; return; } fail(); } }
    if (character === '[') { index++; space(); if (text[index] === ']') { index++; return; } for (;;) { value(); space(); if (text[index] === ',') { index++; continue; } if (text[index] === ']') { index++; return; } fail(); } }
    if (character === '"') return string();
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
    if (!literal) fail(); index += literal![0].length;
  };
  const string = () => { index++; while (index < text.length && text[index] !== '"') { if (text[index] === '\\') index++; if (text[index] === '\n') fail(); index++; } if (text[index] !== '"') fail(); index++; };
  try { value(); space(); if (index < text.length) fail(); return text.length; } catch (at) { return typeof at === 'number' ? at : text.length; }
}

/** Parse JSONC; errors name the line and column. */
export function parseJsonc(text: string, label: string): { value?: unknown; error?: string } {
  const clean = stripJsonComments(text);
  if (!clean.trim()) return { value: undefined };
  try { return { value: JSON.parse(clean) }; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reported = Number(/position (\d+)/.exec(message)?.[1]);
    const position = Number.isFinite(reported) ? reported : jsonErrorIndex(clean);
    if (Number.isFinite(position)) {
      const before = clean.slice(0, position); const line = before.split('\n').length; const column = position - before.lastIndexOf('\n');
      return { error: `${label}: invalid JSON at line ${line}, column ${column} (${message.replace(/ in JSON at position \d+.*$/, '')}).` };
    }
    return { error: `${label}: invalid JSON (${message}).` };
  }
}

export function validateIdeSettings(raw: unknown): { settings: IdeSettings; problems: string[] } {
  const settings: IdeSettings = {}, problems: string[] = [];
  if (raw === undefined) return { settings, problems };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings, problems: ['settings.json must be an object: { "editor.tabSize": 2 }.'] };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    switch (key) {
      case 'editor.tabSize': if (value === 2 || value === 4) settings[key] = value; else problems.push(`"editor.tabSize" must be 2 or 4 (got ${JSON.stringify(value)}).`); break;
      case 'editor.fontSize': if (typeof value === 'number' && value >= 10 && value <= 30) settings[key] = Math.round(value); else problems.push(`"editor.fontSize" must be a number from 10 to 30 (got ${JSON.stringify(value)}).`); break;
      case 'editor.formatOnSave':
      case 'editor.aiSuggestions': if (typeof value === 'boolean') settings[key] = value; else problems.push(`"${key}" must be true or false (got ${JSON.stringify(value)}).`); break;
      case 'editor.theme': if (value === 'auto' || value === 'dark' || value === 'light') settings[key] = value; else problems.push(`"editor.theme" must be "auto", "dark" or "light" (got ${JSON.stringify(value)}).`); break;
      case 'ide.caps': if (value && typeof value === 'object' && !Array.isArray(value)) settings[key] = value as Record<string, number>; else problems.push('"ide.caps" must be an object, e.g. { "maxFiles": 5000 }.'); break;
      default: problems.push(`Unknown setting "${key}" was ignored.`);
    }
  }
  return { settings, problems };
}

export interface KeyChord { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string }
const KEY_NAMES: Record<string, string> = { esc: 'escape', escape: 'escape', enter: 'enter', tab: 'tab', space: ' ', backspace: 'backspace', delete: 'delete', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown' };
export function parseChord(input: string): KeyChord | string {
  const parts = input.toLowerCase().split('+').map(part => part.trim());
  if (input.trim().includes(' ')) return `"${input}": multi-step chords are not supported yet; use one combination like "ctrl+shift+k".`;
  const chord: KeyChord = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') chord.ctrl = true;
    else if (part === 'shift') chord.shift = true;
    else if (part === 'alt' || part === 'option') chord.alt = true;
    else if (part === 'cmd' || part === 'meta' || part === 'win') chord.meta = true;
    else if (chord.key) return `"${input}": more than one non-modifier key.`;
    else if (/^f([1-9]|1[0-9])$/.test(part) || part.length === 1 || KEY_NAMES[part]) chord.key = KEY_NAMES[part] || part;
    else return `"${input}": unknown key "${part}".`;
  }
  if (!chord.key) return `"${input}": no key after the modifiers.`;
  if (!chord.ctrl && !chord.alt && !chord.meta && !/^f\d+$/.test(chord.key)) return `"${input}": needs ctrl, alt or cmd (or a function key) so typing is not captured.`;
  return chord;
}
export function chordMatches(chord: KeyChord, event: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; key: string }): boolean {
  return chord.ctrl === event.ctrlKey && chord.shift === event.shiftKey && chord.alt === event.altKey && chord.meta === event.metaKey && event.key.toLowerCase() === chord.key;
}

export function validateKeybindings(raw: unknown): { keybindings: IdeKeybinding[]; problems: string[] } {
  const keybindings: IdeKeybinding[] = [], problems: string[] = [];
  if (raw === undefined) return { keybindings, problems };
  if (!Array.isArray(raw)) return { keybindings, problems: ['keybindings.json must be an array: [{ "key": "ctrl+alt+t", "command": "workbench.action.terminal.toggleTerminal" }].'] };
  raw.slice(0, 200).forEach((entry, index) => {
    const where = `Entry ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push(`${where} must be an object with "key" and "command".`); return; }
    const { key, command, when } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || !key.trim()) { problems.push(`${where}: "key" must be a string like "ctrl+shift+k".`); return; }
    if (typeof command !== 'string' || !command.trim()) { problems.push(`${where}: "command" must be a command id string.`); return; }
    const remove = command.startsWith('-'), id = remove ? command.slice(1) : command;
    if (!(id in IDE_COMMANDS)) { problems.push(`${where}: unknown command "${id}". Available: ${Object.keys(IDE_COMMANDS).join(', ')}.`); return; }
    const chord = parseChord(key); if (typeof chord === 'string') { problems.push(`${where}: ${chord}`); return; }
    if (when !== undefined) problems.push(`${where}: "when" clauses are not supported yet and were ignored.`);
    keybindings.push({ key: key.toLowerCase(), command: id, ...(remove ? { remove: true } : {}) });
  });
  if (raw.length > 200) problems.push('Only the first 200 keybindings are used.');
  return { keybindings, problems };
}

/** Defaults with user removals applied, then user additions (later wins). */
export function effectiveKeybindings(user: IdeKeybinding[]): Array<{ chord: KeyChord; command: string }> {
  let table = DEFAULT_KEYBINDINGS.map(item => ({ ...item }));
  for (const binding of user) {
    if (binding.remove) table = table.filter(item => !(item.command === binding.command && item.key === binding.key));
    else { table = table.filter(item => item.key !== binding.key); table.push(binding); }
  }
  return table.map(item => ({ chord: parseChord(item.key) as KeyChord, command: item.command })).filter(item => typeof item.chord !== 'string');
}
