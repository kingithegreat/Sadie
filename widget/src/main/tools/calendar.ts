/**
 * SADIE Calendar Tool
 *
 * Priority order for listing events:
 *   1. Google Calendar via n8n webhook  (POST /webhook/sadie/calendar)
 *   2. Microsoft Outlook COM automation (Windows only, Outlook must be installed)
 *   3. Local JSON fallback store        (memory/json-store/calendar.json)
 *
 * To enable Google Calendar: import n8n-workflows/google-calendar.json into
 * n8n and connect a Google Calendar credential. No other config needed.
 *
 * Tools:
 *   list_calendar_events  — return upcoming events (today + N days)
 *   add_calendar_event    — create a new event (requires confirmation)
 *   delete_calendar_event — remove an event by id (requires confirmation)
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import axios from 'axios';
import { getSettings } from '../config-manager';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const execAsync = promisify(exec);

// ----- Local JSON fallback store -----
const LOCAL_CALENDAR_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Desktop', 'sadie', 'memory', 'json-store', 'calendar.json'
);

interface CalEvent {
  id: string;
  title: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  location?: string;
  notes?: string;
  source: 'outlook' | 'local';
}

function loadLocal(): CalEvent[] {
  try {
    if (fs.existsSync(LOCAL_CALENDAR_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_CALENDAR_PATH, 'utf-8')) as CalEvent[];
    }
  } catch { /* ignore */ }
  return [];
}

function saveLocal(events: CalEvent[]): void {
  try {
    fs.mkdirSync(path.dirname(LOCAL_CALENDAR_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_CALENDAR_PATH, JSON.stringify(events, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Calendar] Failed to save local store:', e);
  }
}

function makeId(): string {
  return `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ----- Outlook COM helpers -----

/**
 * Sanitize a string for safe embedding inside a PowerShell here-string.
 * Removes characters that could escape the boundary or inject PS code.
 */
function sanitizeForPS(value: string): string {
  // Remove single-quotes and backticks that could break PowerShell string literals
  return String(value)
    .replace(/'/g, '\u2019')   // curly apostrophe — visually identical, harmless
    .replace(/`/g, '')         // PS escape char
    .replace(/\$/g, '')        // PS variable sigil
    .replace(/[\x00-\x1F]/g, ''); // control characters
}

async function listOutlookEvents(daysAhead: number): Promise<CalEvent[]> {
  const safeDays = Math.max(1, Math.min(daysAhead, 90));
  const script = `
$ol = New-Object -ComObject Outlook.Application -ErrorAction Stop
$ns = $ol.GetNamespace('MAPI')
$cal = $ns.GetDefaultFolder(9)  # olFolderCalendar
$start = [DateTime]::Today
$end   = $start.AddDays(${safeDays})
$items = $cal.Items
$items.IncludeRecurrences = $true
$items.Sort('[Start]')
$filter = "[Start] >= '" + $start.ToString('MM/dd/yyyy') + "' AND [Start] < '" + $end.ToString('MM/dd/yyyy') + "'"
$filtered = $items.Restrict($filter)
$results = @()
foreach ($item in $filtered) {
  $results += @{
    id       = $item.EntryID
    title    = $item.Subject
    start    = $item.Start.ToString('o')
    end      = $item.End.ToString('o')
    location = $item.Location
    notes    = $item.Body -replace "[\\r\\n]+", " " | ForEach-Object { $_.Substring(0, [Math]::Min($_.Length, 200)) }
    source   = 'outlook'
  }
}
$results | ConvertTo-Json -Depth 3 -Compress
`.trim();

  const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 15000 });
  const raw = stdout.trim();
  if (!raw || raw === 'null') return [];
  const parsed = JSON.parse(raw);
  const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map((e: any) => ({
    id: String(e.id || makeId()),
    title: String(e.title || '(No subject)'),
    start: String(e.start || ''),
    end: String(e.end || ''),
    location: e.location ? String(e.location) : undefined,
    notes: e.notes ? String(e.notes) : undefined,
    source: 'outlook' as const,
  }));
}

