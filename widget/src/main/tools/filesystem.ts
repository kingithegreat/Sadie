/**
 * HomeBot File System Tools
 * 
 * Provides safe file system operations that HomeBot can execute.
 * Includes safeguards like path validation and confirmation for destructive ops.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } from 'docx';
import ExcelJS from 'exceljs';
import * as mammoth from 'mammoth';
import PDFDocument from 'pdfkit';

import { ToolDefinition, ToolHandler, ToolResult } from './types';

const fsPromises = fs.promises;

// Safety: Restrict operations to user's home directory and below
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
const DESKTOP_DIR = path.join(HOME_DIR, 'Desktop');


// Expand common path shortcuts
function expandPath(inputPath: string): string {
  if (!inputPath) return inputPath;
  
  // Normalize path separators to forward slashes for easier parsing
  const normalizedInput = inputPath.replace(/\\/g, '/');
  const lowerPath = normalizedInput.toLowerCase();
  
  // Expand ~ to home directory
  if (normalizedInput === '~' || normalizedInput.startsWith('~/')) {
    return normalizedInput.replace(/^~/, HOME_DIR);
  }
  
  // Expand paths starting with Desktop/
  if (lowerPath === 'desktop' || lowerPath.startsWith('desktop/')) {
    return normalizedInput.replace(/^desktop/i, DESKTOP_DIR);
  }
  
  // Expand "home screen" variations
  if (lowerPath === 'home screen' || lowerPath === 'homescreen' || 
      lowerPath.startsWith('home screen/') || lowerPath.startsWith('homescreen/')) {
    return normalizedInput.replace(/^home\s*screen/i, DESKTOP_DIR);
  }
  
  // Expand paths starting with Documents/
  if (lowerPath === 'documents' || lowerPath === 'my documents' || 
      lowerPath.startsWith('documents/') || lowerPath.startsWith('my documents/')) {
    const docsDir = path.join(HOME_DIR, 'Documents');
    return normalizedInput.replace(/^(my\s*)?documents/i, docsDir);
  }
  
  // Expand paths starting with Downloads/
  if (lowerPath === 'downloads' || lowerPath.startsWith('downloads/')) {
    const downloadsDir = path.join(HOME_DIR, 'Downloads');
    return normalizedInput.replace(/^downloads/i, downloadsDir);
  }
  
  // Expand "home" to home directory
  if (lowerPath === 'home' || lowerPath === 'home directory' ||
      lowerPath.startsWith('home/')) {
    return normalizedInput.replace(/^home(\s*directory)?/i, HOME_DIR);
  }
  
  // If path doesn't start with drive letter or slash, treat as relative to Desktop
  if (!/^[a-zA-Z]:/.test(inputPath) && !inputPath.startsWith('/') && !inputPath.startsWith('\\')) {
    // Anything else without an absolute path goes to Desktop
    return path.join(DESKTOP_DIR, inputPath);
  }
  
  return inputPath;
}

function isPathAllowed(targetPath: string): boolean {
  if (!HOME_DIR) return false;

  const resolved = path.resolve(targetPath);
  const homeResolved = path.resolve(HOME_DIR);
  const rel = path.relative(homeResolved, resolved);

  // Allow only HOME_DIR itself or descendants (robust against prefix tricks).
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a user-facing path and report whether it is inside the home-directory
 * sandbox. Exported so the Explorer/editor IPC enforces the SAME boundary as
 * the LLM's filesystem tools — one guard, not a second copy that can drift.
 * `resolveUserPath` discards the error, so callers that must refuse need this.
 */
export function validatePath(targetPath: string): { valid: boolean; resolved: string; error?: string } {
  if (!targetPath || typeof targetPath !== 'string') {
    return { valid: false, resolved: '', error: 'Path is required' };
  }
  
  // Expand shortcuts like ~, desktop, etc.
  const expanded = expandPath(targetPath);
  const resolved = path.resolve(expanded);
  
  if (!isPathAllowed(resolved)) {
    return { valid: false, resolved, error: `Access denied: Path must be within your home directory (${HOME_DIR})` };
  }
  
  return { valid: true, resolved };
}

