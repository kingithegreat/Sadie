/**
 * HomeBot Search Tool
 *
 * Local file search using Everything Search (es.exe) when available,
 * falling back to PowerShell Get-ChildItem.  Only paths inside the
 * user's home directory tree are searched unless explicitly overridden,
 * preventing path-traversal abuse.
 *
 * Tools:
 *   find_files — find files/folders by name pattern on the local system
 */

import { exec } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);

// ----- Security helpers -----

const HOME = os.homedir();

/**
 * Ensure the search root is within the user home directory.
 * Returns sanitized absolute path or the HOME directory on error/escape attempt.
 */
function sanitizeSearchRoot(rawPath: string | undefined): string {
  if (!rawPath) return HOME;
  let resolved: string;
  try {
    resolved = path.resolve(rawPath);
  } catch {
    return HOME;
  }
  // Must be under HOME
  const rel = path.relative(HOME, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return HOME;
  }
  return resolved;
}

/**
 * Sanitize a search pattern for PowerShell — strip chars that break single-quoted strings.
 */
function sanitizePattern(raw: string): string {
  return String(raw)
    .replace(/'/g, '\u2019')
    .replace(/`/g, '')
    .replace(/\$/g, '')
    .replace(/[\x00-\x1F]/g, '')
    .slice(0, 200);
}

// ----- Tool definition -----

export const searchFilesDef: ToolDefinition = {
  name: 'find_files',
  description:
    'Find files and folders on the local filesystem by name pattern. ' +
    'Searches within the user home directory by default. ' +
    'Supports wildcard patterns like *.pdf or report*.docx. ' +
    'Uses Everything Search (es.exe) when available for fast results, ' +
    'otherwise falls back to PowerShell recursive search. ' +
    'Use this for locating files by name; use search_files to search inside file contents.',
  category: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'File or folder name to search for. Supports wildcards (* and ?). ' +
          'Example: "*.pdf", "budget*", "report 2025.docx"',
      },
      path: {
        type: 'string',
        description:
          'Directory to search within (default: user home directory). ' +
          'Must be inside the home directory.',
      },
      type: {
        type: 'string',
        description: 'Filter results by type: "file", "folder", or "any" (default: "any")',
        enum: ['file', 'folder', 'any'],
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 30, max: 100)',
        default: 30,
      },
    },
    required: ['query'],
  },
};

// ----- Handler -----

export const searchFilesHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const query = sanitizePattern(String(args.query ?? ''));
  if (!query) {
    return { success: false, error: 'find_files: query is required' };
  }

  const searchRoot = sanitizeSearchRoot(args.path as string | undefined);
  const typeFilter = (args.type as string) || 'any';
  const limit = Math.min(Math.max(1, Number(args.limit) || 30), 100);

  // Build wildcard pattern (add * wrappers if no wildcards provided)
  const pattern = /[*?]/.test(query) ? query : `*${query}*`;

  // —— Try Everything Search (es.exe) ——
  try {
    const esPath = 'es.exe'; // on PATH if Everything is installed
    const typeFlag = typeFilter === 'file' ? '-file ' : typeFilter === 'folder' ? '-folder ' : '';
    const psCmd = [
      `$es = (Get-Command '${esPath}' -ErrorAction SilentlyContinue)`,
      `if ($es) {`,
      `  & '${esPath}' ${typeFlag}-n ${limit} -r '${pattern.replace(`'`, '\u2019')}' '${sanitizePattern(searchRoot)}'`,
      `} else { exit 1 }`,
    ].join('; ');

    const { stdout: esOut, stderr: esErr } = await execAsync(
      `powershell -NoProfile -NonInteractive -Command "${psCmd.replace(/"/g, '\\"')}"`,
      { timeout: 8000 }
    );

    if (esOut && esOut.trim() && !esErr?.includes('exit 1')) {
      const lines = esOut.trim().split(/\r?\n/).slice(0, limit);
      const results = lines
        .filter(l => l.trim())
        .map(l => {
          const name = path.basename(l.trim());
          return { name, path: l.trim(), type: 'unknown' as const };
        });

      return {
        success: true,
        result: {
          query,
          root: searchRoot,
          count: results.length,
          results,
          engine: 'everything',
        },
      };
    }
  } catch {
    // Everything not available, fall through to PowerShell
  }

  // —— PowerShell Get-ChildItem fallback ——
  try {
    const psType = typeFilter === 'file' ? '-File' : typeFilter === 'folder' ? '-Directory' : '';
    const psScript = [
      `Get-ChildItem -Path '${sanitizePattern(searchRoot)}' -Recurse ${psType} -Filter '${pattern}' -ErrorAction SilentlyContinue`,
      `| Select-Object -First ${limit}`,
      `| Select-Object Name, FullName, PSIsContainer, Length, LastWriteTime`,
      `| ConvertTo-Json -Compress -Depth 2`,
    ].join(' ');

    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`,
      { timeout: 20000 }
    );

    if (!stdout.trim()) {
      return {
        success: true,
        result: { query, root: searchRoot, count: 0, results: [], engine: 'powershell' },
      };
    }

    let raw: any[];
    try {
      const parsed = JSON.parse(stdout.trim());
      raw = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return { success: false, error: 'find_files: failed to parse PowerShell output' };
    }

    const results = raw.slice(0, limit).map((item: any) => ({
      name: item.Name || '',
      path: item.FullName || '',
      type: item.PSIsContainer ? 'folder' : 'file',
      size: item.PSIsContainer ? undefined : (item.Length ?? undefined),
      modified: item.LastWriteTime ?? undefined,
    }));

    return {
      success: true,
      result: {
        query,
        root: searchRoot,
        count: results.length,
        results,
        engine: 'powershell',
      },
    };
  } catch (err) {
    return { success: false, error: `find_files failed: ${(err as any)?.message}` };
  }
};

// ----- Exports -----

export const searchToolDefs: ToolDefinition[] = [searchFilesDef];

export const searchToolHandlers: Record<string, ToolHandler> = {
  find_files: searchFilesHandler,
};