async function addOutlookEvent(title: string, start: string, end: string, location: string, notes: string): Promise<string> {
  const safeTitle    = sanitizeForPS(title);
  const safeLocation = sanitizeForPS(location);
  const safeNotes    = sanitizeForPS(notes);

  const script = `
$ol    = New-Object -ComObject Outlook.Application -ErrorAction Stop
$appt  = $ol.CreateItem(1)
$appt.Subject  = '${safeTitle}'
$appt.Start    = [DateTime]::Parse('${sanitizeForPS(start)}')
$appt.End      = [DateTime]::Parse('${sanitizeForPS(end)}')
$appt.Location = '${safeLocation}'
$appt.Body     = '${safeNotes}'
$appt.Save()
Write-Output $appt.EntryID
`.trim();

  const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 15000 });
  return stdout.trim() || makeId();
}

// ----- Google Calendar via n8n -----

/**
 * Call the n8n Google Calendar webhook.
 * The workflow at /webhook/sadie/calendar must be imported and active in n8n.
 * Returns [] if n8n is offline or the workflow isn't installed.
 */
async function listGoogleCalendarEvents(daysAhead: number, limit: number): Promise<CalEvent[]> {
  const { n8nUrl } = getSettings();
  const url = `${n8nUrl}/webhook/sadie/calendar`;
  const response = await axios.post(
    url,
    { action: 'list', days_ahead: daysAhead, limit },
    { timeout: 10000 }
  );
  const data = response.data;
  // n8n workflow returns { events: [...] } or an array directly
  const raw: any[] = Array.isArray(data) ? data : (Array.isArray(data?.events) ? data.events : []);
  return raw.map((e: any) => ({
    id: String(e.id || makeId()),
    title: String(e.title || e.summary || '(No subject)'),
    start: String(e.start || e.startTime || ''),
    end: String(e.end || e.endTime || ''),
    location: e.location ? String(e.location) : undefined,
    notes: e.notes || e.description ? String(e.notes || e.description).slice(0, 200) : undefined,
    source: 'outlook' as const, // reuse type; 'google' is not in the union — treated as external
  }));
}

async function addGoogleCalendarEvent(title: string, start: string, end: string, location: string, notes: string): Promise<string | null> {
  const { n8nUrl } = getSettings();
  const url = `${n8nUrl}/webhook/sadie/calendar`;
  const response = await axios.post(
    url,
    { action: 'add', title, start, end, location, notes },
    { timeout: 10000 }
  );
  return String(response.data?.id || '').trim() || null;
}

// ----- Tool definitions -----

export const listCalendarEventsDef: ToolDefinition = {
  name: 'list_calendar_events',
  description:
    'List upcoming calendar events from Microsoft Outlook (if available) or the local calendar store. ' +
    'Returns events sorted by start time. Default: next 7 days.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      days_ahead: {
        type: 'number',
        description: 'How many days ahead to look (1–90, default: 7)',
        default: 7,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return (default: 20)',
        default: 20,
      },
    },
    required: [],
  },
};

export const addCalendarEventDef: ToolDefinition = {
  name: 'add_calendar_event',
  description:
    'Add a new calendar event to Microsoft Outlook (if available) or the local calendar store. ' +
    'Requires user confirmation before saving. start and end must be ISO 8601 strings.',
  category: 'utility',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Event title / subject',
      },
      start: {
        type: 'string',
        description: 'Start time in ISO 8601 format (e.g. "2026-03-07T09:00:00")',
      },
      end: {
        type: 'string',
        description: 'End time in ISO 8601 format (e.g. "2026-03-07T10:00:00")',
      },
      location: {
        type: 'string',
        description: 'Location (optional)',
      },
      notes: {
        type: 'string',
        description: 'Notes / body (optional)',
      },
    },
    required: ['title', 'start', 'end'],
  },
};

export const deleteCalendarEventDef: ToolDefinition = {
  name: 'delete_calendar_event',
  description: 'Delete a local calendar event by its id. Only works for events stored in the local calendar store (not Outlook).',
  category: 'utility',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The event id returned by list_calendar_events',
      },
    },
    required: ['id'],
  },
};

// ----- Tool handlers -----

