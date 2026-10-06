export interface WorkspaceAiRequestScope { root: string; planId?: string }
export interface WorkspaceAiTurn { id: string; role: 'user' | 'assistant'; text: string; context?: string[]; error?: boolean }
export interface WorkspaceAiSelection { path: string; text: string; from?: number; to?: number }
export interface WorkspaceAiPlan { success: boolean; id?: string; root?: string; text?: string; expires?: number; error?: string }
export interface WorkspaceAiSessionResult { success: boolean; turns?: WorkspaceAiTurn[]; error?: string }
export interface WorkspaceCodeMatch { path: string; line: number; text: string; score: number }
export interface WorkspaceCodeSearchResult { success: boolean; matches?: WorkspaceCodeMatch[]; mode?: string; note?: string; capped?: boolean; files?: number; bytes?: number; error?: string }
export interface WorkspaceCheckpointRow { id: string; root: string; path: string; at: number; tool: string; afterHash: string; created: boolean }
export interface WorkspaceCheckpointRestoreOptions { overwrite?: boolean; expectedCurrentHash?: string }
export interface WorkspaceCheckpointRestoreResult { success: boolean; path?: string; removed?: boolean; conflict?: boolean; currentHash?: string; error?: string }
export interface WorkspaceCheckpointCompareResult { success: boolean; path?: string; before?: string | null; current?: string | null; currentHash?: string; error?: string }
export interface WorkspaceAiRulesResult { success: boolean; rules?: Array<{ path: string; text: string }>; error?: string }
export interface WorkspaceAiMcpStatusResult { success: boolean; servers?: Array<{ name: string; type: string; connected: boolean; toolCount: number }>; error?: string }
export interface WorkspaceCodeCompletionResult { success: boolean; text?: string; model?: string; latencyMs?: number; reason?: string; error?: string }
