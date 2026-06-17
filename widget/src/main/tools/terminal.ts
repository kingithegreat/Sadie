/**
 * HomeBot Terminal Tool
 *
 * Executes shell commands in a specified working directory.
 * Designed for developer workflows: build tools, package managers,
 * test runners, docker, etc.
 *
 * Safety:
 *  - Requires user confirmation for every command
 *  - Working directory must be inside user home
 *  - Blocks a small set of catastrophic patterns (rm -rf /, format, etc.)
 *  - 60-second timeout (configurable up to 120s)
 *  - Output truncated to 16 KB
 */

import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);
const HOME_DIR = os.homedir();
const MAX_OUTPUT = 16_384;      // 16 KB per stream in the result
const MAX_BUFFER = 1_048_576;   // 1 MB exec buffer (prevents maxBuffer errors on large builds)
const MAX_HISTORY = 200;        // cap session history entries

// ---- Catastrophic command blocklist ----
// These are only the truly destructive patterns that no reasonable dev workflow needs.
// Everything else is allowed but gated behind user confirmation.
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+(-\w*r\w*f|--no-preserve-root)\s+[/\\]/i,       // rm -rf / or rm -rf C:\
  /format\s+[a-z]:\s*/i,                                   // format C:
  /del\s+\/[sfq]\s+[a-z]:\\/i,                             // del /s /f C:\
  /mkfs\b/i,                                                // mkfs (Linux format)
  /dd\s+.*of=\/dev\/sd/i,                                   // dd of=/dev/sda
  /:\(\)\{[^}]*:\|:&\s*\};:/,                                // fork bomb
  />\s*\/dev\/sda/,                                         // > /dev/sda
  /shutdown\s|reboot\s/i,                                   // shutdown / reboot
  /reg\s+delete\s+hk/i,                                    // registry delete
];

function isSafe(cmd: string): { safe: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return { safe: false, reason: `Blocked dangerous pattern: ${pattern.source}` };
    }
  }
  return { safe: true };
}

function validateCwd(rawPath: string): { valid: boolean; resolved: string; error?: string } {
  const resolved = path.resolve(rawPath || process.cwd());
  if (!resolved.toLowerCase().startsWith(HOME_DIR.toLowerCase())) {
    return { valid: false, resolved, error: `Working directory must be within home directory (${HOME_DIR})` };
  }
  // Check that the directory actually exists
  try {
    const stat = require('fs').statSync(resolved);
    if (!stat.isDirectory()) {
      return { valid: false, resolved, error: `Path is not a directory: ${resolved}` };
    }
  } catch {
    return { valid: false, resolved, error: `Directory does not exist: ${resolved}` };
  }
  return { valid: true, resolved };
}

// ============= TOOL DEFINITIONS =============

export const runTerminalCommandDef: ToolDefinition = {
  name: 'run_terminal_command',
  description:
    'Execute a shell command in a terminal and return stdout/stderr. ' +
    'Use for build tools (npm, cargo, pip), test runners, docker, git, and general CLI tasks. ' +
    'Requires user confirmation. Working directory must be inside user home. ' +
    'Timeout: 60 seconds (configurable up to 120s). Output capped at 16 KB.',
  category: 'utility',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute (e.g., "npm test", "docker compose up -d", "pip install requests")'
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (absolute path, must be inside home dir). Defaults to current directory.'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 60, max: 120)',
        default: 60
      }
    },
    required: ['command']
  }
};

export const getTerminalHistoryDef: ToolDefinition = {
  name: 'get_terminal_history',
  description: 'Get the last N commands that were executed via run_terminal_command this session.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of recent commands to return (default: 10)',
        default: 10
      }
    },
    required: []
  }
};

// ============= SESSION HISTORY =============

interface TerminalEntry {
  command: string;
  cwd: string;
  exitCode: number;
  stdoutPreview: string;
  timestamp: string;
}

const sessionHistory: TerminalEntry[] = [];

