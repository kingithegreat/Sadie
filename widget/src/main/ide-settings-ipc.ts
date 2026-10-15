/** Read, validate and save the user's IDE settings.json / keybindings.json (main process only). */
import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getMainWindow } from './window-manager';
import { IDE_SETTINGS_MAX_BYTES, ideUserSettingsPath, resetIdeUserSettingsCache } from './ide-user-settings';
import { clampIdeCaps } from './ide-caps';
import { KEYBINDINGS_TEMPLATE, SETTINGS_TEMPLATE, parseJsonc, validateIdeSettings, validateKeybindings, type IdeSettingsSnapshot } from '../shared/ide-settings';

export const IDE_SETTINGS_CHANNEL = 'homebot:workspace:ide-settings';
export type IdeSettingsFile = 'settings' | 'keybindings';
const fileFor = (which: IdeSettingsFile) => which === 'settings' ? ideUserSettingsPath() : path.join(app.getPath('userData'), 'keybindings.json');
const templateFor = (which: IdeSettingsFile) => which === 'settings' ? SETTINGS_TEMPLATE : KEYBINDINGS_TEMPLATE;

function readText(which: IdeSettingsFile): { text: string; exists: boolean } {
  try {
    const file = fileFor(which); const stat = fs.statSync(file);
    if (stat.size > IDE_SETTINGS_MAX_BYTES) return { text: '', exists: true };
    return { text: fs.readFileSync(file, 'utf8'), exists: true };
  } catch { return { text: '', exists: false }; }
}

export function validateIdeFileText(which: IdeSettingsFile, text: string): string[] {
  const name = `${which}.json`;
  if (Buffer.byteLength(text) > IDE_SETTINGS_MAX_BYTES) return [`${name} is larger than ${IDE_SETTINGS_MAX_BYTES / 1024} KB.`];
  const parsed = parseJsonc(text, name);
  if (parsed.error) return [parsed.error];
  if (which === 'keybindings') return validateKeybindings(parsed.value).problems;
  const result = validateIdeSettings(parsed.value);
  return [...result.problems, ...(result.settings['ide.caps'] ? clampIdeCaps(result.settings['ide.caps']).warnings : [])];
}

export function loadIdeSettingsSnapshot(): IdeSettingsSnapshot {
  const settingsText = readText('settings').text, keyText = readText('keybindings').text;
  const settingsParsed = parseJsonc(settingsText, 'settings.json'), keyParsed = parseJsonc(keyText, 'keybindings.json');
  const settings = settingsParsed.error ? { settings: {}, problems: [settingsParsed.error] } : validateIdeSettings(settingsParsed.value);
  const keys = keyParsed.error ? { keybindings: [], problems: [keyParsed.error] } : validateKeybindings(keyParsed.value);
  const capWarnings = settings.settings['ide.caps'] ? clampIdeCaps(settings.settings['ide.caps']).warnings : [];
  return { settings: settings.settings, keybindings: keys.keybindings, settingsProblems: [...settings.problems, ...capWarnings], keybindingsProblems: keys.problems };
}

export function handleIdeSettingsRequest(request: { action: 'get' | 'read' | 'save'; which?: IdeSettingsFile; text?: string }) {
  try {
    if (!request || typeof request !== 'object') throw new Error('Invalid settings request.');
    if (request.action === 'get') return { success: true, snapshot: loadIdeSettingsSnapshot() };
    if (request.which !== 'settings' && request.which !== 'keybindings') throw new Error('Choose settings or keybindings.');
    const which = request.which;
    if (request.action === 'read') {
      const { text, exists } = readText(which); const shown = exists ? text : templateFor(which);
      return { success: true, path: fileFor(which), text: shown, exists, problems: validateIdeFileText(which, shown) };
    }
    if (request.action === 'save') {
      if (typeof request.text !== 'string') throw new Error('Nothing to save.');
      if (Buffer.byteLength(request.text) > IDE_SETTINGS_MAX_BYTES) throw new Error(`${which}.json is larger than ${IDE_SETTINGS_MAX_BYTES / 1024} KB and was not saved.`);
      const file = fileFor(which); fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, request.text, { mode: 0o600 }); fs.renameSync(temporary, file);
      resetIdeUserSettingsCache();
      return { success: true, path: file, problems: validateIdeFileText(which, request.text), snapshot: loadIdeSettingsSnapshot() };
    }
    throw new Error('Unknown settings action.');
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}

export function registerIdeSettingsIpc(): void {
  ipcMain.removeHandler(IDE_SETTINGS_CHANNEL);
  ipcMain.handle(IDE_SETTINGS_CHANNEL, (event, request) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) return { success: false, error: 'Open settings from the HomeBot IDE.' };
    return handleIdeSettingsRequest(request);
  });
}
