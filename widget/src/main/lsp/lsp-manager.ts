/**
 * Runs language servers for trusted, allowed projects and answers editor
 * queries (completion, hover, definition, diagnostics) for unsaved buffers.
 * Servers run as child processes of the main process (no shell); never in the renderer.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { LspConnection } from './lsp-connection';
import { LANGUAGE_SERVERS, resolveLanguageServer, serverForFile, homebotServersDir, type LanguageServerConfig } from './lsp-servers';
import { validateTrustedWorkspaceRoot, checkedTrustedWorkspacePath, workspacePathWithin } from '../workspace-trust';
import { projectToolsAllowed, handleProjectToolsRequest } from '../workspace-project-tools';
import { resolveWorkspaceNpmRunner } from '../workspace-tasks';
import { getSettings } from '../config-manager';
import { resolveCloudLLM } from '../../shared/cloud-llm';
import type { LspDiagnostic, LspLocation, LspRequest, LspResult, LspServerStatus } from '../../shared/workspace-lsp-types';

const MAX_BYTES = 2 * 1024 * 1024;
const COMPLETION_KINDS = ['', 'text', 'method', 'function', 'constructor', 'field', 'variable', 'class', 'interface', 'module', 'property', 'unit', 'value', 'enum', 'keyword', 'snippet', 'color', 'file', 'reference', 'folder', 'enumMember', 'constant', 'struct', 'event', 'operator', 'typeParameter'];

export function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const line = before.split('\n').length - 1;
  return { line, character: before.length - (before.lastIndexOf('\n') + 1) };
}
export function positionToOffset(text: string, position: { line: number; character: number }): number {
  let offset = 0;
  for (let line = 0; line < position.line; line++) { const next = text.indexOf('\n', offset); if (next < 0) return text.length; offset = next + 1; }
  const end = text.indexOf('\n', offset);
  return Math.min(offset + position.character, end < 0 ? text.length : end);
}
export function hoverText(contents: any): string {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join('\n\n');
  if (typeof contents.value === 'string') return contents.kind === 'markdown' ? contents.value.replace(/^```\w*\n?|```$/gm, '').trim() : contents.value;
  return '';
}

class LspSession {
  connection: LspConnection;
  ready: Promise<void>;
  private documents = new Map<string, { version: number; text: string }>();
  private diagnostics = new Map<string, { version: number | null; items: any[] }>();
  private waiters = new Set<() => void>();
  constructor(readonly root: string, readonly config: LanguageServerConfig, command: string, args: string[], env: NodeJS.ProcessEnv, onExit: () => void) {
    const child = spawn(command, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    this.connection = new LspConnection(child, {
      requestTimeoutMs: 5000, onExit,
      onNotification: (method, params) => {
        if (method !== 'textDocument/publishDiagnostics' || typeof params?.uri !== 'string') return;
        this.diagnostics.set(params.uri, { version: typeof params.version === 'number' ? params.version : null, items: Array.isArray(params.diagnostics) ? params.diagnostics.slice(0, 500) : [] });
        for (const wake of [...this.waiters]) wake();
      },
    });
    const rootUri = pathToFileURL(root).href;
    this.ready = this.connection.request('initialize', {
      processId: process.pid, rootUri, rootPath: root, workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
      initializationOptions: config.initializationOptions,
      capabilities: { textDocument: { synchronization: { didSave: false }, completion: { completionItem: { snippetSupport: false, documentationFormat: ['plaintext'] } }, hover: { contentFormat: ['plaintext', 'markdown'] }, definition: {}, publishDiagnostics: { versionSupport: true } }, workspace: { configuration: true, workspaceFolders: true } },
    }, 30_000).then(() => { this.connection.notify('initialized', {}); });
  }
  sync(file: string, text: string): string {
    const uri = pathToFileURL(file).href, current = this.documents.get(uri);
    if (!current) { this.documents.set(uri, { version: 1, text }); this.connection.notify('textDocument/didOpen', { textDocument: { uri, languageId: this.config.languageId, version: 1, text } }); }
    else if (current.text !== text) { current.version++; current.text = text; this.connection.notify('textDocument/didChange', { textDocument: { uri, version: current.version }, contentChanges: [{ text }] }); }
    return uri;
  }
  async diagnosticsFor(uri: string, waitMs = 2500): Promise<any[]> {
    const version = this.documents.get(uri)?.version ?? null;
    const fresh = () => { const entry = this.diagnostics.get(uri); return entry && (entry.version === null || version === null || entry.version >= version) ? entry : undefined; };
    if (!fresh()) await new Promise<void>(resolve => { const timer = setTimeout(done, waitMs); function done() { clearTimeout(timer); sessionWaiters.delete(wake); resolve(); } const sessionWaiters = this.waiters; const wake = () => { if (fresh()) done(); }; sessionWaiters.add(wake); });
    return (fresh() || this.diagnostics.get(uri))?.items || [];
  }
  dispose(): void { this.connection.dispose(); }
}

const sessions = new Map<string, LspSession>();
const crashes = new Map<string, number[]>();
export function disposeLanguageServers(): void { for (const session of sessions.values()) session.dispose(); sessions.clear(); }

function onlineAllowed(): boolean { try { return resolveCloudLLM(getSettings()).intended; } catch { return false; } }

export function languageServerStatus(root: string, file: string): LspServerStatus | null {
  const config = serverForFile(file); if (!config) return null;
  const resolved = resolveLanguageServer(root, config);
  return { id: config.id, label: config.label, source: resolved?.source ?? null, allowed: projectToolsAllowed(root), installable: !resolved && !!config.npm, ...(resolved?.version ? { version: resolved.version } : {}) };
}

async function session(root: string, config: LanguageServerConfig): Promise<LspSession> {
  const key = `${root}\0${config.id}`;
  const existing = sessions.get(key); if (existing && !existing.connection.isClosed) { await existing.ready; return existing; }
  const recent = (crashes.get(key) || []).filter(at => Date.now() - at < 5 * 60_000);
  if (recent.length >= 3) throw new Error(`${config.label} stopped ${recent.length} times in 5 minutes, so HomeBot stopped restarting it. Reopen the project to try again.`);
  const resolved = resolveLanguageServer(root, config); if (!resolved) throw new Error(`${config.label} is not installed.`);
  const created: LspSession = new LspSession(root, config, resolved.command, resolved.args, resolved.env, () => { if (sessions.get(key) === created) { sessions.delete(key); crashes.set(key, [...recent, Date.now()]); } });
  sessions.set(key, created);
  await created.ready;
  return created;
}

function location(root: string, uri: string, range: any, openFile: string, openText: string): LspLocation | null {
  try {
    const file = fileURLToPath(uri);
    const target = checkedTrustedWorkspacePath(root, file); // stubs outside the project are not navigable
    const text = path.resolve(target) === path.resolve(openFile) ? openText : (fs.statSync(target).size <= MAX_BYTES ? fs.readFileSync(target, 'utf8') : '');
    const start = positionToOffset(text, range.start), end = positionToOffset(text, range.end);
    return { path: target, line: range.start.line + 1, column: range.start.character + 1, start, length: Math.max(0, end - start) };
  } catch { return null; }
}

async function installServer(config: LanguageServerConfig): Promise<void> {
  if (!config.npm) throw new Error(`${config.label} cannot be installed by HomeBot.`);
  const runner = resolveWorkspaceNpmRunner();
  const prefix = homebotServersDir(); fs.mkdirSync(prefix, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(runner.command, [...runner.argsPrefix, 'install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', config.npm!.installSpec], { cwd: prefix, shell: false, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Installing the language server took longer than 5 minutes.')); }, 5 * 60_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`npm install exited with code ${code}.`)); });
  });
}

export async function handleLspRequest(request: LspRequest, deps: { confirm?: (root: string) => Promise<boolean>; install?: (config: LanguageServerConfig) => Promise<void> } = {}): Promise<LspResult> {
  try {
    if (!request || typeof request !== 'object' || typeof request.root !== 'string' || typeof request.path !== 'string') throw new Error('Invalid language server request.');
    const root = validateTrustedWorkspaceRoot(request.root);
    const file = checkedTrustedWorkspacePath(root, request.path);
    const config = serverForFile(file);
    if (!config) return { success: true, status: null, skipped: 'No language server is configured for this file type.' };
    if (request.action === 'status') return { success: true, status: languageServerStatus(root, file) };
    if (request.action === 'allow') { await handleProjectToolsRequest({ action: 'allow', root }, deps.confirm ? { confirm: deps.confirm } : {}); return { success: true, status: languageServerStatus(root, file) }; }
    if (!projectToolsAllowed(root)) return { success: true, status: languageServerStatus(root, file), skipped: `${config.label} runs only in projects you allow. Allow project tools in Editor settings.` };
    if (request.action === 'install') {
      if (resolveLanguageServer(root, config)) return { success: true, status: languageServerStatus(root, file) };
      if (!onlineAllowed()) return { success: true, status: languageServerStatus(root, file), skipped: `Turn on Online in Settings to download ${config.label} with npm, or install it in the project (npm i -D ${config.npm?.name ?? config.id}).` };
      await (deps.install || installServer)(config);
      return { success: true, status: languageServerStatus(root, file) };
    }
    if (!resolveLanguageServer(root, config)) return { success: true, status: languageServerStatus(root, file), skipped: `${config.label} is not installed.` };
    const content = typeof request.content === 'string' ? request.content : '';
    if (Buffer.byteLength(content) > MAX_BYTES) return { success: true, skipped: 'This file is larger than 2 MB, so the language server was skipped.' };
    const active = await session(root, config);
    const uri = active.sync(file, content);
    const position = offsetToPosition(content, Number.isInteger(request.position) ? request.position! : 0);
    switch (request.action) {
      case 'complete': {
        const result: any = await active.connection.request('textDocument/completion', { textDocument: { uri }, position });
        const items: any[] = Array.isArray(result) ? result : result?.items || [];
        const from = (request.position ?? 0) - (/[\w]*$/.exec(content.slice(0, request.position ?? 0))?.[0].length ?? 0);
        return { success: true, from, entries: items.slice(0, 300).map(item => ({ label: String(item.label), detail: item.detail || undefined, kind: COMPLETION_KINDS[item.kind] || undefined, insertText: item.textEdit?.newText ?? item.insertText ?? undefined })) };
      }
      case 'hover': { const result: any = await active.connection.request('textDocument/hover', { textDocument: { uri }, position }); return { success: true, text: hoverText(result?.contents) }; }
      case 'definition': {
        const result: any = await active.connection.request('textDocument/definition', { textDocument: { uri }, position });
        const raw: any[] = !result ? [] : Array.isArray(result) ? result : [result];
        return { success: true, locations: raw.map(item => location(root, item.targetUri || item.uri, item.targetSelectionRange || item.range, file, content)).filter((item): item is LspLocation => !!item && workspacePathWithin(root, item.path)) };
      }
      case 'diagnostics': {
        const items = await active.diagnosticsFor(uri);
        const diagnostics: LspDiagnostic[] = items.map(item => ({ start: positionToOffset(content, item.range.start), end: positionToOffset(content, item.range.end), severity: item.severity === 1 ? 'error' : item.severity === 2 ? 'warning' : 'info', message: String(item.message || ''), source: item.source }));
        return { success: true, diagnostics };
      }
      default: throw new Error('Unknown language server action.');
    }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
export { LANGUAGE_SERVERS };
