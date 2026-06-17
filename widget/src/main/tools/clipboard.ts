/**
 * HomeBot Clipboard Tools
 *
 * Read from and write to the Windows clipboard via PowerShell.
 *
 * Tools:
 *   clipboard_read   — paste current clipboard text (no confirmation needed)
 *   clipboard_write  — copy text to the clipboard (requires confirmation)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);

/** Strip characters that could break a PowerShell single-quoted string */
function sanitizePS(value: string): string {
  return String(value)
    .replace(/'/g, '\u2019')   // curly apostrophe
    .replace(/`/g, '')
    .replace(/\$/g, '')
    .replace(/[\x00-\x1F]/g, '');
}

// ----- Definitions -----

export const clipboardReadDef: ToolDefinition = {
  name: 'clipboard_read',
  description: 'Read the current text content of the Windows clipboard.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const clipboardWriteDef: ToolDefinition = {
  name: 'clipboard_write',
  description: 'Copy text to the Windows clipboard, replacing whatever is currently there.',
  category: 'utility',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to copy to the clipboard',
      },
    },
    required: ['text'],
  },
};

// ----- Handlers -----

export const clipboardReadHandler: ToolHandler = async (_args): Promise<ToolResult> => {
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -NonInteractive -Command "Get-Clipboard"',
      { timeout: 5000 }
    );
    const content = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
    return {
      success: true,
      result: {
        content,
        empty: content.length === 0,
        length: content.length,
      },
    };
  } catch (err) {
    return { success: false, error: `Could not read clipboard: ${(err as any)?.message}` };
  }
};

export const clipboardWriteHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const text = String(args.text ?? '');
  const safe = sanitizePS(text);
  try {
    await execAsync(
      `powershell -NoProfile -NonInteractive -Command "Set-Clipboard -Value '${safe}'"`,
      { timeout: 5000 }
    );
    return {
      success: true,
      result: {
        copied: true,
        length: text.length,
        preview: text.slice(0, 120) + (text.length > 120 ? '…' : ''),
      },
    };
  } catch (err) {
    return { success: false, error: `Could not write to clipboard: ${(err as any)?.message}` };
  }
};

// ----- Exports -----

export const clipboardToolDefs: ToolDefinition[] = [clipboardReadDef, clipboardWriteDef];

export const clipboardToolHandlers: Record<string, ToolHandler> = {
  clipboard_read:  clipboardReadHandler,
  clipboard_write: clipboardWriteHandler,
};
