/**
 * Live Prettier and ESLint using the project's OWN installed packages.
 *
 * Running a project's formatter/linter executes workspace code (configs and
 * plugins are JavaScript), so it is gated twice: the folder must pass the IDE
 * path trust (picker/home), AND the user must have allowed project tools for
 * that folder through a native main-process dialog. Nothing runs in the
 * renderer: each project gets one worker thread in the main process, with a
 * heap cap and a hard per-request timeout that terminates the worker.
 * If prettier/eslint are not installed in the project, nothing happens.
 */
import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { Worker } from 'worker_threads';
import { validateTrustedWorkspaceRoot, checkedTrustedWorkspacePath, workspacePathWithin } from './workspace-trust';
import { getMainWindow } from './window-manager';
import type { ProjectToolsRequest, ProjectToolsResult, ProjectToolsStatus } from '../shared/workspace-project-tools-types';

export const PROJECT_TOOLS_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const IDLE_DISPOSE_MS = 3 * 60_000;
export const LINTABLE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;

const trustFile = () => path.join(app.getPath('userData'), 'ide-project-tools-trust.json');
function readGrants(): string[] {
  try {
    const bytes = fs.readFileSync(trustFile()); if (bytes.length > 50_000) return [];
    const data = JSON.parse(bytes.toString('utf8'));
    return Array.isArray(data.roots) ? data.roots.filter((item: unknown) => typeof item === 'string').slice(-100) : [];
  } catch { return []; }
}
function writeGrants(roots: string[]): void {
  const file = trustFile(); fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ roots: roots.slice(-100) }), { mode: 0o600 }); fs.renameSync(temporary, file);
}
export function projectToolsAllowed(root: string): boolean { return readGrants().includes(root); }

/** Resolve a package from the project's own node_modules; never HomeBot's copy. */
export function resolveProjectTool(root: string, name: 'prettier' | 'eslint'): { version: string; entry: string } | null {
  try {
    const requireFromProject = createRequire(path.join(root, 'package.json'));
    const entry = fs.realpathSync(requireFromProject.resolve(name));
    if (!workspacePathWithin(root, entry)) return null;
    let directory = path.dirname(entry);
    while (workspacePathWithin(root, directory)) {
      const manifest = path.join(directory, 'package.json');
      if (fs.existsSync(manifest)) {
        const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (data?.name === name) return { version: String(data.version || 'unknown'), entry };
      }
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
    }
    return null;
  } catch { return null; }
}

export function projectToolsStatus(root: string): ProjectToolsStatus {
  const prettier = resolveProjectTool(root, 'prettier'), eslint = resolveProjectTool(root, 'eslint');
  return { allowed: projectToolsAllowed(root), prettier: prettier ? { version: prettier.version } : null, eslint: eslint ? { version: eslint.version } : null };
}

/** Plain CommonJS so it runs unchanged as an eval'd worker in the packaged app. */
export const PROJECT_TOOLS_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('worker_threads');
const { createRequire } = require('module');
const path = require('path');
const projectRequire = createRequire(path.join(workerData.root, 'package.json'));
let eslintInstance;
async function eslint() {
  if (eslintInstance) return eslintInstance;
  const mod = projectRequire('eslint');
  const Engine = typeof mod.loadESLint === 'function' ? await mod.loadESLint({ cwd: workerData.root }) : mod.ESLint;
  eslintInstance = new Engine({ cwd: workerData.root });
  return eslintInstance;
}
async function run(job) {
  if (job.kind === 'format') {
    const prettier = projectRequire('prettier');
    const info = await prettier.getFileInfo(job.file, { ignorePath: path.join(workerData.root, '.prettierignore') });
    if (info.ignored) return { ignored: true };
    if (!info.inferredParser) return { unsupported: true };
    const options = (await prettier.resolveConfig(job.file, { editorconfig: true })) || {};
    return { formatted: await prettier.format(job.content, Object.assign({}, options, { filepath: job.file })) };
  }
  const engine = await eslint();
  if (await engine.isPathIgnored(job.file)) return { ignored: true };
  const results = await engine.lintText(job.content, { filePath: job.file });
  const messages = (results[0] && results[0].messages) || [];
  return { diagnostics: messages.slice(0, 500).map(m => ({ line: m.line || 1, column: m.column || 1, endLine: m.endLine, endColumn: m.endColumn,
    severity: m.severity === 2 ? 'error' : 'warning', message: String(m.message || ''), ruleId: m.ruleId || undefined })) };
}
parentPort.on('message', job => {
  run(job).then(result => parentPort.postMessage({ id: job.id, result }), error => parentPort.postMessage({ id: job.id, error: String((error && error.message) || error).slice(0, 2000) }));
});
`;

interface Pending { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
class ProjectToolsWorker {
  private worker: Worker;
  private pending = new Map<string, Pending>();
  private idle?: NodeJS.Timeout;
  constructor(readonly root: string, private readonly onExit: () => void) {
    this.worker = new Worker(PROJECT_TOOLS_WORKER_SOURCE, { eval: true, workerData: { root }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    this.worker.on('message', (message: { id: string; result?: unknown; error?: string }) => {
      const entry = this.pending.get(message.id); if (!entry) return;
      this.pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error !== undefined) entry.reject(new Error(message.error)); else entry.resolve(message.result);
    });
    const fail = (error: Error) => { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear(); this.onExit(); };
    this.worker.on('error', error => fail(error instanceof Error ? error : new Error(String(error))));
    this.worker.on('exit', () => fail(new Error('The project tools worker stopped.')));
    this.worker.unref();
  }
  request(job: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> {
    clearTimeout(this.idle); this.idle = setTimeout(() => this.dispose(), IDLE_DISPOSE_MS); this.idle.unref?.();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Project ${job.kind === 'format' ? 'Prettier' : 'ESLint'} took longer than ${Math.round(timeoutMs / 1000)}s and was stopped.`)); this.dispose(); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...job, id });
    });
  }
  dispose(): void {
    // Leave the map synchronously so the next request never reaches a terminating worker.
    clearTimeout(this.idle); this.onExit();
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('The project tools worker was stopped.')); }
    this.pending.clear(); void this.worker.terminate();
  }
}
const workers = new Map<string, ProjectToolsWorker>();
function workerFor(root: string): ProjectToolsWorker {
  let worker = workers.get(root);
  if (!worker) { const created: ProjectToolsWorker = new ProjectToolsWorker(root, () => { if (workers.get(root) === created) workers.delete(root); }); worker = created; workers.set(root, worker); }
  return worker;
}
export function disposeProjectToolWorkers(): void { for (const worker of [...workers.values()]) worker.dispose(); workers.clear(); }

