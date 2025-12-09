/**
 * SADIE System Tools
 * 
 * Provides system information and utilities.
 */

import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);

// ============= TOOL DEFINITIONS =============

export const getSystemInfoDef: ToolDefinition = {
  name: 'get_system_info',
  description: 'Get information about the computer system including OS, CPU, memory, and disk space.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      detailed: {
        type: 'boolean',
        description: 'Whether to include detailed information (default: false)',
        default: false
      }
    },
    required: []
  }
};

export const getClipboardDef: ToolDefinition = {
  name: 'get_clipboard',
  description: 'Read the current contents of the system clipboard.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
};

export const setClipboardDef: ToolDefinition = {
  name: 'set_clipboard',
  description: 'Copy text to the system clipboard.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to copy to the clipboard'
      }
    },
    required: ['text']
  }
};

export const openUrlDef: ToolDefinition = {
  name: 'open_url',
  description: 'Open a URL in the default web browser.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to open (must start with http:// or https://)'
      }
    },
    required: ['url']
  }
};

export const launchAppDef: ToolDefinition = {
  name: 'launch_app',
  description: 'Launch an application by name. Common apps: notepad, calculator, explorer, cmd, powershell, code (VS Code), chrome, firefox, edge.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      appName: {
        type: 'string',
        description: 'The name of the application to launch'
      }
    },
    required: ['appName']
  }
};

export const calculateDef: ToolDefinition = {
  name: 'calculate',
  description: 'Evaluate a mathematical expression. Supports +, -, *, /, ^, sqrt(), sin(), cos(), tan(), log(), abs(), round(), floor(), ceil(), PI, E.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "sin(PI/2)")'
      }
    },
    required: ['expression']
  }
};

export const screenshotDef: ToolDefinition = {
  name: 'screenshot',
  description: 'Take a screenshot of the screen and save it to a file. Returns the path to the saved screenshot.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Optional filename for the screenshot (without extension). If not provided, uses timestamp.'
      },
      fullscreen: {
        type: 'boolean',
        description: 'Whether to capture the full screen (true) or just the active window (false). Default: true',
        default: true
      }
    },
    required: []
  }
};

export const getCurrentTimeDef: ToolDefinition = {
  name: 'get_current_time',
  description: 'Get the current date and time.',
  category: 'system',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: 'Format: "full" (default), "date", "time", "iso"',
        default: 'full'
      }
    },
    required: []
  }
};

// ============= TOOL HANDLERS =============

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.join(' ') || '< 1m';
}

export const getSystemInfoHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const detailed = args.detailed === true;
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);
    
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCores = cpus.length;
    
    // Calculate CPU usage (average across all cores)
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;
    
    const info: any = {
      os: {
        platform: os.platform(),
        type: os.type(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname()
      },
      cpu: {
        model: cpuModel,
        cores: cpuCores,
        usage: `${cpuUsage.toFixed(1)}%`
      },
      memory: {
        total: formatBytes(totalMem),
        used: formatBytes(usedMem),
        free: formatBytes(freeMem),
        usagePercent: `${memPercent}%`
      },
      uptime: formatUptime(os.uptime())
    };
    
    if (detailed) {
      info.user = {
        username: os.userInfo().username,
        homeDir: os.homedir()
      };
      info.network = {};
      const nets = os.networkInterfaces();
      for (const [name, addresses] of Object.entries(nets)) {
        if (addresses) {
          const ipv4 = addresses.find(a => a.family === 'IPv4' && !a.internal);
          if (ipv4) {
            info.network[name] = ipv4.address;
          }
        }
      }
    }
    
    // Try to get disk info on Windows
    if (os.platform() === 'win32') {
      try {
        const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption');
        const lines = stdout.trim().split('\n').slice(1);
        info.disks = [];
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3 && parts[0]) {
            const drive = parts[0];
            const free = parseInt(parts[1]) || 0;
            const size = parseInt(parts[2]) || 0;
            if (size > 0) {
              const used = size - free;
              info.disks.push({
                drive,
                total: formatBytes(size),
                used: formatBytes(used),
                free: formatBytes(free),
                usagePercent: `${((used / size) * 100).toFixed(1)}%`
              });
            }
          }
        }
      } catch {
        // Disk info not available
      }
    }
    
    return {
      success: true,
      result: info
    };
  } catch (err: any) {
    return { success: false, error: `Failed to get system info: ${err.message}` };
  }
};

