/** Project-owned Prettier/ESLint, run in a main-process worker for allowed projects only. */
export type ProjectToolsAction = 'status' | 'allow' | 'revoke' | 'format' | 'lint';
export interface ProjectToolsRequest { action: ProjectToolsAction; root: string; path?: string; content?: string }
export interface ProjectToolsStatus { allowed: boolean; prettier: { version: string } | null; eslint: { version: string } | null }
export interface ProjectToolDiagnostic { line: number; column: number; endLine?: number; endColumn?: number; severity: 'error' | 'warning'; message: string; ruleId?: string }
export interface ProjectToolsResult {
  success: boolean;
  error?: string;
  status?: ProjectToolsStatus;
  formatted?: string;
  diagnostics?: ProjectToolDiagnostic[];
  /** Human-readable reason the tool did not run (not installed, ignored, too large). */
  skipped?: string;
}