// Resolve a user-facing path (expands shortcuts and returns an absolute path)
export function resolveUserPath(targetPath: string): string {
  const validation = validatePath(targetPath);
  return validation.resolved;
}

// ============= TOOL DEFINITIONS =============

export const listDirectoryDef: ToolDefinition = {
  name: 'list_directory',
  description: 'List the contents of a directory, showing files and folders with their sizes and modification dates',
  category: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list (absolute or relative to home)'
      },
      showHidden: {
        type: 'boolean',
        description: 'Whether to show hidden files (starting with .)',
        default: false
      }
    },
    required: ['path']
  }
};

export const readFileDef: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a text file. Supports line ranges (e.g. start_line=50, end_line=80) for targeted reading.',
  category: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to read'
      },
      maxLines: {
        type: 'number',
        description: 'Maximum number of lines to read from the start (default: 100). Ignored if start_line is set.',
        default: 100
      },
      start_line: {
        type: 'number',
        description: 'Line number to start reading from (1-based). Use with end_line for targeted reading.'
      },
      end_line: {
        type: 'number',
        description: 'Line number to stop reading at (inclusive, 1-based). Defaults to start_line + 100 if omitted.'
      }
    },
    required: ['path']
  }
};

export const createDirectoryDef: ToolDefinition = {
  name: 'create_directory',
  description: 'Create a new directory (folder) at the specified path. IMPORTANT: The path MUST include the folder name to create. For example, to create a folder named "test" on desktop, use path="Desktop/test" NOT just "Desktop".',
  category: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The FULL path including the new folder name. Example: "Desktop/myfolder" or "~/Documents/newproject". Do NOT pass just a location like "~" or "Desktop" - you must include the new folder name.'
      }
    },
    required: ['path']
  }
};

export const moveFileDef: ToolDefinition = {
  name: 'move_file',
  description: 'Move or rename a file or directory',
  category: 'filesystem',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'The source file or directory path'
      },
      destination: {
        type: 'string',
        description: 'The destination path'
      }
    },
    required: ['source', 'destination']
  }
};

export const copyFileDef: ToolDefinition = {
  name: 'copy_file',
  description: 'Copy a file or directory to a new location',
  category: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'The source file or directory path'
      },
      destination: {
        type: 'string',
        description: 'The destination path'
      }
    },
    required: ['source', 'destination']
  }
};

export const deleteFileDef: ToolDefinition = {
  name: 'delete_file',
  description: 'Delete a file or directory. Use with caution!',
  category: 'filesystem',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file or directory path to delete'
      },
      recursive: {
        type: 'boolean',
        description: 'If true, delete directories and their contents recursively',
        default: false
      }
    },
    required: ['path']
  }
};

export const writeFileDef: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file. Creates the file if it does not exist.',
  category: 'filesystem',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to write to'
      },
      content: {
        type: 'string',
        description: 'The content to write to the file'
      },
      append: {
        type: 'boolean',
        description: 'If true, append to the file instead of overwriting',
        default: false
      }
    },
    required: ['path', 'content']
  }
};

export const createDocxDef: ToolDefinition = {
  name: 'create_docx',
  description: 'Create a Microsoft Word (.docx) document with formatted text, headings, bullet lists, and tables. Use this whenever the user asks to create a Word document, .docx file, or formatted document. Supports: "# Heading", "## Subheading", "### Sub-subheading", "- bullet item", "* bullet item", and markdown tables (| col1 | col2 |).',
  category: 'filesystem',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path for the .docx file (e.g. "Desktop/report.docx")'
      },
      title: {
        type: 'string',
        description: 'Document title shown as the first heading'
      },
      content: {
        type: 'string',
        description: 'The document body. Use "# Heading", "## Subheading", "### Sub-subheading" for headings, "- item" or "* item" for bullet lists, "| col1 | col2 |" rows for tables, blank lines for paragraph breaks.'
      }
    },
    required: ['path', 'content']
  }
};

