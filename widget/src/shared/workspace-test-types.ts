export interface WorkspaceDiscoveredTest { path: string; name: string; line: number; runner: 'node' | 'jest' | 'vitest'; skipped?: boolean }
export interface WorkspaceTestRequest { root: string; action: 'list' | 'run' | 'state' | 'stop'; file?: string; testName?: string; coverage?: boolean }
export interface WorkspaceTestResult {
  success: boolean; error?: string; tests?: WorkspaceDiscoveredTest[]; running?: boolean; output?: string; exitCode?: number | null;
  coveragePath?: string; summary?: { passed: number; failed: number; skipped: number }; note?: string;
}
