/**
 * SADIE Reminder Tool
 *
 * In-process time-based reminders. When a reminder fires it shows a desktop
 * notification via Electron. Reminders survive widget reload but not full
 * process restart (purely in-memory; no persistence layer required).
 */

import { Notification } from 'electron';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

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
  try {
    const n = new Notification({ title: `⏰ Reminder: ${r.label}`, body: r.message });
    n.show();
  } catch {
    // Electron not available in test environments — silently swallow
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
  return { success: true, result: { id, cancelled: true } };
};

// ============= EXPORTS =============

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