export const createDocxHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const validation = validatePath(args.path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Ensure the path ends with .docx
  let resolvedPath = validation.resolved;
  if (!resolvedPath.toLowerCase().endsWith('.docx')) {
    resolvedPath += '.docx';
  }

  try {
    // Ensure parent directory exists
    await fsPromises.mkdir(path.dirname(resolvedPath), { recursive: true });

    const children: (Paragraph | Table)[] = [];

    // Optional document title as Heading1
    if (args.title) {
      children.push(
        new Paragraph({
          text: args.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 }
        })
      );
    }

    // ---- helpers ----
    const isBullet = (l: string) => /^[\-\*\u2022] /.test(l.trimStart());
    const isTableRow = (l: string) => l.trimStart().startsWith('|') && l.trimEnd().endsWith('|');
    const isSeparatorRow = (l: string) => /^[\|\s\-:]+$/.test(l); // e.g. |---|---|

    const makeParagraph = (text: string): Paragraph => {
      if (text.startsWith('### ')) return new Paragraph({ text: text.slice(4), heading: HeadingLevel.HEADING_3, spacing: { after: 120 } });
      if (text.startsWith('## '))  return new Paragraph({ text: text.slice(3), heading: HeadingLevel.HEADING_2, spacing: { after: 160 } });
      if (text.startsWith('# '))   return new Paragraph({ text: text.slice(2), heading: HeadingLevel.HEADING_1, spacing: { after: 200 } });
      return new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } });
    };

    const makeBullet = (text: string): Paragraph =>
      new Paragraph({
        children: [new TextRun(text.trimStart().replace(/^[\-\*\u2022] /, ''))],
        bullet: { level: 0 },
        spacing: { after: 80 }
      });

    const makeTable = (tableLines: string[]): Table => {
      const dataLines = tableLines.filter(l => !isSeparatorRow(l));
      const rows = dataLines.map((line, rowIdx) => {
        const cells = line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
        return new TableRow({
          children: cells.map(cellText =>
            new TableCell({
              children: [new Paragraph({
                children: [new TextRun({ text: cellText, bold: rowIdx === 0 })],
                alignment: AlignmentType.LEFT
              })],
              width: { size: Math.floor(9000 / Math.max(cells.length, 1)), type: WidthType.DXA }
            })
          ),
          tableHeader: rowIdx === 0
        });
      });
      return new Table({
        rows,
        width: { size: 9000, type: WidthType.DXA },
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 1 },
          bottom: { style: BorderStyle.SINGLE, size: 1 },
          left:   { style: BorderStyle.SINGLE, size: 1 },
          right:  { style: BorderStyle.SINGLE, size: 1 },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
          insideVertical:   { style: BorderStyle.SINGLE, size: 1 }
        }
      });
    };

    // ---- parse lines ----
    const rawLines: string[] = (args.content as string).split('\n');
    let i = 0;
    while (i < rawLines.length) {
      const line = rawLines[i];

      if (line.trim() === '') { i++; continue; }

      // Table block
      if (isTableRow(line)) {
        const tableLines: string[] = [];
        while (i < rawLines.length && isTableRow(rawLines[i])) {
          tableLines.push(rawLines[i]);
          i++;
        }
        if (tableLines.filter(l => !isSeparatorRow(l)).length > 0) {
          children.push(makeTable(tableLines));
          children.push(new Paragraph({ text: '', spacing: { after: 120 } })); // gap after table
        }
        continue;
      }

      // Bullet block
      if (isBullet(line)) {
        while (i < rawLines.length && (isBullet(rawLines[i]) || rawLines[i].trim() === '')) {
          if (rawLines[i].trim() !== '') children.push(makeBullet(rawLines[i]));
          i++;
        }
        continue;
      }

      // Paragraph / heading
      children.push(makeParagraph(line.trim()));
      i++;
    }

    const doc = new Document({
      sections: [{ children }]
    });

    const buf = await Packer.toBuffer(doc);
    await fsPromises.writeFile(resolvedPath, buf);

    return {
      success: true,
      result: {
        path: resolvedPath,
        message: `Word document created successfully at ${resolvedPath}`,
        size: buf.length
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to create Word document: ${err.message}` };
  }
};

export const createSpreadsheetDef: ToolDefinition = {
  name: 'create_spreadsheet',
  description: 'Create a Microsoft Excel (.xlsx) spreadsheet. Accepts data as a 2-D array of rows (first row is treated as the header). Use this whenever the user asks to create a spreadsheet, Excel file, or table of data.',
  category: 'filesystem',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path for the .xlsx file (e.g. "Desktop/budget.xlsx")'
      },
      sheet_name: {
        type: 'string',
        description: 'Name of the worksheet tab (default: "Sheet1")'
      },
      rows: {
        type: 'array',
        description: 'Array of rows. Each row is an array of cell values (strings or numbers). The first row is used as the column header.'
      }
    },
    required: ['path', 'rows']
  }
};

export const createSpreadsheetHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const validation = validatePath(args.path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  let resolvedPath = validation.resolved;
  if (!resolvedPath.toLowerCase().endsWith('.xlsx')) {
    resolvedPath += '.xlsx';
  }

  const rows: any[][] = args.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, error: 'rows must be a non-empty array of arrays' };
  }

  try {
    await fsPromises.mkdir(path.dirname(resolvedPath), { recursive: true });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HomeBot';
    workbook.created = new Date();

    const sheetName = (args.sheet_name as string | undefined)?.trim() || 'Sheet1';
    const sheet = workbook.addWorksheet(sheetName);

    // First row → bold header
    const headerRow = sheet.addRow(rows[0]);
    headerRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });

    // Remaining rows
    for (let i = 1; i < rows.length; i++) {
      sheet.addRow(rows[i]);
    }

    // Auto-fit column widths (max 50 chars)
    sheet.columns.forEach(col => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, cell => {
        const len = String(cell.value ?? '').length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 50);
    });

    await workbook.xlsx.writeFile(resolvedPath);

    return {
      success: true,
      result: {
        path: resolvedPath,
        message: `Spreadsheet created at ${resolvedPath}`,
        rows: rows.length,
        columns: rows[0].length
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to create spreadsheet: ${err.message}` };
  }
};