export const getClipboardHandler: ToolHandler = async (): Promise<ToolResult> => {
  try {
    // Use PowerShell to read clipboard on Windows
    if (os.platform() === 'win32') {
      const { stdout } = await execAsync('powershell -command "Get-Clipboard"');
      return {
        success: true,
        result: { content: stdout.trim() || '(clipboard is empty)' }
      };
    } else {
      return { success: false, error: 'Clipboard reading not supported on this platform' };
    }
  } catch (err: any) {
    return { success: false, error: `Failed to read clipboard: ${err.message}` };
  }
};

export const setClipboardHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const text = args.text;
    if (!text || typeof text !== 'string') {
      return { success: false, error: 'Text is required' };
    }
    
    if (os.platform() === 'win32') {
      // Escape special characters for PowerShell
      const escaped = text.replace(/'/g, "''");
      await execAsync(`powershell -command "Set-Clipboard -Value '${escaped}'"`);
      return {
        success: true,
        result: { message: 'Text copied to clipboard', length: text.length }
      };
    } else {
      return { success: false, error: 'Clipboard writing not supported on this platform' };
    }
  } catch (err: any) {
    return { success: false, error: `Failed to set clipboard: ${err.message}` };
  }
};

export const openUrlHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const url = args.url;
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'URL is required' };
    }
    
    // Validate URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { success: false, error: 'URL must start with http:// or https://' };
    }
    
    // Open URL based on platform
    let command: string;
    if (os.platform() === 'win32') {
      command = `start "" "${url}"`;
    } else if (os.platform() === 'darwin') {
      command = `open "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }
    
    await execAsync(command);
    return {
      success: true,
      result: { message: `Opened ${url} in default browser` }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to open URL: ${err.message}` };
  }
};

// Map of common app names to executables
const APP_MAP: Record<string, string> = {
  'notepad': 'notepad',
  'calculator': 'calc',
  'calc': 'calc',
  'explorer': 'explorer',
  'file explorer': 'explorer',
  'cmd': 'cmd',
  'command prompt': 'cmd',
  'powershell': 'powershell',
  'code': 'code',
  'vscode': 'code',
  'vs code': 'code',
  'visual studio code': 'code',
  'chrome': 'chrome',
  'google chrome': 'chrome',
  'firefox': 'firefox',
  'edge': 'msedge',
  'microsoft edge': 'msedge',
  'paint': 'mspaint',
  'word': 'winword',
  'excel': 'excel',
  'powerpoint': 'powerpnt',
  'outlook': 'outlook',
  'teams': 'teams',
  'spotify': 'spotify',
  'discord': 'discord',
  'slack': 'slack',
  'terminal': 'wt',
  'windows terminal': 'wt',
  'settings': 'ms-settings:',
  'control panel': 'control',
  'task manager': 'taskmgr',
  'snipping tool': 'snippingtool',
  'snip': 'snippingtool'
};

export const launchAppHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const appName = (args.appName || '').toString().toLowerCase().trim();
    if (!appName) {
      return { success: false, error: 'App name is required' };
    }
    
    // Look up in app map or use as-is
    const executable = APP_MAP[appName] || appName;
    
    if (os.platform() === 'win32') {
      // Use start command to launch without blocking
      await execAsync(`start "" "${executable}"`);
      return {
        success: true,
        result: { message: `Launched ${appName}`, executable }
      };
    } else {
      return { success: false, error: 'App launching only supported on Windows currently' };
    }
  } catch (err: any) {
    return { success: false, error: `Failed to launch app: ${err.message}. Try the exact executable name.` };
  }
};

