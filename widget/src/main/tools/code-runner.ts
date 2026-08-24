/**
 * HomeBot Code Runner Tool
 *
 * Executes sandboxed code snippets in Python or PowerShell.
 * Enforces a 10-second timeout and blocks dangerous commands.
 * Requires user confirmation before every run.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execFileAsync = promisify(execFile);

// ---- Safety blocklist (PowerShell + Python terms) ----
//
// This is a pattern FILTER, not a sandbox: the snippet runs with full user
// rights. It exists to catch the obvious network/exfil/destruction attempts,
// not to contain a determined one — requiresConfirmation is the real gate.
const BLOCKED_PATTERNS: RegExp[] = [
  // Network/download — .NET HTTP classes the Invoke-* patterns miss
  /Invoke-WebRequest|iwr\b|curl\b|wget\b|Invoke-RestMethod|irm\b/i,
  /System\.Net\.Http|WebClient|HttpWebRequest|FtpWebRequest|Start-BitsTransfer/i,
  /Sockets\.(Tcp|Udp)Client/i,
  /requests\.get|urllib|httpx|aiohttp|\bsocket\b|ftplib|smtplib|telnetlib|http\.client|xmlrpc/i,
  // File system destruction
  /Remove-Item.*-Recurse|-rf\s/i,
  /rmdir|rd\s.*\/s/i,
  /shutil\.rmtree/i,
  // Registry
  /HKLM:|HKCU:|Set-Item.*Registry/i,
  // Process spawning (nested)
  /Start-Process|Invoke-Expression|iex\b/i,
  /subprocess\.(?:call|run|Popen)|os\.system|os\.popen/i,
  // Environment / credential access (broad PowerShell env dumps + targeted reads)
  /\$env:.*PASSWORD|\$env:.*SECRET|\$env:.*TOKEN/i,
  /os\.environ.*(?:PASSWORD|SECRET|TOKEN|KEY)/i,
  /os\.getenv\s*\(\s*['"][^'"]*(?:PASSWORD|SECRET|TOKEN|API_?KEY)/i,
  /Get-Content\s+Env:|\[Environment\]::GetEnvironmentVariable/i,
  // Persistence
  /schtasks|Register-ScheduledTask/i,
];

function isSafe(code: string): { safe: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return { safe: false, reason: `Blocked pattern: ${pattern.toString()}` };
    }
  }
  return { safe: true };
}

// ============= TOOL DEFINITIONS =============

export const runCodeDef: ToolDefinition = {
  name: 'run_code',
  description:
    'Run a short code snippet in Python or PowerShell and return stdout/stderr. ' +
    'Useful for calculations, data transforms, file parsing, and quick scripts. ' +
    'Requires user confirmation. Common network, registry, and destructive ' +
    'patterns are rejected by a filter (this is not a security sandbox). ' +
    'Execution is limited to 10 seconds.',
  category: 'utility',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Programming language: "python" or "powershell"',
        enum: ['python', 'powershell']
      },
      code: {
        type: 'string',
        description: 'The code to execute (max 4096 chars)'
      }
    },
    required: ['language', 'code']
  }
};

// ============= TOOL HANDLERS =============

export const runCodeHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const language = String(args.language || '').toLowerCase();
    const code = String(args.code || '').slice(0, 4096);

    if (!['python', 'powershell'].includes(language)) {
      return { success: false, error: 'language must be "python" or "powershell"' };
    }
    if (!code.trim()) {
      return { success: false, error: 'code is required' };
    }

    // Safety check
    const safety = isSafe(code);
    if (!safety.safe) {
      return {
        success: false,
        error: `Code rejected by safety filter. ${safety.reason}`
      };
    }

    // Write code to a temp file
    const tmpDir = os.tmpdir();
    const ext = language === 'python' ? '.py' : '.ps1';
    const tmpFile = path.join(tmpDir, `homebot_run_${Date.now()}${ext}`);
    await fs.promises.writeFile(tmpFile, code, 'utf8');

    try {
      let cmd: string;
      let cmdArgs: string[];
      if (language === 'python') {
        cmd = 'python';
        cmdArgs = [tmpFile];
      } else {
        cmd = 'powershell';
        cmdArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpFile];
      }

      const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, { timeout: 10_000, windowsHide: true });

      return {
        success: true,
        result: {
          language,
          stdout: stdout.slice(0, 8192),
          stderr: stderr.slice(0, 2048),
          exit_code: 0
        }
      };
    } catch (execErr: any) {
      // Non-zero exit or timeout
      return {
        success: false,
        error: execErr.killed ? 'Execution timed out (10s limit)' : execErr.message,
        result: {
          language,
          stdout: (execErr.stdout || '').slice(0, 8192),
          stderr: (execErr.stderr || '').slice(0, 2048),
          exit_code: execErr.code ?? 1
        }
      };
    } finally {
      fs.promises.unlink(tmpFile).catch(() => {});
    }
  } catch (err: any) {
    return { success: false, error: `run_code failed: ${err.message}` };
  }
};

// ============= EXPORTS =============

export const codeRunnerToolDefs: ToolDefinition[] = [runCodeDef];

export const codeRunnerToolHandlers: Record<string, ToolHandler> = {
  run_code: runCodeHandler
};