export const getFileInfoDef: ToolDefinition = {
  name: 'get_file_info',
  description: 'Get detailed information about a file or directory (size, dates, permissions)',
  category: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file or directory path'
      }
    },
    required: ['path']
  }
};

// ============= TOOL HANDLERS =============

export const listDirectoryHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const validation = validatePath(args.path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  try {
    const entries = await fsPromises.readdir(validation.resolved, { withFileTypes: true });
    const results = [];
    
    for (const entry of entries) {
      // Skip hidden files unless requested
      if (!args.showHidden && entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(validation.resolved, entry.name);
      let stats;
      try {
        stats = await fsPromises.stat(fullPath);
      } catch {
        continue; // Skip files we can't stat
      }
      
      results.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isDirectory() ? null : stats.size,
        modified: stats.mtime.toISOString(),
      });
    }
    
    // Sort: directories first, then alphabetically
    results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    
    return {
      success: true,
      result: {
        path: validation.resolved,
        count: results.length,
        entries: results
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to list directory: ${err.message}` };
  }
};

export const readFileHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const validation = validatePath(args.path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  try {
    const stats = await fsPromises.stat(validation.resolved);
    if (stats.isDirectory()) {
      return { success: false, error: 'Cannot read a directory as a file' };
    }
    
    // Limit file size to prevent memory issues (5MB max)
    if (stats.size > 5 * 1024 * 1024) {
      return { success: false, error: 'File is too large (max 5MB)' };
    }

    // .docx — extract plain text via mammoth
    if (validation.resolved.toLowerCase().endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: validation.resolved });
      const lines = result.value.split('\n');
      const maxLines = args.maxLines || 300;
      const truncated = lines.length > maxLines;
      return {
        success: true,
        result: {
          path: validation.resolved,
          content: lines.slice(0, maxLines).join('\n'),
          totalLines: lines.length,
          truncated,
          size: stats.size,
          format: 'docx'
        }
      };
    }

    const content = await fsPromises.readFile(validation.resolved, 'utf-8');
    const lines = content.split('\n');

    // Line-range mode: start_line (1-based) with optional end_line
    if (args.start_line != null) {
      const startLine = Math.max(1, Math.floor(Number(args.start_line)));
      const endLine = args.end_line != null
        ? Math.min(lines.length, Math.floor(Number(args.end_line)))
        : Math.min(lines.length, startLine + 99);
      if (startLine > lines.length) {
        return { success: false, error: `start_line ${startLine} exceeds file length (${lines.length} lines)` };
      }
      const slice = lines.slice(startLine - 1, endLine);
      // Number each line for easy reference
      const numbered = slice.map((l, i) => `${startLine + i}: ${l}`).join('\n');
      return {
        success: true,
        result: {
          path: validation.resolved,
          content: numbered,
          start_line: startLine,
          end_line: Math.min(endLine, lines.length),
          totalLines: lines.length,
          truncated: endLine < lines.length,
          size: stats.size
        }
      };
    }

    // Default: read from top with maxLines cap
    const maxLines = args.maxLines || 100;
    const truncated = lines.length > maxLines;
    const resultLines = lines.slice(0, maxLines);

    return {
      success: true,
      result: {
        path: validation.resolved,
        content: resultLines.join('\n'),
        totalLines: lines.length,
        truncated,
        size: stats.size
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to read file: ${err.message}` };
  }
};