// Safe math evaluation
function safeEval(expression: string): number {
  // Replace common math functions and constants
  let expr = expression
    .replace(/\^/g, '**')
    .replace(/sqrt\(/gi, 'Math.sqrt(')
    .replace(/sin\(/gi, 'Math.sin(')
    .replace(/cos\(/gi, 'Math.cos(')
    .replace(/tan\(/gi, 'Math.tan(')
    .replace(/log\(/gi, 'Math.log10(')
    .replace(/ln\(/gi, 'Math.log(')
    .replace(/abs\(/gi, 'Math.abs(')
    .replace(/round\(/gi, 'Math.round(')
    .replace(/floor\(/gi, 'Math.floor(')
    .replace(/ceil\(/gi, 'Math.ceil(')
    .replace(/PI/gi, 'Math.PI')
    .replace(/\bE\b/gi, 'Math.E');
  
  // Only allow safe characters
  if (!/^[0-9+\-*/().\s,Math.sqrtsincoantlogbsrundflceiPI E]+$/.test(expr)) {
    throw new Error('Invalid characters in expression');
  }
  
  // Evaluate
  const result = Function(`"use strict"; return (${expr})`)();
  
  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Result is not a valid number');
  }
  
  return result;
}

export const calculateHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const expression = args.expression;
    if (!expression || typeof expression !== 'string') {
      return { success: false, error: 'Expression is required' };
    }
    
    const result = safeEval(expression);
    
    return {
      success: true,
      result: {
        expression,
        result,
        formatted: Number.isInteger(result) ? result.toString() : result.toFixed(10).replace(/\.?0+$/, '')
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to calculate: ${err.message}` };
  }
};

export const screenshotHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const { screen, desktopCapturer } = require('electron');
    const fs = require('fs');
    const path = require('path');
    
    // Get the primary display
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    
    // Get desktop sources
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    });
    
    if (!sources || sources.length === 0) {
      return { success: false, error: 'No screen sources available' };
    }
    
    const source = sources[0];
    const thumbnail = source.thumbnail;
    
    if (!thumbnail || thumbnail.isEmpty()) {
      return { success: false, error: 'Failed to capture screen' };
    }
    
    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = args.filename || `screenshot-${timestamp}`;
    
    // Save to Pictures folder
    const picturesDir = path.join(require('os').homedir(), 'Pictures', 'SADIE Screenshots');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(picturesDir)) {
      fs.mkdirSync(picturesDir, { recursive: true });
    }
    
    const filepath = path.join(picturesDir, `${filename}.png`);
    
    // Save the image
    const pngBuffer = thumbnail.toPNG();
    fs.writeFileSync(filepath, pngBuffer);
    
    return {
      success: true,
      result: {
        message: `Screenshot saved successfully`,
        path: filepath,
        size: `${width}x${height}`,
        bytes: pngBuffer.length
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to take screenshot: ${err.message}` };
  }
};

export const getCurrentTimeHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const format = args.format || 'full';
    const now = new Date();
    
    let result: any = { timestamp: now.getTime() };
    
    switch (format) {
      case 'date':
        result.date = now.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
        break;
      case 'time':
        result.time = now.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit' 
        });
        break;
      case 'iso':
        result.iso = now.toISOString();
        break;
      case 'full':
      default:
        result.date = now.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
        result.time = now.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit' 
        });
        result.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        break;
    }
    
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: `Failed to get time: ${err.message}` };
  }
};

// Export all definitions and handlers
export const systemToolDefs = [
  getSystemInfoDef,
  getClipboardDef,
  setClipboardDef,
  openUrlDef,
  launchAppDef,
  calculateDef,
  getCurrentTimeDef,
  screenshotDef
];

export const systemToolHandlers: Record<string, ToolHandler> = {
  'get_system_info': getSystemInfoHandler,
  'get_clipboard': getClipboardHandler,
  'set_clipboard': setClipboardHandler,
  'open_url': openUrlHandler,
  'launch_app': launchAppHandler,
  'calculate': calculateHandler,
  'get_current_time': getCurrentTimeHandler,
  'screenshot': screenshotHandler
};
