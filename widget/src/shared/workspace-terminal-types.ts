export interface WorkspaceTerminalProfile { id: string; label: string; executable: string }
export interface WorkspaceTerminalCreateRequest { projectDir: string; profileId?: string; cols?: number; rows?: number }
export interface WorkspaceTerminalEvent { sessionId: string; seq: number; type: 'data' | 'exit'; data?: string; exitCode?: number }
export interface WorkspaceTerminalSessionInfo { sessionId: string; profileId: string; cwd: string; pid: number; output: string; seq: number }
export interface WorkspaceTerminalResult { success: boolean; error?: string; session?: WorkspaceTerminalSessionInfo; profiles?: WorkspaceTerminalProfile[] }