async function confirmGrant(root: string): Promise<boolean> {
  const window = getMainWindow();
  if (!window || window.isDestroyed()) return false;
  const choice = await dialog.showMessageBox(window, {
    type: 'warning', buttons: ['Allow project tools', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
    title: 'Run project tools?',
    message: `Allow HomeBot to run project tools (Prettier, ESLint, language servers such as Pyright) for this folder?\n\n${root}`,
    detail: 'They read the project and its config files, and project-installed tools and plugins are code from the project; they run on this PC in the background, not in the editor. Only allow projects you trust. You can turn this off again in Editor settings.',
  });
  return choice.response === 0;
}

export async function handleProjectToolsRequest(request: ProjectToolsRequest, deps: { confirm?: (root: string) => Promise<boolean>; timeoutMs?: number } = {}): Promise<ProjectToolsResult> {
  try {
    if (!request || typeof request !== 'object' || typeof request.root !== 'string') throw new Error('Invalid project tools request.');
    const root = validateTrustedWorkspaceRoot(request.root);
    switch (request.action) {
      case 'status': return { success: true, status: projectToolsStatus(root) };
      case 'allow': {
        if (!(await (deps.confirm || confirmGrant)(root))) return { success: true, status: projectToolsStatus(root) };
        writeGrants([...readGrants().filter(item => item !== root), root]);
        return { success: true, status: projectToolsStatus(root) };
      }
      case 'revoke': {
        writeGrants(readGrants().filter(item => item !== root)); workers.get(root)?.dispose(); workers.delete(root);
        return { success: true, status: projectToolsStatus(root) };
      }
      case 'format':
      case 'lint': {
        if (typeof request.path !== 'string' || typeof request.content !== 'string') throw new Error('Invalid project tools request.');
        if (Buffer.byteLength(request.content) > PROJECT_TOOLS_MAX_BYTES) return { success: true, skipped: 'This file is larger than 2 MB, so project Prettier/ESLint were skipped.' };
        const file = checkedTrustedWorkspacePath(root, request.path);
        if (!projectToolsAllowed(root)) return { success: true, skipped: 'Project tools are not allowed for this folder.' };
        const tool = request.action === 'format' ? 'prettier' : 'eslint';
        if (!resolveProjectTool(root, tool)) return { success: true, skipped: `${tool === 'prettier' ? 'Prettier' : 'ESLint'} is not installed in this project.` };
        if (request.action === 'lint' && !LINTABLE.test(file)) return { success: true, diagnostics: [] };
        const result = await workerFor(root).request({ kind: request.action, file, content: request.content }, deps.timeoutMs);
        if (result?.ignored) return { success: true, skipped: `This file is ignored by the project's ${tool === 'prettier' ? '.prettierignore' : 'ESLint config'}.`, ...(request.action === 'lint' ? { diagnostics: [] } : {}) };
        if (result?.unsupported) return { success: true, skipped: 'Prettier has no parser for this file type.' };
        if (request.action === 'format') return { success: true, formatted: typeof result?.formatted === 'string' ? result.formatted : request.content };
        return { success: true, diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : [] };
      }
      default: throw new Error('Unknown project tools action.');
    }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
