/**
 * IDE-11 package-task runner and Problems parser.
 *
 * The renderer may choose a project and a script NAME. It never supplies a
 * command, executable, cwd, or diagnostic path. Main resolves all of those
 * from the project's package.json, asks through the app-wide confirmation
 * channel, and validates the same pre/main/post lifecycle snapshot again
 * immediately before npm starts it.
 */

import { ChildProcess, spawn as nodeSpawn, type SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { stripAnsi, excerptForModel } from '../shared/ansi';
import type {
  WorkspacePackageTask,
  WorkspaceProblem,
  WorkspaceTaskListResult,
  WorkspaceTaskRunResult,
} from '../shared/types';
import { isWithinHomeDir } from './utils/home-boundary';
import { homeDir } from './user-paths';

const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_SCRIPT_COUNT = 500;
const MAX_SCRIPT_NAME = 200;
const MAX_COMMAND_PREVIEW = 4000;
const MAX_PROBLEMS = 500;
const MAX_LINE_BUFFER = 64 * 1024;
const MAX_RETAINED_OUTPUT = 256 * 1024;
const MAX_ACTIVE_TASKS = 3;
export const WORKSPACE_TASK_TIMEOUT_MS = 120_000;

type DiagnosticStream = 'stdout' | 'stderr';

interface PackageManifest {
  scripts?: Record<string, unknown>;
}

export interface WorkspaceTaskSnapshot {
  projectDir: string;
  packageJsonPath: string;
  scriptName: string;
  lifecycle: Array<{ name: string; command: string }>;
}

export interface WorkspaceNpmRunner {
  command: string;
  argsPrefix: string[];
}

export interface WorkspaceTaskExecutionOptions {
  timeoutMs?: number;
  runner?: WorkspaceNpmRunner;
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  terminateProcessTree?: (child: ChildProcess, platform: NodeJS.Platform) => boolean | void | Promise<boolean | void>;
}

const activeTasks = new Map<string, ChildProcess>();

function failMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canonicalExistingPath(input: string): string {
  return fs.realpathSync.native(path.resolve(input));
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Canonical project root; lexical in-home junctions cannot escape the sandbox. */
export function resolveWorkspaceTaskProject(projectDir: unknown): { projectDir: string; packageJsonPath: string } {
  if (typeof projectDir !== 'string' || !projectDir.trim()) throw new Error('Choose a project folder first.');
  const requested = path.resolve(projectDir.trim());
  let project: string;
  let home: string;
  try {
    project = canonicalExistingPath(requested);
    home = canonicalExistingPath(homeDir());
  } catch {
    throw new Error('The selected project folder no longer exists.');
  }
  if (!isWithinHomeDir(project, home)) {
    throw new Error(`Project folder must be within your home directory (${home}).`);
  }
  const stat = fs.statSync(project);
  if (!stat.isDirectory()) throw new Error('The selected project path is not a folder.');

  const packageJsonPath = path.join(project, 'package.json');
  let packageReal: string;
  try {
    packageReal = canonicalExistingPath(packageJsonPath);
  } catch {
    throw new Error('No package.json was found in this project folder.');
  }
  if (!isWithin(project, packageReal) || !fs.statSync(packageReal).isFile()) {
    throw new Error('The project package.json must be a file inside the project folder.');
  }
  return { projectDir: project, packageJsonPath: packageReal };
}

function readManifest(packageJsonPath: string): PackageManifest {
  const stat = fs.statSync(packageJsonPath);
  if (stat.size > MAX_PACKAGE_BYTES) throw new Error('package.json is too large to inspect safely.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    throw new Error('package.json is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('package.json must contain a JSON object.');
  }
  return parsed as PackageManifest;
}

function scriptEntries(manifest: PackageManifest): Array<[string, string]> {
  if (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts)) return [];
  const entries = Object.entries(manifest.scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  if (entries.length > MAX_SCRIPT_COUNT) throw new Error(`package.json has more than ${MAX_SCRIPT_COUNT} scripts and cannot be inspected safely.`);
  if (entries.some(([name]) => name.length === 0 || name.length > MAX_SCRIPT_NAME || /[\0\r\n]/.test(name))) {
    throw new Error(`package.json contains a script name that exceeds ${MAX_SCRIPT_NAME} characters or contains unsafe control characters.`);
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

export function listWorkspacePackageTasks(projectDir: unknown): WorkspaceTaskListResult {
  try {
    const resolved = resolveWorkspaceTaskProject(projectDir);
    const tasks: WorkspacePackageTask[] = scriptEntries(readManifest(resolved.packageJsonPath)).map(([name, command]) => ({
      name,
      command: command.slice(0, MAX_COMMAND_PREVIEW),
    }));
    return { success: true, projectDir: resolved.projectDir, tasks };
  } catch (error) {
    return { success: false, error: failMessage(error) };
  }
}

/** Main-owned script/lifecycle snapshot used both for consent and stale rejection. */
export function prepareWorkspacePackageTask(projectDir: unknown, scriptName: unknown): WorkspaceTaskSnapshot {
  if (typeof scriptName !== 'string' || !scriptName || scriptName.startsWith('-') || scriptName.length > MAX_SCRIPT_NAME || /[\0\r\n]/.test(scriptName)) {
    throw new Error('Choose a valid package script.');
  }
  const resolved = resolveWorkspaceTaskProject(projectDir);
  const scripts = new Map(scriptEntries(readManifest(resolved.packageJsonPath)));
  const command = scripts.get(scriptName);
  if (command === undefined) throw new Error(`Package script “${scriptName}” no longer exists.`);

  const lifecycle: Array<{ name: string; command: string }> = [];
  const pre = scripts.get(`pre${scriptName}`);
  const post = scripts.get(`post${scriptName}`);
  if (pre !== undefined) lifecycle.push({ name: `pre${scriptName}`, command: pre });
  lifecycle.push({ name: scriptName, command });
  if (post !== undefined) lifecycle.push({ name: `post${scriptName}`, command: post });
  return { ...resolved, scriptName, lifecycle };
}

export function workspaceTaskConfirmationMessage(snapshot: WorkspaceTaskSnapshot): string {
  const commands = snapshot.lifecycle.map(step => `${step.name}: ${step.command}`).join('\n');
  return `Run package script “${snapshot.scriptName}” in:\n${snapshot.projectDir}\n\n` +
    `npm will run these package.json lifecycle commands:\n${commands}\n\n` +
    'npm configuration and package-manager hooks can also affect execution. Only approve projects you trust.\n\nAllow this once?';
}

function snapshotsEqual(a: WorkspaceTaskSnapshot, b: WorkspaceTaskSnapshot): boolean {
  return a.projectDir === b.projectDir && a.packageJsonPath === b.packageJsonPath &&
    a.scriptName === b.scriptName && JSON.stringify(a.lifecycle) === JSON.stringify(b.lifecycle);
}

function pathDirectories(env: NodeJS.ProcessEnv): string[] {
  const raw = env.Path || env.PATH || '';
  return raw.split(path.delimiter).map(value => value.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

/**
 * Resolve npm without assuming Electron is Node. On Windows, execute npm's JS
 * CLI with the real node.exe beside it, avoiding a renderer-controlled cmd.exe
 * command string. POSIX npm launchers are executable shebang files.
 */
export function resolveWorkspaceNpmRunner(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): WorkspaceNpmRunner {
  if (platform === 'win32') {
    const dirs = [...pathDirectories(env)];
    if (env.ProgramFiles) dirs.push(path.join(env.ProgramFiles, 'nodejs'));
    for (const dir of [...new Set(dirs.map(value => path.resolve(value)))]) {
      const node = path.join(dir, 'node.exe');
      const npmCli = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (fs.existsSync(node) && fs.existsSync(npmCli)) {
        return { command: canonicalExistingPath(node), argsPrefix: [canonicalExistingPath(npmCli)] };
      }
    }
    throw new Error('Node.js with npm was not found on PATH. Install Node.js to run package scripts.');
  }

  for (const dir of pathDirectories(env)) {
    const npm = path.join(dir, 'npm');
    try {
      fs.accessSync(npm, fs.constants.X_OK);
      return { command: canonicalExistingPath(npm), argsPrefix: [] };
    } catch { /* try the next PATH entry */ }
  }
  throw new Error('npm was not found on PATH. Install Node.js to run package scripts.');
}

function resolveProblemPath(projectDir: string, rawPath: string): { path: string; file: string } | null {
  const cleaned = rawPath.trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned || cleaned.includes('\0')) return null;
  const candidate = path.isAbsolute(cleaned) ? path.normalize(cleaned) : path.resolve(projectDir, cleaned);
  if (!isWithin(projectDir, candidate)) return null;
  try {
    const real = canonicalExistingPath(candidate);
    if (!isWithin(projectDir, real) || !fs.statSync(real).isFile()) return null;
    return { path: real, file: path.relative(projectDir, real) || path.basename(real) };
  } catch {
    return null;
  }
}

function unresolvedProblem(rawPath: string): { path: string; file: string; clickable: false } {
  const file = rawPath.trim().replace(/^['"]|['"]$/g, '').slice(0, 500) || '(unknown file)';
  return { path: '', file, clickable: false };
}

function plainDiagnosticLine(raw: string): string {
  // Keep tabs/spaces used by ESLint's stylish formatter, but remove terminal
  // controls that could forge rows or affect the renderer.
  return stripAnsi(raw).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/** Stateful because ESLint stylish prints a file header followed by rows. */
export class WorkspaceTaskDiagnosticParser {
  private readonly buffers: Record<DiagnosticStream, string> = { stdout: '', stderr: '' };
  private readonly eslintFiles: Partial<Record<DiagnosticStream, { path: string; file: string; clickable?: false }>> = {};
  private readonly found: WorkspaceProblem[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly projectDir: string) {}

  push(stream: DiagnosticStream, chunk: string): void {
    let combined = this.buffers[stream] + chunk;
    if (combined.length > MAX_LINE_BUFFER && !combined.includes('\n')) combined = combined.slice(-MAX_LINE_BUFFER);
    const lines = combined.split(/\r?\n/);
    this.buffers[stream] = lines.pop() || '';
    for (const line of lines) this.parseLine(stream, line);
  }

  finish(): WorkspaceProblem[] {
    for (const stream of ['stdout', 'stderr'] as const) {
      if (this.buffers[stream]) this.parseLine(stream, this.buffers[stream]);
      this.buffers[stream] = '';
    }
    return [...this.found];
  }

  private add(problem: WorkspaceProblem): void {
    if (this.found.length >= MAX_PROBLEMS) return;
    const key = `${problem.path}\0${problem.line}\0${problem.column}\0${problem.severity}\0${problem.code || ''}\0${problem.message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.found.push(problem);
  }

  private parseLine(stream: DiagnosticStream, raw: string): void {
    const line = plainDiagnosticLine(raw);
    if (!line.trim()) return;

    // TypeScript: src/file.ts(2,7): error TS2322: Type ...
    const ts = /^(.*)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/i.exec(line);
    if (ts) {
      const target = resolveProblemPath(this.projectDir, ts[1]) || unresolvedProblem(ts[1]);
      this.add({ ...target, line: Number(ts[2]), column: Number(ts[3]), severity: ts[4].toLowerCase() as 'error' | 'warning', source: 'typescript', code: ts[5], message: ts[6].trim().slice(0, 2000) });
      return;
    }

    // ESLint unix formatter: file.ts:2:7: message [Error/rule-name]
    const unix = /^(.+):(\d+):(\d+):\s*(.+?)(?:\s+\[(Error|Warning)\/([^\]]+)\])$/i.exec(line);
    if (unix) {
      const target = resolveProblemPath(this.projectDir, unix[1]) || unresolvedProblem(unix[1]);
      this.add({ ...target, line: Number(unix[2]), column: Number(unix[3]), severity: unix[5].toLowerCase() as 'error' | 'warning', source: 'eslint', code: unix[6], message: unix[4].trim().slice(0, 2000) });
      return;
    }

    // ESLint stylish row under the most recent absolute/relative file header.
    const stylish = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([^\s]+))?\s*$/i.exec(line);
    if (stylish && this.eslintFiles[stream]) {
      this.add({ ...this.eslintFiles[stream]!, line: Number(stylish[1]), column: Number(stylish[2]), severity: stylish[3].toLowerCase() as 'error' | 'warning', source: 'eslint', ...(stylish[5] ? { code: stylish[5] } : {}), message: stylish[4].trim().slice(0, 2000) });
      return;
    }

    const trimmed = line.trim();
    const looksLikeHeader = !/^\s/.test(line) && (
      path.isAbsolute(trimmed) || /^(?:\.{1,2})?[\\/]/.test(trimmed) || /\.[A-Za-z0-9]+$/.test(trimmed)
    );
    if (looksLikeHeader) {
      this.eslintFiles[stream] = resolveProblemPath(this.projectDir, trimmed) || unresolvedProblem(trimmed);
    } else {
      // npm banners and other unmatched output terminate the previous stylish
      // block; a later row must never inherit a stale file header.
      delete this.eslintFiles[stream];
    }
  }
}

function appendTail(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > MAX_RETAINED_OUTPUT ? next.slice(-MAX_RETAINED_OUTPUT) : next;
}

async function terminateTaskTree(child: ChildProcess, platform: NodeJS.Platform): Promise<boolean> {
  if (!child.pid) return true;
  try {
    if (platform === 'win32') {
      return await new Promise<boolean>(resolve => {
        const killer = nodeSpawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(limit);
          resolve(ok);
        };
        killer.stderr?.on('data', (value: Buffer | string) => {
          console.warn(`[workspace-task] taskkill: ${value.toString().trim().slice(0, 1000)}`);
        });
        killer.once('error', () => done(false));
        killer.once('close', code => done(code === 0));
        const limit = setTimeout(() => {
          try { killer.kill('SIGKILL'); } catch { /* already exited */ }
          done(false);
        }, 2000);
        limit.unref?.();
      });
    } else {
      process.kill(-child.pid, 'SIGTERM');
      return true;
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
    return false;
  }
}

export function closeAllWorkspaceTasks(): void {
  for (const child of activeTasks.values()) void terminateTaskTree(child, process.platform);
}

export async function executeWorkspacePackageTask(
  approved: WorkspaceTaskSnapshot,
  options: WorkspaceTaskExecutionOptions = {},
): Promise<WorkspaceTaskRunResult> {
  let current: WorkspaceTaskSnapshot;
  try {
    current = prepareWorkspacePackageTask(approved.projectDir, approved.scriptName);
  } catch (error) {
    return { success: false, error: failMessage(error) };
  }
  if (!snapshotsEqual(approved, current)) {
    return { success: false, error: 'package.json changed while approval was open. Review the script again before running it.' };
  }
  if (activeTasks.has(current.projectDir)) return { success: false, error: 'A package task is already running in this project.' };
  if (activeTasks.size >= MAX_ACTIVE_TASKS) return { success: false, error: 'Too many package tasks are already running.' };
  if (options.signal?.aborted) return { success: false, cancelled: true, error: 'Task stopped because the HomeBot window closed.' };

  let runner: WorkspaceNpmRunner;
  try {
    runner = options.runner || resolveWorkspaceNpmRunner(options.env, options.platform);
  } catch (error) {
    return { success: false, error: failMessage(error) };
  }

  const spawnProcess = options.spawnProcess || ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));
  const platform = options.platform || process.platform;
  const timeoutMs = Math.min(Math.max(1000, options.timeoutMs || WORKSPACE_TASK_TIMEOUT_MS), WORKSPACE_TASK_TIMEOUT_MS);
  const parser = new WorkspaceTaskDiagnosticParser(current.projectDir);
  let output = '';
  let timedOut = false;
  let aborted = false;
  const startedAt = Date.now();

  return await new Promise<WorkspaceTaskRunResult>((resolve) => {
    let child: ChildProcess | undefined;
    let timer: NodeJS.Timeout | undefined;
    let forcedFinish: NodeJS.Timeout | undefined;
    let termination: Promise<boolean> | undefined;
    let terminationProven = true;
    let settled = false;
    const finish = (result: WorkspaceTaskRunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forcedFinish) clearTimeout(forcedFinish);
      options.signal?.removeEventListener('abort', onAbort);
      if (terminationProven) activeTasks.delete(current.projectDir);
      resolve(result);
    };
    const stopTree = async () => {
      if (termination) return termination;
      try {
        const result = (options.terminateProcessTree || terminateTaskTree)(child!, platform);
        termination = Promise.resolve(result).then(value => value !== false, () => false);
      } catch {
        termination = Promise.resolve(false);
      }
      terminationProven = await termination;
      return terminationProven;
    };
    const scheduleForcedFinish = (result: WorkspaceTaskRunResult) => {
      if (forcedFinish) clearTimeout(forcedFinish);
      forcedFinish = setTimeout(() => finish(result), 500);
      forcedFinish.unref?.();
    };
    const onAbort = () => {
      aborted = true;
      if (timer) clearTimeout(timer);
      void stopTree().then(proven => {
        scheduleForcedFinish({ success: false, cancelled: true, error: proven ? 'Task stopped because the HomeBot window closed.' : 'Task cancellation could not prove the process tree stopped.' });
      });
    };

    try {
      child = spawnProcess(runner.command, [...runner.argsPrefix, 'run-script', current.scriptName], {
        cwd: current.projectDir,
        windowsHide: true,
        detached: platform !== 'win32',
        shell: false,
        env: { ...process.env, ...options.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ success: false, error: `Could not start npm: ${failMessage(error)}` });
      return;
    }
    activeTasks.set(current.projectDir, child);

    timer = setTimeout(() => {
      timedOut = true;
      void stopTree().then(proven => {
        scheduleForcedFinish({ success: false, timedOut: true, error: proven ? `Task stopped after ${Math.round(timeoutMs / 1000)} seconds.` : 'Task timed out, but HomeBot could not prove its process tree stopped.' });
      });
    }, timeoutMs);
    timer.unref?.();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (value: Buffer | string) => {
      const chunk = value.toString();
      parser.push('stdout', chunk);
      output = appendTail(output, chunk);
    });
    child.stderr?.on('data', (value: Buffer | string) => {
      const chunk = value.toString();
      parser.push('stderr', chunk);
      output = appendTail(output, chunk);
    });
    child.once('error', async error => {
      if (termination) await termination;
      finish({
        success: false,
        error: termination && !terminationProven
          ? `npm exited while stopping, but HomeBot could not prove its process tree stopped: ${failMessage(error)}`
          : `npm could not start: ${failMessage(error)}`,
      });
    });
    child.once('close', async code => {
      if (termination) await termination;
      const problems = parser.finish();
      finish({
        success: !aborted && !timedOut,
        ...(aborted ? { cancelled: true, error: terminationProven ? 'Task stopped because the HomeBot window closed.' : 'Task cancellation could not prove the process tree stopped.' } : {}),
        timedOut,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        problems,
        outputExcerpt: excerptForModel(output, { maxLines: 100, maxChars: 8000 }),
        ...(timedOut ? { error: terminationProven ? `Task stopped after ${Math.round(timeoutMs / 1000)} seconds.` : 'Task timed out, but HomeBot could not prove its process tree stopped.' } : {}),
      });
    });
  });
}
