/** Generic language-server bridge (LSP) between CodeMirror and main-process servers. */
export type LspAction = 'status' | 'allow' | 'install' | 'complete' | 'hover' | 'definition' | 'diagnostics';
export interface LspRequest { action: LspAction; root: string; path: string; content?: string; position?: number }
export interface LspServerStatus {
  id: string;
  label: string;
  /** Where the server binary was found, or null when it is not available. */
  source: 'project' | 'homebot' | 'path' | null;
  allowed: boolean;
  installable: boolean;
  version?: string;
}
export interface LspLocation { path: string; line: number; column: number; start: number; length: number }
export interface LspDiagnostic { start: number; end: number; severity: 'error' | 'warning' | 'info'; message: string; source?: string }
export interface LspResult {
  success: boolean;
  error?: string;
  /** Plain-language reason the server did not answer (not installed, not allowed). */
  skipped?: string;
  status?: LspServerStatus | null;
  entries?: Array<{ label: string; detail?: string; kind?: string; insertText?: string }>;
  from?: number;
  text?: string;
  locations?: LspLocation[];
  diagnostics?: LspDiagnostic[];
}
