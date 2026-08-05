/**
 * terminal-ipc.ts — IPC surface for the interactive Terminal panel.
 *
 * Streaming, so it is not purely request/response like trust-ipc: output is
 * pushed to the invoking renderer on TERMINAL_CHANNELS.OUTPUT / .EXIT while a
 * command runs. Everything else follows the same conventions — channel
 * constants, re-registration-safe handlers, and failures degraded to
 * { success: false } rather than thrown across the boundary.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  createSession,
  runCommand,
  killCommand,
  closeSession,
  getSession,
  TerminalChunk,
  TerminalExit,
} from './terminal-session';

export const TERMINAL_CHANNELS = {
  CREATE: 'homebot:terminal:create',
  RUN: 'homebot:terminal:run',
  KILL: 'homebot:terminal:kill',
  CLOSE: 'homebot:terminal:close',
  STATUS: 'homebot:terminal:status',
  OUTPUT: 'homebot:terminal:output',
  EXIT: 'homebot:terminal:exit',
} as const;

export interface TerminalCreateResult {
  success: boolean;
  id?: string;
  cwd?: string;
  error?: string;
}

export interface TerminalActionResult {
  success: boolean;
  error?: string;
}

export interface TerminalStatusResult {
  success: boolean;
  cwd?: string;
  running?: boolean;
  error?: string;
}

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Send to the renderer that owns this terminal, guarding a destroyed window. */
function push(event: IpcMainInvokeEvent, channel: string, payload: unknown): void {
  try {
    if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
  } catch {
    /* renderer went away mid-command; nothing to do */
  }
}

export function registerTerminalIpc(): void {
  for (const channel of [
    TERMINAL_CHANNELS.CREATE,
    TERMINAL_CHANNELS.RUN,
    TERMINAL_CHANNELS.KILL,
    TERMINAL_CHANNELS.CLOSE,
    TERMINAL_CHANNELS.STATUS,
  ]) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(
    TERMINAL_CHANNELS.CREATE,
    async (_e, cwd?: unknown): Promise<TerminalCreateResult> => {
      try {
        const session = createSession(typeof cwd === 'string' ? cwd : undefined);
        return { success: true, id: session.id, cwd: session.cwd };
      } catch (e) {
        return { success: false, error: fail(e) };
      }
    },
  );

  ipcMain.handle(
    TERMINAL_CHANNELS.RUN,
    async (event, id?: unknown, command?: unknown): Promise<TerminalActionResult> => {
      try {
        if (typeof id !== 'string' || typeof command !== 'string') {
          return { success: false, error: 'Invalid terminal request.' };
        }
        const res = runCommand(id, command, {
          onChunk: (chunk: TerminalChunk) => push(event, TERMINAL_CHANNELS.OUTPUT, chunk),
          onExit: (exit: TerminalExit) => push(event, TERMINAL_CHANNELS.EXIT, exit),
        });
        return res.started ? { success: true } : { success: false, error: res.error };
      } catch (e) {
        return { success: false, error: fail(e) };
      }
    },
  );

  ipcMain.handle(TERMINAL_CHANNELS.KILL, async (_e, id?: unknown): Promise<TerminalActionResult> => {
    try {
      if (typeof id !== 'string') return { success: false, error: 'Invalid terminal id.' };
      const res = killCommand(id);
      return res.killed ? { success: true } : { success: false, error: res.error };
    } catch (e) {
      return { success: false, error: fail(e) };
    }
  });

  ipcMain.handle(TERMINAL_CHANNELS.CLOSE, async (_e, id?: unknown): Promise<TerminalActionResult> => {
    try {
      if (typeof id !== 'string') return { success: false, error: 'Invalid terminal id.' };
      closeSession(id);
      return { success: true };
    } catch (e) {
      return { success: false, error: fail(e) };
    }
  });

  ipcMain.handle(TERMINAL_CHANNELS.STATUS, async (_e, id?: unknown): Promise<TerminalStatusResult> => {
    try {
      if (typeof id !== 'string') return { success: false, error: 'Invalid terminal id.' };
      const s = getSession(id);
      return s ? { success: true, cwd: s.cwd, running: s.running } : { success: false, error: 'Session not found.' };
    } catch (e) {
      return { success: false, error: fail(e) };
    }
  });
}