export const createDirectoryHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const validation = validatePath(args.path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  // Check if this is a root directory that already exists (probably wrong usage)
  const resolvedPath = validation.resolved;
  const isRootDir = resolvedPath === HOME_DIR || resolvedPath === DESKTOP_DIR || 
                    resolvedPath === path.join(HOME_DIR, 'Documents') ||
                    resolvedPath === path.join(HOME_DIR, 'Downloads');
  
  try {
    // Check if directory already exists
    const exists = await fsPromises.access(resolvedPath).then(() => true).catch(() => false);

    
    if (exists && isRootDir) {
      return {
        success: false,
        error: `The path "${args.path}" resolves to "${resolvedPath}" which already exists. Did you forget to include the folder name? For example, to create a folder named "test" on desktop, use path="Desktop/test" not just "Desktop" or "~".`
      };
    }
    
    if (exists) {
      return {
        success: true,
        result: { 
          path: resolvedPath, 
          message: 'Directory already exists',
          alreadyExisted: true
        }
      };
    }
    
    await fsPromises.mkdir(resolvedPath, { recursive: true });
    return {
      success: true,
      result: { 
        path: resolvedPath, 
        message: `Directory "${path.basename(resolvedPath)}" created successfully at ${resolvedPath}`,
        alreadyExisted: false
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to create directory: ${err.message}` };
  }
};

export const moveFileHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const sourceValidation = validatePath(args.source);
  const destValidation = validatePath(args.destination);
  
  if (!sourceValidation.valid) {
    return { success: false, error: `Source: ${sourceValidation.error}` };
  }
  if (!destValidation.valid) {
    return { success: false, error: `Destination: ${destValidation.error}` };
  }
  
  try {
    // Check source exists
    await fsPromises.access(sourceValidation.resolved);
    
    await fsPromises.rename(sourceValidation.resolved, destValidation.resolved);
    return {
      success: true,
      result: {
        source: sourceValidation.resolved,
        destination: destValidation.resolved,
        message: 'File moved successfully'
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to move file: ${err.message}` };
  }
};

export const copyFileHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const sourceValidation = validatePath(args.source);
  const destValidation = validatePath(args.destination);
  
  if (!sourceValidation.valid) {
    return { success: false, error: `Source: ${sourceValidation.error}` };
  }
  if (!destValidation.valid) {
    return { success: false, error: `Destination: ${destValidation.error}` };
  }
  
  try {
    const stats = await fsPromises.stat(sourceValidation.resolved);
    
    if (stats.isDirectory()) {
      // Recursive directory copy
      await copyDirectory(sourceValidation.resolved, destValidation.resolved);
    } else {
      // Ensure parent directory exists
      await fsPromises.mkdir(path.dirname(destValidation.resolved), { recursive: true });
      await fsPromises.copyFile(sourceValidation.resolved, destValidation.resolved);
    }
    
    return {
      success: true,
      result: {
        source: sourceValidation.resolved,
        destination: destValidation.resolved,
        message: 'File copied successfully'
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to copy file: ${err.message}` };
  }
};

async function copyDirectory(source: string, destination: string): Promise<void> {
  await fsPromises.mkdir(destination, { recursive: true });
  const entries = await fsPromises.readdir(source, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fsPromises.copyFile(srcPath, destPath);
    }
  }
}

export const deleteFileHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const validation = validatePath(args.path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  try {
    const stats = await fsPromises.stat(validation.resolved);
    
    if (stats.isDirectory()) {
      if (args.recursive) {
        await fsPromises.rm(validation.resolved, { recursive: true, force: true });
      } else {
        await fsPromises.rmdir(validation.resolved);
      }
    } else {
      await fsPromises.unlink(validation.resolved);
    }
    
    return {
      success: true,
      result: { path: validation.resolved, message: 'Deleted successfully' }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to delete: ${err.message}` };
  }
};

export const writeFileHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const validation = validatePath(args.path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  try {
    // Ensure parent directory exists
    await fsPromises.mkdir(path.dirname(validation.resolved), { recursive: true });
    
    if (args.append) {
      await fsPromises.appendFile(validation.resolved, args.content, 'utf-8');
    } else {
      await fsPromises.writeFile(validation.resolved, args.content, 'utf-8');
    }
    
    // Log successful write
    return {
      success: true,
      result: {
        path: validation.resolved,
        message: args.append ? 'Content appended successfully' : 'File written successfully',
        size: Buffer.byteLength(args.content, 'utf-8')
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to write file: ${err.message}` };
  }
};

export const getFileInfoHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const validation = validatePath(args.path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  try {
    const stats = await fsPromises.stat(validation.resolved);
    
    return {
      success: true,
      result: {
        path: validation.resolved,
        name: path.basename(validation.resolved),
        type: stats.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        accessed: stats.atime.toISOString(),
        isReadOnly: !(stats.mode & 0o200),
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to get file info: ${err.message}` };
  }
};

export const createPdfDef: ToolDefinition = {
  name: 'create_pdf',
  description: 'Create a PDF document from text content. Supports headings (# ## ###), bullet lists (- or *), and plain paragraphs. Use this when the user asks to create a PDF, export as PDF, or generate a portable document.',
  category: 'filesystem',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path for the PDF (e.g. "Desktop/report.pdf")'
      },
      title: {
        type: 'string',
        description: 'Document title shown at the top of the first page'
      },
      content: {
        type: 'string',
        description: 'Document body. Use "# Heading", "## Subheading", "### Sub-subheading" for headings, "- item" or "* item" for bullets, blank lines for paragraph breaks.'
      }
    },
    required: ['path', 'content']
  }
};

