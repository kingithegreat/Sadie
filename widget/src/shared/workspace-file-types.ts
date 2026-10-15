/** Human IDE filesystem contracts. Writes always identify the disk version read. */
export interface WorkspaceDiskSnapshot {
  content: string;
  version: string;
  eol: 'lf' | 'crlf';
  bom: boolean;
}
export interface WorkspaceSaveOptions {
  expectedVersion: string;
  eol?: 'lf' | 'crlf';
  bom?: boolean;
}
export interface WorkspaceReadResult extends Partial<WorkspaceDiskSnapshot> {
  success: boolean;
  path?: string;
  language?: string;
  truncated?: boolean;
  error?: string;
}
export interface WorkspaceSaveResult {
  success: boolean;
  version?: string;
  eol?: 'lf' | 'crlf';
  bom?: boolean;
  conflict?: boolean;
  disk?: WorkspaceDiskSnapshot;
  error?: string;
}
export interface WorkspaceFileActionRequest {
  root: string;
  action: 'create-file' | 'create-folder' | 'move' | 'delete' | 'reveal';
  path: string;
  destination?: string;
  content?: string;
}
export interface WorkspaceFileActionResult {
  success: boolean;
  path?: string;
  error?: string;
}
export interface WorkspaceRecoveryTab {
  path: string;
  content: string;
  original: string;
  language?: string;
  version?: string;
  eol?: 'lf' | 'crlf';
  bom?: boolean;
}
export interface WorkspaceRecoveryState {
  files: WorkspaceRecoveryTab[];
  activePath: string | null;
  schema?: number;
  savedAt?: number;
}
export interface WorkspaceRecoveryResult {
  success: boolean;
  state?: WorkspaceRecoveryState | null;
  error?: string;
}
export interface WorkspaceProjectResult {
  success: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}
