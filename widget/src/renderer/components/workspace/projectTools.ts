/**
 * Renderer side of project Prettier/ESLint. The renderer only sends the buffer
 * over IPC; the tools themselves run in a main-process worker.
 */
import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { ProjectToolDiagnostic, ProjectToolsRequest, ProjectToolsResult, ProjectToolsStatus } from '../../../shared/workspace-project-tools-types';

type Api = { workspaceProjectTools?: (request: ProjectToolsRequest) => Promise<ProjectToolsResult> };
const api = (): Api | undefined => (typeof window !== 'undefined' ? (window as any).electron : undefined);

export const LINTABLE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;

const statusCache = new Map<string, Promise<ProjectToolsStatus | null>>();
export function projectToolsStatus(root: string, refresh = false): Promise<ProjectToolsStatus | null> {
  if (refresh || !statusCache.has(root)) {
    const call = api()?.workspaceProjectTools;
    statusCache.set(root, call ? call({ action: 'status', root }).then(result => result?.success ? result.status || null : null).catch(() => null) : Promise.resolve(null));
  }
  return statusCache.get(root)!;
}
export async function setProjectToolsAllowed(root: string, allow: boolean): Promise<ProjectToolsStatus | null> {
  const call = api()?.workspaceProjectTools; if (!call) return null;
  const result = await call({ action: allow ? 'allow' : 'revoke', root });
  statusCache.delete(root);
  return result?.success ? result.status || null : null;
}

/** Live ESLint problems, keyed by file path, shared by the editor and the Problems panel. */
export interface LiveProblem { path: string; line: number; column: number; severity: 'error' | 'warning'; message: string; ruleId?: string }
type Listener = () => void;
const liveProblems = new Map<string, LiveProblem[]>();
const listeners = new Set<Listener>();
export function setLiveProblems(path: string, problems: LiveProblem[]): void {
  const previous = liveProblems.get(path);
  if (!problems.length && !previous?.length) return;
  if (problems.length) liveProblems.set(path, problems); else liveProblems.delete(path);
  for (const listener of [...listeners]) listener();
}
export function getLiveProblems(root?: string): LiveProblem[] {
  const all = [...liveProblems.values()].flat();
  return root ? all.filter(problem => problem.path.startsWith(root)) : all;
}
export function subscribeLiveProblems(listener: Listener): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function lineColumnToOffset(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) { const next = text.indexOf('\n', offset); if (next < 0) return text.length; offset = next + 1; }
  const end = text.indexOf('\n', offset);
  return Math.min(offset + Math.max(1, column) - 1, end < 0 ? text.length : end);
}
export function toEditorDiagnostics(text: string, items: ProjectToolDiagnostic[]): Diagnostic[] {
  return items.map(item => {
    const from = lineColumnToOffset(text, item.line, item.column);
    const to = item.endLine ? Math.max(from, lineColumnToOffset(text, item.endLine, item.endColumn || item.column)) : from;
    return { from, to, severity: item.severity, source: 'eslint', message: item.ruleId ? `${item.message} (${item.ruleId})` : item.message };
  });
}

interface LintContext { root?: string; filePath?: string }
/** Debounced on change (CodeMirror's linter delay) and forced on save via forceLinting. */
export function projectLintExtension(context: () => LintContext, delay = 750): Extension {
  return linter(async view => {
    const { root, filePath } = context();
    if (!root || !filePath || !LINTABLE_FILE.test(filePath)) return [];
    const status = await projectToolsStatus(root);
    if (!status?.allowed || !status.eslint) { setLiveProblems(filePath, []); return []; }
    const before = view.state.doc.toString();
    try {
      const result = await api()!.workspaceProjectTools!({ action: 'lint', root, path: filePath, content: before });
      if (view.state.doc.toString() !== before) return [];
      const items = result?.success ? result.diagnostics || [] : [];
      setLiveProblems(filePath, items.map(item => ({ path: filePath, line: item.line, column: item.column, severity: item.severity, message: item.message, ruleId: item.ruleId })));
      if (!result?.success) return [{ from: 0, to: 0, severity: 'info', source: 'eslint', message: `Project ESLint could not run: ${result?.error || 'unknown error'}` }];
      return toEditorDiagnostics(before, items);
    } catch { return []; }
  }, { delay });
}

/** Returns formatted text, or null when Prettier is unavailable/not allowed (caller falls back). */
export async function formatWithProjectPrettier(root: string, filePath: string, content: string): Promise<{ formatted?: string; skipped?: string; error?: string } | null> {
  const status = await projectToolsStatus(root);
  if (!status?.allowed || !status.prettier) return null;
  const result = await api()!.workspaceProjectTools!({ action: 'format', root, path: filePath, content });
  if (!result?.success) return { error: result?.error || 'Project Prettier failed.' };
  if (result.skipped) return { skipped: result.skipped };
  return { formatted: result.formatted ?? content };
}
