import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { SubscriptionCliStatus } from '../shared/types';

type SubscriptionProvider = 'codex' | 'claude-code';

function findOnPath(provider: SubscriptionProvider): string | null {
  const names = provider === 'codex'
    ? (process.platform === 'win32' ? ['codex.cmd', 'codex.exe'] : ['codex'])
    : (process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']);
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next candidate */ }
    }
  }
  return null;
}

function runStatus(bin: string, args: string[]): Promise<{ code: number | null; output: string } | null> {
  return new Promise(resolve => {
    const child = spawn(bin, args, {
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin),
    });
    let output = '';
    let settled = false;
    const finish = (result: { code: number | null; output: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // No prompt, key or status output reaches the renderer. The command is read-only.
    const collect = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(0, 4096); };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', () => finish(null));
    child.on('close', code => finish({ code, output }));
    const timer = setTimeout(() => { child.kill(); finish(null); }, 8000);
    timer.unref?.();
  });
}

export function classifySubscriptionStatus(
  provider: SubscriptionProvider,
  result: { code: number | null; output: string } | null,
): SubscriptionCliStatus {
  if (!result) return { status: 'unknown' };
  if (result.code !== 0) return { status: 'signed-out' };

  if (provider === 'codex') {
    if (/logged in using chatgpt/i.test(result.output)) return { status: 'ready' };
    if (/logged in using (an? )?api key/i.test(result.output)) return { status: 'api-key' };
    return { status: 'unknown' };
  }

  try {
    const info = JSON.parse(result.output);
    if (info.loggedIn !== true) return { status: 'signed-out' };
    const method = String(info.authMethod || '').toLowerCase();
    if (/api.?key|console/.test(method)) return { status: 'api-key' };
    if (/oauth|claude\.ai|subscription/.test(method)) return { status: 'ready' };
  } catch { /* Older CLI may not provide parseable status. */ }
  return { status: 'unknown' };
}

/** A local status check only. A first chat remains the proof that the plan can answer. */
export async function checkSubscriptionCliStatus(provider: SubscriptionProvider): Promise<SubscriptionCliStatus> {
  const bin = findOnPath(provider);
  if (!bin) return { status: 'missing' };
  return classifySubscriptionStatus(provider, await runStatus(bin, provider === 'codex' ? ['login', 'status'] : ['auth', 'status']));
}
