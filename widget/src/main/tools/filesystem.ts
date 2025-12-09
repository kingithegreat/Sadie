/**
 * SADIE File System Tools
 * 
 * Provides safe file system operations that SADIE can execute.
 * Includes safeguards like path validation and confirmation for destructive ops.
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult, ToolContext } from './types';

const fsPromises = fs.promises;

// Safety: Restrict operations to user's home directory and below
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
const DESKTOP_DIR = path.join(HOME_DIR, 'Desktop');
const ALLOWED_ROOTS = [
  HOME_DIR,
  path.join(HOME_DIR, 'Desktop'),
  path.join(HOME_DIR, 'Documents'),
  path.join(HOME_DIR, 'Downloads'),
];

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
  const resolved = path.resolve(targetPath);
  // Allow any path under user's home directory
  return resolved.startsWith(HOME_DIR);
}

function validatePath(targetPath: string): { valid: boolean; resolved: string; error?: string } {
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
  description: 'Read the contents of a text file',
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
        description: 'Maximum number of lines to read (default: 100)',
        default: 100
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

export const listDirectoryHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
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

export const readFileHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
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
    
    const content = await fsPromises.readFile(validation.resolved, 'utf-8');
    const lines = content.split('\n');
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

export const createDirectoryHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
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

export const moveFileHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
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

export const copyFileHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
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

export const deleteFileHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
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

export const writeFileHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
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

export const getFileInfoHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
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

// Export all tools as a map for easy registration
export const fileSystemTools = {
  list_directory: { definition: listDirectoryDef, handler: listDirectoryHandler },
  read_file: { definition: readFileDef, handler: readFileHandler },
  create_directory: { definition: createDirectoryDef, handler: createDirectoryHandler },
  move_file: { definition: moveFileDef, handler: moveFileHandler },
  copy_file: { definition: copyFileDef, handler: copyFileHandler },
  delete_file: { definition: deleteFileDef, handler: deleteFileHandler },
  write_file: { definition: writeFileDef, handler: writeFileHandler },
  get_file_info: { definition: getFileInfoDef, handler: getFileInfoHandler },
};