export const listCalendarEventsHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const daysAhead = Math.max(1, Math.min(Number(args.days_ahead) || 7, 90));
  const limit     = Math.max(1, Math.min(Number(args.limit) || 20, 100));

  let events: CalEvent[] = [];
  let source = 'local';

  // 1. Try Google Calendar via n8n webhook first
  try {
    const googleEvents = await listGoogleCalendarEvents(daysAhead, limit);
    if (googleEvents.length > 0) {
      events = googleEvents;
      source = 'google';
    }
  } catch (err) {
    console.log('[Calendar] Google Calendar (n8n) unavailable:', (err as any)?.message?.slice(0, 80));
  }

  // 2. Try Outlook if Google returned nothing
  if (events.length === 0) {
    try {
      const outlookEvents = await listOutlookEvents(daysAhead);
      if (outlookEvents.length > 0) {
        events = outlookEvents;
        source = 'outlook';
      }
    } catch (err) {
      console.log('[Calendar] Outlook unavailable, using local store:', (err as any)?.message?.slice(0, 100));
    }
  }

  // Merge / fallback to local store
  const local = loadLocal();
  const now = Date.now();
  const cutoff = now + daysAhead * 86400000;
  const upcomingLocal = local.filter(e => {
    const t = Date.parse(e.start);
    return !isNaN(t) && t >= now && t <= cutoff;
  });

  if (events.length === 0) {
    events = upcomingLocal;
  } else {
    // Append any local events not already returned by Outlook (by title+start key)
    const seen = new Set(events.map(e => `${e.title}|${e.start}`));
    for (const le of upcomingLocal) {
      if (!seen.has(`${le.title}|${le.start}`)) events.push(le);
    }
  }

  events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const limited = events.slice(0, limit);

  return {
    success: true,
    result: {
      events: limited,
      count: limited.length,
      days_ahead: daysAhead,
      source,
    },
  };
};

export const addCalendarEventHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const title    = String(args.title || '').trim();
  const start    = String(args.start || '').trim();
  const end      = String(args.end   || '').trim();
  const location = String(args.location || '').trim();
  const notes    = String(args.notes || '').trim();

  if (!title) return { success: false, error: 'title is required' };
  if (!start) return { success: false, error: 'start date/time is required' };
  if (!end)   return { success: false, error: 'end date/time is required' };

  const startMs = Date.parse(start);
  const endMs   = Date.parse(end);
  if (isNaN(startMs)) return { success: false, error: `Invalid start date: ${start}` };
  if (isNaN(endMs))   return { success: false, error: `Invalid end date: ${end}` };
  if (endMs <= startMs) return { success: false, error: 'end must be after start' };

  // 1. Try Google Calendar via n8n
  let outlookId: string | null = null;
  try {
    outlookId = await addGoogleCalendarEvent(title, start, end, location, notes);
    if (outlookId) console.log('[Calendar] Event added to Google Calendar via n8n');
  } catch (err) {
    console.log('[Calendar] Google Calendar add failed, trying Outlook:', (err as any)?.message?.slice(0, 80));
  }

  // 2. Try Outlook if Google didn't work
  if (!outlookId) {
    try {
      outlookId = await addOutlookEvent(title, start, end, location, notes);
    } catch (err) {
      console.log('[Calendar] Outlook add failed, saving locally:', (err as any)?.message?.slice(0, 100));
    }
  }

  // Always save to local store as well (serves as backup and is used when Outlook is absent)
  const event: CalEvent = {
    id: outlookId || makeId(),
    title,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    ...(location ? { location } : {}),
    ...(notes ? { notes } : {}),
    source: outlookId ? 'outlook' : 'local',
  };
  const existing = loadLocal();
  existing.push(event);
  saveLocal(existing);

  return {
    success: true,
    result: {
      added: event,
      savedToOutlook: !!outlookId,
    },
  };
};

export const deleteCalendarEventHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const id = String(args.id || '').trim();
  if (!id) return { success: false, error: 'id is required' };

  const events = loadLocal();
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return { success: false, error: `No local event with id: ${id}` };

  const [removed] = events.splice(idx, 1);
  saveLocal(events);

  return { success: true, result: { deleted: removed } };
};

// ----- Exports -----

export const calendarToolDefs: ToolDefinition[] = [
  listCalendarEventsDef,
  addCalendarEventDef,
  deleteCalendarEventDef,
];

export const calendarToolHandlers: Record<string, ToolHandler> = {
  list_calendar_events:  listCalendarEventsHandler,
  add_calendar_event:    addCalendarEventHandler,
  delete_calendar_event: deleteCalendarEventHandler,
};
