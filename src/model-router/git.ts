/** Minimal git runner for vibe-code (no shell, args passed as an array). */

import { spawn } from 'node:child_process';

export interface GitOptions {
  input?: string;
  env?: Record<string, string | undefined>;
}

export class GitError extends Error {
  constructor(readonly args: string[], readonly code: number | null, readonly stderr: string) {
    super(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`);
    this.name = 'GitError';
  }
}

export function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', d => { stdout += d.toString(); });
    child.stderr!.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new GitError(args, code, stderr));
    });
    if (child.stdin) {
      // git may exit before reading all of stdin (e.g. a failed --check); that is reported via the exit code.
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.input);
    }
  });
}
