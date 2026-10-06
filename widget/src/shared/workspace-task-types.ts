import type { WorkspaceProblem, WorkspaceTaskRunResult } from './types';
export interface WorkspaceTaskEvent {
  taskId: string;
  projectDir: string;
  scriptName: string;
  running: boolean;
  outputExcerpt?: string;
  problems?: WorkspaceProblem[];
  result?: WorkspaceTaskRunResult;
}
export interface WorkspaceTaskRequest { projectDir: string; scriptName: string; taskId?: string; longRunning?: boolean }
