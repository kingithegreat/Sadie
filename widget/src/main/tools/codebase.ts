/**
 * HomeBot Codebase Tools
 *
 * Developer-focused tools for exploring and understanding codebases:
 *  - grep_code:      Search file contents by regex pattern across a directory tree
 *  - project_tree:   Get a directory tree structure for a project
 *  - analyze_file:   Quick overview of a source file (language, lines, functions, imports)
 *
 * All paths are restricted to the user's home directory.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { isWithinHomeDir } from '../utils/home-boundary';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execFileAsync = promisify(execFile);
const HOME_DIR = os.homedir();

// ---- Security ----

function validatePath(rawPath: string): { valid: boolean; resolved: string; error?: string } {
  const resolved = path.resolve(rawPath || process.cwd());
  if (!isWithinHomeDir(resolved, HOME_DIR)) {
    return { valid: false, resolved, error: `Path must be within home directory (${HOME_DIR})` };
  }
  return { valid: true, resolved };
}

// Directories to always skip when traversing
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.cache', 'coverage', '.tox', '.mypy_cache',
  '.pytest_cache', 'target', 'bin', 'obj', '.gradle', '.idea',
  '.vs', '.vscode', 'vendor', 'packages',
]);

// Binary extensions to skip in grep
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.avi', '.mov', '.mkv',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.pptx',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pyc', '.pyo', '.class', '.o', '.obj',
  '.lock', '.map',
]);

// ============= TOOL DEFINITIONS =============

export const grepCodeDef: ToolDefinition = {
  name: 'grep_code',
  description:
    'Search file contents by regex pattern across a project directory. ' +
    'Returns matching lines with file paths and line numbers. ' +
    'Skips node_modules, .git, dist, build, and binary files automatically. ' +
    'Use to find function definitions, imports, usages, TODO comments, config values, etc.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for (e.g., "function handleSubmit", "TODO:", "import.*React")'
      },
      directory: {
        type: 'string',
        description: 'Root directory to search in (absolute path). Defaults to current directory.'
      },
      file_pattern: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g., "*.ts", "*.py", "*.{js,jsx,ts,tsx}"). Default: all text files.'
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Case-sensitive search (default: false)',
        default: false
      },
      max_results: {
        type: 'number',
        description: 'Maximum matches to return (default: 50, max: 200)',
        default: 50
      },
      context_lines: {
        type: 'number',
        description: 'Number of context lines before/after each match (default: 0, max: 5)',
        default: 0
      }
    },
    required: ['pattern']
  }
};

export const projectTreeDef: ToolDefinition = {
  name: 'project_tree',
  description:
    'Get a directory tree structure for a project. Shows files and folders in a visual tree format. ' +
    'Automatically skips node_modules, .git, dist, build, etc. ' +
    'Use to understand project layout before reading or modifying files.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Root directory to show tree for (absolute path). Defaults to current directory.'
      },
      max_depth: {
        type: 'number',
        description: 'Maximum depth to traverse (default: 4, max: 8)',
        default: 4
      },
      show_files: {
        type: 'boolean',
        description: 'Show files (true) or only directories (false). Default: true.',
        default: true
      },
      file_pattern: {
        type: 'string',
        description: 'Only show files matching this pattern (e.g., "*.ts", "*.py"). Default: all files.'
      },
      max_items: {
        type: 'number',
        description: 'Maximum total items to include (default: 200, max: 500)',
        default: 200
      }
    },
    required: []
  }
};

export const analyzeFileDef: ToolDefinition = {
  name: 'analyze_file',
  description:
    'Get a quick overview of a source file: language, line count, imports/requires, ' +
    'exported symbols, function/class names, and a brief structure summary. ' +
    'Useful for understanding a file before reading it in full.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the source file to analyze'
      }
    },
    required: ['file_path']
  }
};

// ============= HELPERS =============

function matchesGlob(filename: string, pattern: string): boolean {
  // Simple glob matching: *.ts, *.{js,ts}, etc.
  if (!pattern) return true;

  // Handle {a,b,c} alternation
  const braceMatch = pattern.match(/\*\.?\{([^}]+)\}/);
  if (braceMatch) {
    const exts = braceMatch[1].split(',').map(e => e.trim());
    const ext = path.extname(filename).slice(1).toLowerCase();
    return exts.some(e => e.toLowerCase() === ext);
  }

  // Handle *.ext
  const extMatch = pattern.match(/\*\.(\w+)/);
  if (extMatch) {
    return filename.toLowerCase().endsWith('.' + extMatch[1].toLowerCase());
  }

  // Handle plain * (match all)
  if (pattern === '*') return true;

  return filename.includes(pattern);
}

// ============= GREP HANDLER =============

export const grepCodeHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const pattern = String(args.pattern || '').trim();
    if (!pattern) return { success: false, error: 'pattern is required' };
    if (pattern.length > 500) return { success: false, error: 'pattern too long (max 500 chars)' };

    const dirRaw = String(args.directory || process.cwd());
    const v = validatePath(dirRaw);
    if (!v.valid) return { success: false, error: v.error };

    const caseSensitive = args.case_sensitive === true;
    const maxResults = Math.min(Math.max(1, Number(args.max_results) || 50), 200);
    const contextLines = Math.min(Math.max(0, Number(args.context_lines) || 0), 5);
    const filePattern = String(args.file_pattern || '');

    // Try using ripgrep (rg) first, then fall back to a Node.js recursive search
    let matches: Array<{ file: string; line: number; text: string; context?: string[] }> = [];

    try {
      // ripgrep, invoked with an ARGV array — never a shell string. The pattern,
      // glob and directory arrive verbatim as arguments, so cmd.exe
      // metacharacters (& | ^ %VAR%) in an LLM-supplied file_pattern cannot
      // break out the way they could when this was one interpolated string.
      const rgArgs = [
        '--no-heading',
        '--line-number',
        '--max-count', String(maxResults),
        '--max-filesize', '1M',
      ];
      if (!caseSensitive) rgArgs.push('-i');
      if (contextLines > 0) rgArgs.push('-C', String(contextLines));
      if (filePattern) rgArgs.push('--glob', filePattern);
      rgArgs.push('--', pattern, v.resolved);

      try {
        const { stdout } = await execFileAsync('rg', rgArgs, {
          timeout: 30000,
          windowsHide: true,
          maxBuffer: MAX_OUTPUT_GREP,
          env: { ...process.env, RIPGREP_CONFIG_PATH: '' },
        });
        matches = parseRgOutput(stdout, v.resolved, maxResults);
      } catch (err: any) {
        // exit 1 means rg RAN and found nothing — an empty result, not a
        // failure. Anything else (spawn failure, rg error) falls back to
        // nodeGrep so a missing binary never turns into "no matches".
        if (err?.code === 1) {
          matches = parseRgOutput(String(err.stdout || ''), v.resolved, maxResults);
        } else {
          throw err;
        }
      }
    } catch {
      // ripgrep not available or failed — use Node.js recursive search
      matches = await nodeGrep(v.resolved, pattern, caseSensitive, filePattern, maxResults, contextLines);
    }

    return {
      success: true,
      result: {
        pattern,
        directory: v.resolved,
        case_sensitive: caseSensitive,
        match_count: matches.length,
        matches: matches.map(m => ({
          file: path.relative(v.resolved, m.file),
          line: m.line,
          text: m.text.slice(0, 500),
          ...(m.context && m.context.length > 0 ? { context: m.context } : {})
        }))
      }
    };
  } catch (err: any) {
    return { success: false, error: `grep_code failed: ${err.message}` };
  }
};

const MAX_OUTPUT_GREP = 512 * 1024; // 512 KB buffer for grep results

function parseRgOutput(stdout: string, _rootDir: string, maxResults: number) {
  const results: Array<{ file: string; line: number; text: string }> = [];
  const lines = stdout.split('\n').filter(Boolean);

  for (const line of lines) {
    if (results.length >= maxResults) break;
    // rg format: file:line:text
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (match) {
      results.push({
        file: match[1],
        line: parseInt(match[2], 10),
        text: match[3]
      });
    }
  }
  return results;
}

async function nodeGrep(
  dir: string, pattern: string, caseSensitive: boolean,
  filePattern: string, maxResults: number, contextLines: number
): Promise<Array<{ file: string; line: number; text: string; context?: string[] }>> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseSensitive ? '' : 'i');
  } catch {
    // Invalid regex — fall back to literal string match
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, caseSensitive ? '' : 'i');
  }
  const results: Array<{ file: string; line: number; text: string; context?: string[] }> = [];

  async function walk(currentDir: string, depth: number) {
    if (depth > 10 || results.length >= maxResults) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(path.join(currentDir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTS.has(ext)) continue;
        if (filePattern && !matchesGlob(entry.name, filePattern)) continue;

        const filePath = path.join(currentDir, entry.name);
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.size > 1_048_576) continue; // skip >1 MB files

          const content = await fs.promises.readFile(filePath, 'utf8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            if (regex.test(lines[i])) {
              const ctx: string[] = [];
              if (contextLines > 0) {
                for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) {
                  if (j !== i) ctx.push(`${j + 1}: ${lines[j]}`);
                }
              }
              results.push({
                file: filePath,
                line: i + 1,
                text: lines[i],
                ...(ctx.length > 0 ? { context: ctx } : {})
              });
            }
          }
        } catch {
          // Can't read file — skip
        }
      }
    }
  }

  await walk(dir, 0);
  return results;
}

// ============= PROJECT TREE HANDLER =============

export const projectTreeHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const dirRaw = String(args.directory || process.cwd());
    const v = validatePath(dirRaw);
    if (!v.valid) return { success: false, error: v.error };

    const maxDepth = Math.min(Math.max(1, Number(args.max_depth) || 4), 8);
    const showFiles = args.show_files !== false;
    const filePattern = String(args.file_pattern || '');
    const maxItems = Math.min(Math.max(10, Number(args.max_items) || 200), 500);

    let itemCount = 0;
    const treeLines: string[] = [];

    async function buildTree(dir: string, prefix: string, depth: number) {
      if (depth > maxDepth || itemCount >= maxItems) return;

      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      // Sort: directories first, then files, alphabetically
      const dirs = entries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
      const files = showFiles
        ? entries.filter(e => e.isFile() && (!filePattern || matchesGlob(e.name, filePattern))).sort((a, b) => a.name.localeCompare(b.name))
        : [];

      const allEntries = [...dirs, ...files];

      for (let i = 0; i < allEntries.length; i++) {
        if (itemCount >= maxItems) {
          treeLines.push(`${prefix}... (truncated, ${maxItems} item limit)`);
          return;
        }

        const entry = allEntries[i];
        const isLast = i === allEntries.length - 1;
        const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
        const childPrefix = isLast ? '    ' : '\u2502   ';

        if (entry.isDirectory()) {
          treeLines.push(`${prefix}${connector}${entry.name}/`);
          itemCount++;
          await buildTree(path.join(dir, entry.name), prefix + childPrefix, depth + 1);
        } else {
          treeLines.push(`${prefix}${connector}${entry.name}`);
          itemCount++;
        }
      }
    }

    const rootName = path.basename(v.resolved);
    treeLines.push(`${rootName}/`);
    itemCount++;
    await buildTree(v.resolved, '', 1);

    return {
      success: true,
      result: {
        directory: v.resolved,
        total_items: itemCount,
        tree: treeLines.join('\n')
      }
    };
  } catch (err: any) {
    return { success: false, error: `project_tree failed: ${err.message}` };
  }
};

// ============= ANALYZE FILE HANDLER =============

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript (React)', '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)', '.py': 'Python', '.rs': 'Rust',
  '.go': 'Go', '.java': 'Java', '.rb': 'Ruby', '.php': 'PHP',
  '.c': 'C', '.cpp': 'C++', '.h': 'C/C++ Header', '.cs': 'C#',
  '.swift': 'Swift', '.kt': 'Kotlin', '.scala': 'Scala',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.less': 'LESS',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
  '.xml': 'XML', '.md': 'Markdown', '.sql': 'SQL', '.sh': 'Shell',
  '.bash': 'Bash', '.ps1': 'PowerShell', '.bat': 'Batch',
  '.dockerfile': 'Dockerfile', '.vue': 'Vue', '.svelte': 'Svelte',
};

export const analyzeFileHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const filePath = String(args.file_path || '').trim();
    if (!filePath) return { success: false, error: 'file_path is required' };

    const v = validatePath(filePath);
    if (!v.valid) return { success: false, error: v.error };

    const stat = await fs.promises.stat(v.resolved);
    if (!stat.isFile()) return { success: false, error: 'Path is not a file' };
    if (stat.size > 2_097_152) return { success: false, error: 'File too large (>2 MB)' };

    const ext = path.extname(v.resolved).toLowerCase();
    const language = LANGUAGE_MAP[ext] || ext.slice(1).toUpperCase() || 'Unknown';
    const content = await fs.promises.readFile(v.resolved, 'utf8');
    const lines = content.split('\n');

    // Extract imports
    const imports: string[] = [];
    const importPatterns = [
      /^import\s+.+/,                    // JS/TS/Java/Python
      /^from\s+\S+\s+import/,            // Python
      /^require\s*\(/,                    // CommonJS
      /^const\s+\w+\s*=\s*require\(/,    // const x = require()
      /^use\s+\w/,                        // Rust/PHP
      /^#include\s/,                      // C/C++
      /^using\s+\w/,                      // C#
      /^package\s+\w/,                    // Go/Java
    ];
    for (const line of lines.slice(0, 100)) {
      const trimmed = line.trim();
      if (importPatterns.some(p => p.test(trimmed))) {
        imports.push(trimmed.slice(0, 120));
      }
    }

    // Extract exports
    const exports: string[] = [];
    const exportPatterns = [
      /^export\s+(default\s+)?(function|class|const|let|var|type|interface|enum)\s+(\w+)/,
      /^module\.exports/,
      /^pub\s+(fn|struct|enum|trait|mod)\s+(\w+)/,  // Rust
    ];
    for (const line of lines) {
      const trimmed = line.trim();
      for (const p of exportPatterns) {
        const m = trimmed.match(p);
        if (m) {
          exports.push(trimmed.slice(0, 120));
          break;
        }
      }
    }

    // Extract function/class/method names
    const symbols: string[] = [];
    const symbolPatterns = [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      /(?:export\s+)?class\s+(\w+)/,
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,  // arrow functions
      /(?:public|private|protected)\s+(?:async\s+)?(\w+)\s*\(/,          // class methods
      /def\s+(\w+)\s*\(/,                                                 // Python
      /fn\s+(\w+)\s*[(<]/,                                                // Rust
      /func\s+(\w+)\s*\(/,                                                // Go
    ];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      for (const p of symbolPatterns) {
        const m = trimmed.match(p);
        if (m && m[1]) {
          symbols.push(`${m[1]} (line ${i + 1})`);
          break;
        }
      }
    }

    return {
      success: true,
      result: {
        file: path.basename(v.resolved),
        path: v.resolved,
        language,
        lines: lines.length,
        size_bytes: stat.size,
        imports: imports.slice(0, 30),
        exports: exports.slice(0, 30),
        symbols: symbols.slice(0, 50),
        first_comment: extractFirstComment(lines)
      }
    };
  } catch (err: any) {
    return { success: false, error: `analyze_file failed: ${err.message}` };
  }
};

function extractFirstComment(lines: string[]): string {
  // Try to find the first block comment or line comments at the top
  const commentLines: string[] = [];
  let inBlock = false;

  for (const line of lines.slice(0, 30)) {
    const t = line.trim();
    if (!t && commentLines.length === 0) continue; // skip leading blanks

    if (t.startsWith('/**') || t.startsWith('/*') || t.startsWith('"""') || t.startsWith("'''")) {
      inBlock = true;
    }

    if (inBlock || t.startsWith('//') || t.startsWith('#') || t.startsWith('--')) {
      commentLines.push(t);
    } else if (commentLines.length > 0) {
      break;
    }

    if (inBlock && (t.endsWith('*/') || t.endsWith('"""') || t.endsWith("'''"))) {
      break;
    }
  }

  return commentLines.join('\n').slice(0, 500);
}

// ============= EXPORTS =============

export const codebaseToolDefs: ToolDefinition[] = [grepCodeDef, projectTreeDef, analyzeFileDef];

export const codebaseToolHandlers: Record<string, ToolHandler> = {
  grep_code: grepCodeHandler,
  project_tree: projectTreeHandler,
  analyze_file: analyzeFileHandler
};