export const createPdfHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const validation = validatePath(args.path);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  let resolvedPath = validation.resolved;
  if (!resolvedPath.toLowerCase().endsWith('.pdf')) {
    resolvedPath += '.pdf';
  }

  try {
    await fsPromises.mkdir(path.dirname(resolvedPath), { recursive: true });

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 60, size: 'A4' });
      const stream = fs.createWriteStream(resolvedPath);
      doc.pipe(stream);

      // Title
      if (args.title) {
        doc.fontSize(22).font('Helvetica-Bold').text(args.title, { align: 'center' });
        doc.moveDown(1.2);
      }

      const lines: string[] = (args.content as string).split('\n');

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '') {
          doc.moveDown(0.5);
          continue;
        }

        if (trimmed.startsWith('### ')) {
          doc.fontSize(13).font('Helvetica-Bold').text(trimmed.slice(4));
          doc.moveDown(0.4);
        } else if (trimmed.startsWith('## ')) {
          doc.fontSize(16).font('Helvetica-Bold').text(trimmed.slice(3));
          doc.moveDown(0.5);
        } else if (trimmed.startsWith('# ')) {
          doc.fontSize(20).font('Helvetica-Bold').text(trimmed.slice(2));
          doc.moveDown(0.6);
        } else if (/^[-*\u2022] /.test(trimmed)) {
          doc.fontSize(11).font('Helvetica').text('• ' + trimmed.replace(/^[-*\u2022] /, ''), { indent: 20 });
          doc.moveDown(0.3);
        } else {
          doc.fontSize(11).font('Helvetica').text(trimmed);
          doc.moveDown(0.4);
        }
      }

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    const size = (await fsPromises.stat(resolvedPath)).size;
    return {
      success: true,
      result: {
        path: resolvedPath,
        message: `PDF created at ${resolvedPath}`,
        size
      }
    };
  } catch (err: any) {
    return { success: false, error: `Failed to create PDF: ${err.message}` };
  }
};

