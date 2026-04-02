/**
 * SADIE Process Manager Tool
 *
 * Lists running processes, gets info on a specific process,
 * and (with confirmation) kills a process by name or PID.
 * All data is read via Node's os / PowerShell — no native addons needed.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);

// ---- Protected processes that must never be killed ----
const PROTECTED_PROCESSES = new Set([
  'system', 'smss', 'csrss', 'wininit', 'winlogon', 'lsass',
  'services', 'svchost', 'electron', 'node', 'sadie'
]);

// ============= TOOL DEFINITIONS =============

export const listProcessesDef: ToolDefinition = {
  name: 'list_processes',
  description:
    'List currently running processes. Can filter by name and sort by CPU or memory usage. ' +
    'Returns process name, PID, CPU%, memory (MB), and status.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description: 'Optional partial name filter (case-insensitive). E.g., "chrome" lists all chrome processes.'
      },
      sort_by: {
        type: 'string',
        description: 'Sort field: "cpu" (default), "memory", or "name"',
        enum: ['cpu', 'memory', 'name'],
        default: 'cpu'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of processes to return (default: 20, max: 100)',
        default: 20
      }
    },
    required: []
  }
};

export const getProcessInfoDef: ToolDefinition = {
  name: 'get_process_info',
  description:
    'Get detailed information about a specific process by name or PID, ' +
    'including memory usage, CPU, start time, and executable path.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Process name to look up (e.g., "notepad")'
      },
      pid: {
        type: 'number',
        description: 'Process ID (use this OR name)'
      }
    },
    required: []
  }
};

export const killProcessDef: ToolDefinition = {
  name: 'kill_process',
  description:
    'Terminate a process by name or PID. ' +
    'System, SADIE, and Node processes are protected and cannot be killed. ' +
    'Requires user confirmation.',
  category: 'system',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Process name to terminate (e.g., "notepad")'
      },
      pid: {
        type: 'number',
        description: 'Exact PID to terminate (safer than name)'
      },
      force: {
        type: 'boolean',
        description: 'Force-kill (/F) — use for unresponsive processes (default: false)',
        default: false
      }
    },
    required: []
  }
};

// ============= TOOL HANDLERS =============

export const listProcessesHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const filter = String(args.filter || '').toLowerCase();
    const sortBy = String(args.sort_by || 'cpu').toLowerCase();
    const limit = Math.min(Math.max(1, Number(args.limit) || 20), 100);

    const cmd =
      `powershell -NoProfile -NonInteractive -Command "` +
      `Get-Process | Select-Object Name,Id,CPU,WorkingSet,Responding | ` +
      `ConvertTo-Json -Depth 3 -Compress"`;

    const { stdout } = await execAsync(cmd, { timeout: 8000, windowsHide: true });
    let procs: any[] = JSON.parse(stdout);
    if (!Array.isArray(procs)) procs = [procs];

    let results = procs.map((p) => ({
      name: p.Name || '',
      pid: p.Id ?? 0,
      cpu_percent: parseFloat((p.CPU || 0).toFixed(2)),
      memory_mb: parseFloat(((p.WorkingSet || 0) / 1048576).toFixed(1)),
      responding: p.Responding !== false
    }));

    if (filter) {
      results = results.filter((p) => p.name.toLowerCase().includes(filter));
    }

    if (sortBy === 'memory') {
      results.sort((a, b) => b.memory_mb - a.memory_mb);
    } else if (sortBy === 'name') {
      results.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      results.sort((a, b) => b.cpu_percent - a.cpu_percent);
    }

    results = results.slice(0, limit);

    return {
      success: true,
      result: { count: results.length, processes: results }
    };
  } catch (err: any) {
    return { success: false, error: `list_processes failed: ${err.message}` };
  }
};

export const getProcessInfoHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const name = String(args.name || '').trim();
    const pid = args.pid !== undefined ? Number(args.pid) : undefined;

    if (!name && pid === undefined) {
      return { success: false, error: 'Either name or pid is required' };
    }

    let filter: string;
    if (pid !== undefined) {
      filter = `Get-Process -Id ${pid} -ErrorAction Stop`;
    } else {
      const safeName = name.replace(/[^a-zA-Z0-9_\-. ]/g, '');
      filter = `Get-Process -Name '${safeName}' -ErrorAction Stop | Select-Object -First 1`;
    }

    const cmd =
      `powershell -NoProfile -NonInteractive -Command "` +
      `(${filter}) | Select-Object Name,Id,CPU,WorkingSet,PriorityClass,StartTime,Path,Responding | ` +
      `ConvertTo-Json -Depth 3 -Compress"`;

    const { stdout } = await execAsync(cmd, { timeout: 8000, windowsHide: true });
    let proc: any = JSON.parse(stdout);
    if (Array.isArray(proc)) proc = proc[0];

    return {
      success: true,
      result: {
        name: proc.Name,
        pid: proc.Id,
        cpu_percent: parseFloat((proc.CPU || 0).toFixed(2)),
        memory_mb: parseFloat(((proc.WorkingSet || 0) / 1048576).toFixed(1)),
        priority: proc.PriorityClass,
        start_time: proc.StartTime,
        path: proc.Path,
        responding: proc.Responding !== false
      }
    };
  } catch (err: any) {
    return { success: false, error: `get_process_info failed: ${err.message}` };
  }
};

export const killProcessHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const name = String(args.name || '').trim().toLowerCase();
    const pid = args.pid !== undefined ? Number(args.pid) : undefined;
    const force = args.force === true;

    if (!name && pid === undefined) {
      return { success: false, error: 'Either name or pid is required' };
    }

    // Protection check
    if (name && PROTECTED_PROCESSES.has(name.replace(/\.exe$/i, ''))) {
      return { success: false, error: `Process "${name}" is protected and cannot be terminated` };
    }

    let cmd: string;
    const forceFlag = force ? ' -Force' : '';
    if (pid !== undefined) {
      // Validate PID is a positive integer to prevent command injection
      const safePid = parseInt(String(pid), 10);
      if (!Number.isFinite(safePid) || safePid < 0) {
        return { success: false, error: 'Invalid PID: must be a positive integer' };
      }
      cmd = `powershell -NoProfile -NonInteractive -Command "Stop-Process -Id ${safePid}${forceFlag} -ErrorAction Stop"`;
    } else {
      const safeName = name.replace(/[^a-zA-Z0-9_\-. ]/g, '');
      cmd = `powershell -NoProfile -NonInteractive -Command "Stop-Process -Name '${safeName}'${forceFlag} -ErrorAction Stop"`;
    }

    await execAsync(cmd, { timeout: 8000, windowsHide: true });
    return {
      success: true,
      result: {
        terminated: { name: name || undefined, pid },
        force
      }
    };
  } catch (err: any) {
    return { success: false, error: `kill_process failed: ${err.message}` };
  }
};

// ============= EXPORTS =============

export const processManagerToolDefs: ToolDefinition[] = [
  listProcessesDef,
  getProcessInfoDef,
  killProcessDef
];

export const processManagerToolHandlers: Record<string, ToolHandler> = {
  list_processes: listProcessesHandler,
  get_process_info: getProcessInfoHandler,
  kill_process: killProcessHandler
};
