/** Read-only language queries; edits always return to the user's unsaved buffers. */
export type WorkspaceLanguageAction = 'complete' | 'hover' | 'signature' | 'definition' | 'references' | 'rename' | 'fixes' | 'format' | 'symbols' | 'files' | 'diagnostics';
export interface WorkspaceLanguageBuffer { path: string; content: string }
export interface WorkspaceLanguageRequest {
  root: string;
  path: string;
  content: string;
  buffers?: WorkspaceLanguageBuffer[];
  position?: number;
  action: WorkspaceLanguageAction;
  newName?: string;
  tabSize?: number;
}
export interface WorkspaceLanguageLocation { path: string; line: number; column: number; start: number; length: number; name?: string }
export interface WorkspaceLanguageEdit { path: string; expectedContent: string; changes: Array<{ start: number; length: number; text: string }> }
export interface WorkspaceLanguageResult {
  success: boolean;
  error?: string;
  entries?: Array<{ label: string; type?: string; detail?: string }>;
  text?: string;
  locations?: WorkspaceLanguageLocation[];
  edits?: WorkspaceLanguageEdit[];
  fixes?: Array<{ description: string; edits: WorkspaceLanguageEdit[] }>;
  files?: string[];
  diagnostics?: Array<{ start: number; length: number; severity: 'error' | 'warning' | 'info'; message: string }>;
}