// Export all tools as a map for easy registration

export const searchFilesDef: ToolDefinition = {
  name: 'search_files',
  description: 'Search for files by name pattern or search inside file contents for matching text. Use this when the user asks to find files, locate something on disk, or search for text within files.',
  category: 'filesystem',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Directory to search in (e.g. "Desktop", "Documents", "~"). Defaults to home directory.'
      },
      filename_pattern: {
        type: 'string',
        description: 'Glob-style pattern to match filenames (e.g. "*.txt", "report*", "*.js"). Leave empty to search all files.'
      },
      content_query: {
        type: 'string',
        description: 'Text or regex pattern to search for inside file contents. Leave empty to only match by filename.'
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Whether the content search is case-sensitive (default: false)',
        default: false
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default: 20, max: 100)',
        default: 20
      }
    },
    required: ['directory']
  }
};

export const searchFilesHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const dirArg = (args.directory as string) || '~';
  const validation = validatePath(dirArg);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const searchDir = validation.resolved;
  const filenamePattern: string = (args.filename_pattern as string | undefined) || '';
  const contentQuery: string = (args.content_query as string | undefined) || '';
  const caseSensitive: boolean = !!(args.case_sensitive);
  const maxResults: number = Math.min(Number(args.max_results) || 20, 100);

  // Build filename regex from glob pattern
  const filenameRegex: RegExp | null = filenamePattern
    ? new RegExp(
        '^' + filenamePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        caseSensitive ? '' : 'i'
      )
    : null;

  const contentRegex: RegExp | null = contentQuery
    ? new RegExp(contentQuery, caseSensitive ? '' : 'i')
    : null;

  const results: Array<{ file: string; matches?: Array<{ line: number; text: string }> }> = [];

  const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);
  const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.json', '.csv', '.log', '.ts', '.tsx', '.js', '.jsx',
    '.html', '.htm', '.css', '.xml', '.yaml', '.yml', '.toml', '.ini',
    '.cfg', '.conf', '.sh', '.bat', '.ps1', '.py', '.rb', '.go', '.rs',
    '.c', '.cpp', '.h', '.java', '.cs', '.sql', '.env', '.gitignore',
    '.editorconfig', '.prettierrc', '.eslintrc', '.rtf'
  ]);

  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= maxResults) return;
    if (depth > 6) return; // cap recursion depth

    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath, depth + 1);
      } else {
        // Check filename match
        const nameOk = filenameRegex ? filenameRegex.test(entry.name) : true;
        if (!nameOk) continue;

        if (contentRegex) {
          // Only scan readable text files
          const ext = path.extname(entry.name).toLowerCase();
          if (!TEXT_EXTENSIONS.has(ext)) continue;

          let fileSize = 0;
          try { fileSize = (await fsPromises.stat(fullPath)).size; } catch { continue; }
          if (fileSize > 2 * 1024 * 1024) continue; // skip files >2MB

          let content: string;
          try { content = await fsPromises.readFile(fullPath, 'utf-8'); } catch { continue; }

          const lines = content.split('\n');
          const matchingLines: Array<{ line: number; text: string }> = [];
          for (let i = 0; i < lines.length; i++) {
            if (contentRegex.test(lines[i])) {
              matchingLines.push({ line: i + 1, text: lines[i].trim().slice(0, 120) });
              if (matchingLines.length >= 5) break; // max 5 matching lines per file
            }
          }
          if (matchingLines.length > 0) {
            results.push({ file: fullPath, matches: matchingLines });
          }
        } else {
          // Filename-only match
          results.push({ file: fullPath });
        }
      }
    }
  }

  try {
    await walk(searchDir, 0);
  } catch (err: any) {
    return { success: false, error: `Search failed: ${err.message}` };
  }

  return {
    success: true,
    result: {
      directory: searchDir,
      filename_pattern: filenamePattern || '(any)',
      content_query: contentQuery || '(none)',
      count: results.length,
      results
    }
  };
};

