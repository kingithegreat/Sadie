export type WorkspaceGitAction = 'diff' | 'stage-hunk' | 'init' | 'clone' | 'fetch' | 'pull' | 'push' | 'create-branch' | 'history' | 'blame' | 'stash' | 'stash-pop' | 'conflict' | 'resolve-conflict';
export interface WorkspaceGitActionRequest {
  folder: string; action: WorkspaceGitAction; file?: string; staged?: boolean; hunk?: number; expectedDiff?: string;
  branch?: string; url?: string; target?: string; resolution?: 'ours' | 'theirs' | 'manual'; expectedContent?: string; expectedExists?: boolean; content?: string;
}
export interface WorkspaceGitActionResult {
  success: boolean; error?: string; text?: string; diff?: string; hunks?: Array<{ index: number; header: string; patch: string }>;
  history?: Array<{ hash: string; subject: string; author: string; date: string }>;
  conflict?: { path: string; base: string; ours: string; theirs: string; current: string; currentExists: boolean; missingSides: Array<'base' | 'ours' | 'theirs'> };
}
