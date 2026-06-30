/**
 * HomeBot Reminder Tool
 *
 * In-process time-based reminders. When a reminder fires it shows a desktop
 * notification via Electron. Reminders are persisted to <userData>/reminders.json
 * so they survive full process restarts.
 */

import { Notification, BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

// ---- Persistence helpers ----

function remindersFilePath(): string {
  try {
    return path.join(app.getPath('userData'), 'reminders.json');
  } catch {
    // In test environments app.getPath may not exist
    return path.join(process.env.TEMP || '/tmp', 'homebot-reminders.json');
  }
}

interface PersistedReminder {
  id: string;
  message: string;
  fireAt: number;
  label: string;
}

function loadRemindersFromDisk(): PersistedReminder[] {
  try {
    const raw = fs.readFileSync(remindersFilePath(), 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveRemindersToDisk(): void {
  try {
    const data = Array.from(reminders.values()).map(r => ({
      id: r.id, message: r.message, fireAt: r.fireAt, label: r.label,
    }));
    fs.writeFileSync(remindersFilePath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Reminders] Failed to save:', e);
  }
}

// ---- State ----

interface Reminder {
  id: string;
  message: string;
  fireAt: number; // ms epoch
  label: string;
  timerId: ReturnType<typeof setTimeout>;
}

const reminders = new Map<string, Reminder>();
let reminderSeq = 0;

function makeId(): string {
  return `rem-${Date.now()}-${++reminderSeq}`;
}

function fireReminder(id: string) {
  const r = reminders.get(id);
  if (!r) return;
  reminders.delete(id);
  saveRemindersToDisk();
  try {
    const n = new Notification({ title: `⏰ Reminder: ${r.label}`, body: r.message });
    n.show();
  } catch {
    // Electron not available in test environments — silently swallow
  }
  // Broadcast to renderer so the chat shows a system message
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('homebot:reminder-fired', { message: r.message, label: r.label });
      }
    }
  } catch {
    // ignore if no window
  }
}

// ============= TOOL DEFINITIONS =============

export const setReminderDef: ToolDefinition = {
  name: 'set_reminder',
  description:
    'Set a time-based reminder that fires a desktop notification after a given delay. ' +
    'Specify delay in seconds (e.g., 60 for 1 minute) or an absolute ISO 8601 time. ' +
    'Returns a reminder ID that can be used to cancel it.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The reminder message to show when it fires'
      },
      delay_seconds: {
        type: 'number',
        description: 'How many seconds from now to fire the reminder (use this OR fire_at)'
      },
      fire_at: {
        type: 'string',
        description:
          'ISO 8601 datetime to fire the reminder (e.g., "2026-03-04T15:30:00"). ' +
          'Use this OR delay_seconds.'
      },
      label: {
        type: 'string',
        description: 'Short label for the reminder notification title (default: "Reminder")'
      }
    },
    required: ['message']
  }
};

export const listRemindersDef: ToolDefinition = {
  name: 'list_reminders',
  description: 'List all pending (not yet fired) reminders with their IDs and scheduled fire times.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
};

export const cancelReminderDef: ToolDefinition = {
  name: 'cancel_reminder',
  description: 'Cancel a pending reminder by its ID (obtained from set_reminder or list_reminders).',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The reminder ID to cancel'
      }
    },
    required: ['id']
  }
};

// ============= TOOL HANDLERS =============

export const setReminderHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const message = String(args.message || '').trim();
    if (!message) return { success: false, error: 'message is required' };

    const label = String(args.label || 'Reminder').slice(0, 64);

    let delayMs: number;

    if (args.fire_at) {
      const target = new Date(String(args.fire_at)).getTime();
      if (isNaN(target)) return { success: false, error: `Invalid fire_at date: ${args.fire_at}` };
      delayMs = target - Date.now();
    } else if (args.delay_seconds !== undefined) {
      delayMs = Number(args.delay_seconds) * 1000;
    } else {
      return { success: false, error: 'Either delay_seconds or fire_at is required' };
    }

    if (delayMs <= 0) return { success: false, error: 'Reminder time must be in the future' };
    if (delayMs > 7 * 24 * 60 * 60 * 1000) {
      return { success: false, error: 'Reminder cannot be more than 7 days in the future' };
    }

    const id = makeId();
    const fireAt = Date.now() + delayMs;
    const timerId = setTimeout(() => fireReminder(id), delayMs);

    reminders.set(id, { id, message, fireAt, label, timerId });
    saveRemindersToDisk();

    const fireAtIso = new Date(fireAt).toISOString();
    return {
      success: true,
      result: {
        id,
        message,
        label,
        fire_at: fireAtIso,
        delay_seconds: Math.round(delayMs / 1000)
      }
    };
  } catch (err: any) {
    return { success: false, error: `set_reminder failed: ${err.message}` };
  }
};

export const listRemindersHandler: ToolHandler = async (): Promise<ToolResult> => {
  const list = Array.from(reminders.values()).map((r) => ({
    id: r.id,
    label: r.label,
    message: r.message,
    fire_at: new Date(r.fireAt).toISOString(),
    seconds_remaining: Math.max(0, Math.round((r.fireAt - Date.now()) / 1000))
  }));
  return { success: true, result: { count: list.length, reminders: list } };
};

export const cancelReminderHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const id = String(args.id || '').trim();
  if (!id) return { success: false, error: 'id is required' };

  const r = reminders.get(id);
  if (!r) return { success: false, error: `Reminder "${id}" not found` };

  clearTimeout(r.timerId);
  reminders.delete(id);
  saveRemindersToDisk();
  return { success: true, result: { id, cancelled: true } };
};

// ============= EXPORTS =============

/**
 * Restore reminders from disk on app startup.
 * Expired reminders fire immediately; future reminders get new timers.
 */
export function restoreReminders(): void {
  const saved = loadRemindersFromDisk();
  let restored = 0;
  let expired = 0;
  for (const r of saved) {
    const delay = r.fireAt - Date.now();
    if (delay <= 0) {
      // Already past due — fire immediately
      expired++;
      const id = r.id;
      const timerId = setTimeout(() => fireReminder(id), 0);
      reminders.set(id, { ...r, timerId });
    } else {
      restored++;
      const timerId = setTimeout(() => fireReminder(r.id), delay);
      reminders.set(r.id, { ...r, timerId });
    }
  }
  if (saved.length > 0) {
    console.log(`[Reminders] Restored ${restored} future + ${expired} expired from disk`);
  }
}

export const reminderToolDefs: ToolDefinition[] = [
  setReminderDef,
  listRemindersDef,
  cancelReminderDef
];

export const reminderToolHandlers: Record<string, ToolHandler> = {
  set_reminder: setReminderHandler,
  list_reminders: listRemindersHandler,
  cancel_reminder: cancelReminderHandler
};
