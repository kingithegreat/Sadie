export interface WorkspaceTerminalProfile { id: string; label: string; executable: string }
export interface WorkspaceTerminalCreateRequest { projectDir: string; profileId?: string; cols?: number; rows?: number }
export interface WorkspaceTerminalEvent { sessionId: string; seq: number; type: 'data' | 'exit'; data?: string; exitCode?: number; closeError?: string }
export interface WorkspaceTerminalSessionInfo { sessionId: string; profileId: string; cwd: string; pid: number; shellPid?: number; output: string; seq: number; exited?: boolean; exitCode?: number; closeError?: string }
export interface WorkspaceTerminalResult { success: boolean; error?: string; session?: WorkspaceTerminalSessionInfo; sessions?: WorkspaceTerminalSessionInfo[]; profiles?: WorkspaceTerminalProfile[] }