// ============= EDIT FILE (find-and-replace) =============

export const editFileDef: ToolDefinition = {
  name: 'edit_file',
  description:
    'Edit a file by replacing a specific text block with new content. ' +
    'Use this instead of write_file when you only need to change part of a file. ' +
    'Provide the exact text to find (old_string) and what to replace it with (new_string). ' +
    'The old_string must match EXACTLY (including whitespace and indentation).',
  category: 'filesystem',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to edit'
      },
      old_string: {
        type: 'string',
        description: 'The exact text to find in the file (must be unique within the file)'
      },
      new_string: {
        type: 'string',
        description: 'The replacement text'
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences (default: false — only first match)',
        default: false
      }
    },
    required: ['path', 'old_string', 'new_string']
  }
};

export const editFileHandler: ToolHandler = async (args, _context): Promise<ToolResult> => {
  const filePath = expandPath(String(args.path || ''));
  const validation = validatePath(filePath);
  if (!validation.valid) return { success: false, error: validation.error };

  const oldString = String(args.old_string || '');
  const newString = String(args.new_string || '');
  const replaceAll = args.replace_all === true;

  if (!oldString) return { success: false, error: 'old_string is required' };
  if (oldString === newString) return { success: false, error: 'old_string and new_string are identical' };

  try {
    const fullPath = validation.resolved!;
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${fullPath}` };
    }

    const content = await fsPromises.readFile(fullPath, 'utf-8');

    if (!content.includes(oldString)) {
      // Try to help: show nearby lines
      const lines = content.split('\n');
      const firstWord = oldString.trim().split(/\s+/)[0];
      const nearMatches = lines
        .map((l, i) => ({ line: i + 1, text: l }))
        .filter(l => l.text.includes(firstWord))
        .slice(0, 3);
      const hint = nearMatches.length > 0
        ? ` Nearby lines containing "${firstWord}": ${nearMatches.map(m => `line ${m.line}: "${m.text.trim().slice(0, 80)}"`).join(', ')}`
        : '';
      return { success: false, error: `old_string not found in file.${hint}` };
    }

    // Check uniqueness (unless replace_all)
    if (!replaceAll) {
      const count = content.split(oldString).length - 1;
      if (count > 1) {
        return {
          success: false,
          error: `old_string appears ${count} times in the file. Provide more context to make it unique, or set replace_all: true.`
        };
      }
    }

    const updated = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);

    await fsPromises.writeFile(fullPath, updated, 'utf-8');

    const replacements = replaceAll ? content.split(oldString).length - 1 : 1;
    return {
      success: true,
      result: {
        path: fullPath,
        replacements,
        old_length: oldString.length,
        new_length: newString.length,
        file_lines: updated.split('\n').length
      }
    };
  } catch (err: any) {
    return { success: false, error: `edit_file failed: ${err.message}` };
  }
};

export const fileSystemTools = {
  list_directory: { definition: listDirectoryDef, handler: listDirectoryHandler },
  read_file: { definition: readFileDef, handler: readFileHandler },
  search_files: { definition: searchFilesDef, handler: searchFilesHandler },
  create_directory: { definition: createDirectoryDef, handler: createDirectoryHandler },
  move_file: { definition: moveFileDef, handler: moveFileHandler },
  copy_file: { definition: copyFileDef, handler: copyFileHandler },
  delete_file: { definition: deleteFileDef, handler: deleteFileHandler },
  write_file: { definition: writeFileDef, handler: writeFileHandler },
  edit_file: { definition: editFileDef, handler: editFileHandler },
  create_docx: { definition: createDocxDef, handler: createDocxHandler },
  create_spreadsheet: { definition: createSpreadsheetDef, handler: createSpreadsheetHandler },
  create_pdf: { definition: createPdfDef, handler: createPdfHandler },
  get_file_info: { definition: getFileInfoDef, handler: getFileInfoHandler },
};