// ============= TOOL HANDLERS =============

export const runTerminalCommandHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const command = String(args.command || '').trim();
    if (!command) {
      return { success: false, error: 'command is required' };
    }
    if (command.length > 2048) {
      return { success: false, error: 'command too long (max 2048 chars)' };
    }

    // Safety check
    const safety = isSafe(command);
    if (!safety.safe) {
      return { success: false, error: `Command rejected by safety filter. ${safety.reason}` };
    }

    // Validate working directory
    const cwdRaw = String(args.cwd || process.cwd());
    const v = validateCwd(cwdRaw);
    if (!v.valid) return { success: false, error: v.error };

    const timeoutSec = Math.min(Math.max(5, Number(args.timeout) || 60), 120);
    const timeoutMs = timeoutSec * 1000;

    const isWindows = os.platform() === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/bash';

    const { stdout, stderr } = await execAsync(command, {
      cwd: v.resolved,
      timeout: timeoutMs,
      windowsHide: true,
      shell,
      maxBuffer: MAX_BUFFER,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }  // suppress ANSI codes
    });

    const stdoutTrimmed = stdout.length > MAX_OUTPUT
      ? stdout.slice(0, MAX_OUTPUT) + `\n... (truncated, ${stdout.length} total chars)`
      : stdout;
    const stderrTrimmed = stderr.length > MAX_OUTPUT
      ? stderr.slice(0, MAX_OUTPUT) + `\n... (truncated, ${stderr.length} total chars)`
      : stderr;

    // Record in session history (capped)
    sessionHistory.push({
      command,
      cwd: v.resolved,
      exitCode: 0,
      stdoutPreview: stdout.slice(0, 200),
      timestamp: new Date().toISOString()
    });
    if (sessionHistory.length > MAX_HISTORY) sessionHistory.splice(0, sessionHistory.length - MAX_HISTORY);

    return {
      success: true,
      result: {
        command,
        cwd: v.resolved,
        exit_code: 0,
        stdout: stdoutTrimmed,
        stderr: stderrTrimmed
      }
    };
  } catch (err: any) {
    const timedOut = err.killed === true;
    const exitCode = err.code ?? 1;

    // Still record failures (capped)
    sessionHistory.push({
      command: String(args.command || ''),
      cwd: String(args.cwd || process.cwd()),
      exitCode: timedOut ? -1 : exitCode,
      stdoutPreview: (err.stdout || '').slice(0, 200),
      timestamp: new Date().toISOString()
    });
    if (sessionHistory.length > MAX_HISTORY) sessionHistory.splice(0, sessionHistory.length - MAX_HISTORY);

    if (timedOut) {
      return {
        success: false,
        error: `Command timed out after ${args.timeout || 60} seconds`,
        result: {
          command: args.command,
          stdout: (err.stdout || '').slice(0, MAX_OUTPUT),
          stderr: (err.stderr || '').slice(0, MAX_OUTPUT),
          exit_code: -1,
          timed_out: true
        }
      };
    }

    return {
      success: false,
      error: `Command exited with code ${exitCode}`,
      result: {
        command: args.command,
        stdout: (err.stdout || '').slice(0, MAX_OUTPUT),
        stderr: (err.stderr || '').slice(0, MAX_OUTPUT),
        exit_code: exitCode
      }
    };
  }
};

export const getTerminalHistoryHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const limit = Math.min(Math.max(1, Number(args.limit) || 10), 50);
  const recent = sessionHistory.slice(-limit);
  return {
    success: true,
    result: {
      count: recent.length,
      total_session_commands: sessionHistory.length,
      history: recent
    }
  };
};

// ============= EXPORTS =============

export const terminalToolDefs: ToolDefinition[] = [runTerminalCommandDef, getTerminalHistoryDef];

export const terminalToolHandlers: Record<string, ToolHandler> = {
  run_terminal_command: runTerminalCommandHandler,
  get_terminal_history: getTerminalHistoryHandler
};
