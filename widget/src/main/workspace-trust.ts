/** Outside-home access is granted only by the trusted native folder picker. */
import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { homeDir } from './user-paths';

export function workspacePathWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
export function canonicalTrustedWorkspacePath(input: string): string {
  let ancestor = path.resolve(input); const missing: string[] = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor); if (parent === ancestor) throw new Error('The project path is unavailable.');
    missing.unshift(path.basename(ancestor)); ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...missing);
}
const trustFile = () => path.join(app.getPath('userData'), 'ide-trusted-folders.json');
function grants(): string[] {
  try {
    const bytes = fs.readFileSync(trustFile()); if (bytes.length > 50_000) return [];
    const data = JSON.parse(bytes.toString('utf8'));
    return Array.isArray(data.roots) ? data.roots.filter((item: unknown) => typeof item === 'string').slice(0, 100) : [];
  } catch { return []; }
}
function trustedPickerSender(event: any) {
  const window = require('./window-manager').getMainWindow();
  return !!window && !window.isDestroyed() && event.sender === window.webContents && !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
}
export function listTrustedWorkspaceFolders(): string[] { return activeGrants(); }
export function revokeTrustedWorkspaceFolder(event: any, input: unknown) {
  if (!trustedPickerSender(event)) throw new Error('Manage project access from the HomeBot IDE.');
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('Choose a trusted project to remove.');
  const roots = grants().filter(root => root !== path.resolve(input)), file = trustFile();
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ roots }), { mode: 0o600 }); fs.renameSync(temporary, file);
  return { roots: activeGrants() };
}
function activeGrants(): string[] {
  return grants().filter(root => {
    try { return fs.statSync(root).isDirectory() && canonicalTrustedWorkspacePath(root) === root && !protectedPath(root); }
    catch { return false; }
  });
}
function protectedPath(target: string): boolean {
  const roots = [process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData, app.getPath('userData'), path.dirname(process.execPath)]
    .filter((value): value is string => typeof value === 'string' && !!value);
  return roots.some(root => workspacePathWithin(canonicalTrustedWorkspacePath(root), target));
}
export function validateTrustedWorkspaceRoot(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || !path.isAbsolute(input)) throw new Error('Choose an absolute project folder first.');
  const root = canonicalTrustedWorkspacePath(input);
  if (path.dirname(root) === root || protectedPath(root)) throw new Error('System, runtime and HomeBot profile folders cannot be used as IDE projects.');
  if (!fs.statSync(root).isDirectory()) throw new Error('The project must be a folder.');
  if (!workspacePathWithin(canonicalTrustedWorkspacePath(homeDir()), root) && !activeGrants().some(grant => workspacePathWithin(grant, root))) throw new Error('Choose this project with the IDE folder picker before accessing it.');
  return root;
}
/** Path-only human IPC: the sender guard remains mandatory at its caller. */
export function checkedAnyTrustedWorkspacePath(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || !path.isAbsolute(input)) throw new Error('An absolute project path is required.');
  const target = canonicalTrustedWorkspacePath(input);
  const home = canonicalTrustedWorkspacePath(homeDir());
  if (protectedPath(target) || (!workspacePathWithin(home, target) && !activeGrants().some(root => workspacePathWithin(root, target)))) throw new Error('This path is not in your home or a folder chosen with the IDE picker.');
  return target;
}
export function checkedTrustedWorkspacePath(rootInput: unknown, targetInput: unknown): string {
  const root = validateTrustedWorkspaceRoot(rootInput);
  if (typeof targetInput !== 'string' || !targetInput.trim()) throw new Error('A project path is required.');
  const target = canonicalTrustedWorkspacePath(path.isAbsolute(targetInput) ? targetInput : path.join(root, targetInput));
  if (!workspacePathWithin(root, target) || protectedPath(target)) throw new Error('This path is outside the trusted project or is a protected folder.');
  return target;
}
export async function chooseTrustedWorkspaceFolder(event: any) {
  const window = require('./window-manager').getMainWindow();
  const trusted = () => !!window && !window.isDestroyed() && event.sender === window.webContents && !!event.senderFrame && event.senderFrame === window.webContents.mainFrame;
  if (!trusted()) throw new Error('Choose a project from the HomeBot IDE.');
  const selected = await dialog.showOpenDialog(window!, { title: 'Open IDE project folder', properties: ['openDirectory'] });
  if (!trusted()) throw new Error('The project choice was cancelled because its window closed.');
  if (selected.canceled || selected.filePaths.length !== 1) return { cancelled: true };
  const root = canonicalTrustedWorkspacePath(selected.filePaths[0]);
  if (!fs.statSync(root).isDirectory() || path.dirname(root) === root || protectedPath(root)) throw new Error('Choose a project folder outside protected system/runtime/profile folders.');
  if (!workspacePathWithin(canonicalTrustedWorkspacePath(homeDir()), root)) {
    const roots = [...new Set([...grants(), root])].slice(-100), file = trustFile();
    fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ roots }), { mode: 0o600 }); fs.renameSync(temporary, file);
  }
  return { cancelled: false, root };
}
