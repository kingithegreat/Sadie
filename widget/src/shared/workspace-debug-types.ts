export interface WorkspaceDebugRequest {
  root: string;
  action: 'start' | 'state' | 'stop' | 'resume' | 'pause' | 'step-over' | 'step-in' | 'step-out' | 'breakpoint' | 'evaluate' | 'scopes';
  file?: string; line?: number; remove?: boolean; frameId?: string; expression?: string; args?: string[];
}
export interface WorkspaceDebugFrame { id: string; name: string; path: string; line: number; column: number }
export interface WorkspaceDebugResult {
  success: boolean; error?: string; running?: boolean; paused?: boolean; output?: string;
  frames?: WorkspaceDebugFrame[]; breakpoints?: Array<{ path: string; line: number }>;
  value?: string; variables?: Array<{ name: string; value: string }>;
}
