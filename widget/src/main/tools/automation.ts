/**
 * HomeBot Automation Tools
 *
 * Lets the AI create, list, fire, update, and delete Automation Center
 * automations directly from chat, so "set up an automation that does X"
 * can be completed (and test-fired) without opening the Automation Center.
 *
 * Automations are persisted to <userData>/automations.json — the same file
 * the Automation Center IPC handlers use — so anything created here shows
 * up in the UI immediately, and vice versa. The actual execution engine
 * (n8n webhook or local LLM loop) lives in ipc-handlers.ts; it registers
 * itself via registerAutomationRunner() at startup.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

// ---- Persistence (mirrors the Automation Center store in ipc-handlers.ts) ----

interface StoredAutomation {
  id: string;
  name: string;
  description: string;
  instructions: string;
  trigger: 'manual' | 'schedule';
  scheduleMinutes?: number;
  n8nWebhookUrl?: string;
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  lastStatus?: 'success' | 'error';
  createdAt: string;
}

function automationsFilePath(): string {
  try {
    return path.join(app.getPath('userData'), 'automations.json');
  } catch {
    // In test environments app.getPath may not exist
    return path.join(process.env.TEMP || '/tmp', 'homebot-automations.json');
  }
}

function readAutomations(): StoredAutomation[] {
  try {
    const file = automationsFilePath();
    if (!fs.existsSync(file)) return [];
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAutomations(automations: StoredAutomation[]): void {
  fs.writeFileSync(automationsFilePath(), JSON.stringify(automations, null, 2), 'utf8');
}

// ---- Execution engine hook ----

export type AutomationRunner = (
  auto: StoredAutomation
) => Promise<{ success: boolean; result?: string; error?: string }>;

let automationRunner: AutomationRunner | null = null;

/**
 * Called once at startup by ipc-handlers.ts to plug in the real execution
 * engine (n8n webhook → cloud LLM → Ollama agentic loop).
 */
export function registerAutomationRunner(runner: AutomationRunner): void {
  automationRunner = runner;
}

// ---- Lookup helper ----

function findAutomation(
  automations: StoredAutomation[],
  idOrName: string
): { auto?: StoredAutomation; error?: string } {
  const needle = idOrName.trim();
  if (!needle) return { error: 'automation id or name is required' };

  const byId = automations.find(a => a.id === needle);
  if (byId) return { auto: byId };

  const lower = needle.toLowerCase();
  const exact = automations.filter(a => a.name.toLowerCase() === lower);
  if (exact.length === 1) return { auto: exact[0] };

  const partial = automations.filter(a => a.name.toLowerCase().includes(lower));
  if (partial.length === 1) return { auto: partial[0] };
  if (partial.length > 1) {
    return { error: `Multiple automations match "${idOrName}": ${partial.map(a => `"${a.name}" (${a.id})`).join(', ')}. Use the exact id.` };
  }
  return { error: `Automation "${idOrName}" not found. Use list_automations to see what exists.` };
}

function summarize(auto: StoredAutomation) {
  return {
    id: auto.id,
    name: auto.name,
    description: auto.description || undefined,
    trigger: auto.trigger,
    schedule_minutes: auto.trigger === 'schedule' ? auto.scheduleMinutes : undefined,
    enabled: auto.enabled,
    uses_n8n: !!auto.n8nWebhookUrl,
    last_run: auto.lastRun,
    last_status: auto.lastStatus,
  };
}

async function fireAutomation(auto: StoredAutomation): Promise<ToolResult> {
  if (!automationRunner) {
    return {
      success: false,
      error: 'Automation execution engine is not available in this context. The automation was saved — it can be fired from the Automation Center.',
    };
  }
  const outcome = await automationRunner(auto);
  // Persist run status so the Automation Center shows the same result
  try {
    const automations = readAutomations();
    const stored = automations.find(a => a.id === auto.id);
    if (stored) {
      stored.lastRun = new Date().toISOString();
      stored.lastResult = outcome.result || outcome.error || 'Done';
      stored.lastStatus = outcome.success ? 'success' : 'error';
      writeAutomations(automations);
    }
  } catch (e) {
    console.error('[Automation Tools] Failed to persist run status:', e);
  }
  if (!outcome.success) {
    return { success: false, error: outcome.error || 'Automation run failed' };
  }
  return { success: true, result: { id: auto.id, name: auto.name, output: outcome.result } };
}

// ============= TOOL DEFINITIONS =============

export const createAutomationDef: ToolDefinition = {
  name: 'create_automation',
  description:
    'Create a reusable automation in the Automation Center. The instructions are a plain-English prompt ' +
    'HomeBot executes each time the automation runs (using its tools: web search, files, code, etc.). ' +
    'Set run_now=true to fire it immediately after creating, completing the setup in one step. ' +
    'Scheduled automations run automatically at the given interval.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short name for the automation, e.g. "Morning News Summary"',
      },
      instructions: {
        type: 'string',
        description: 'Plain-English prompt describing exactly what the automation should do when it runs',
      },
      description: {
        type: 'string',
        description: 'Optional one-line description of what this automation does',
      },
      trigger: {
        type: 'string',
        description: 'How the automation runs: "manual" (on demand, default) or "schedule" (repeats automatically)',
        enum: ['manual', 'schedule'],
      },
      schedule_minutes: {
        type: 'number',
        description: 'For trigger="schedule": interval in minutes between runs (default 60, e.g. 1440 for daily)',
      },
      run_now: {
        type: 'boolean',
        description: 'Fire the automation immediately after creating it, so the result confirms the setup works (default false)',
      },
    },
    required: ['name', 'instructions'],
  },
};

export const listAutomationsDef: ToolDefinition = {
  name: 'list_automations',
  description:
    'List all saved Automation Center automations with their ids, triggers, schedules, and last run status.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const runAutomationDef: ToolDefinition = {
  name: 'run_automation',
  description:
    'Fire a saved automation right now by id or name and return its output. ' +
    'Works for both manual and scheduled automations.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      automation: {
        type: 'string',
        description: 'The automation id (from list_automations/create_automation) or its name',
      },
    },
    required: ['automation'],
  },
};

export const updateAutomationDef: ToolDefinition = {
  name: 'update_automation',
  description:
    'Update a saved automation: enable/disable it, rename it, or change its instructions, trigger, or schedule.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      automation: {
        type: 'string',
        description: 'The automation id or name to update',
      },
      enabled: {
        type: 'boolean',
        description: 'Enable (true) or disable (false) the automation',
      },
      new_name: {
        type: 'string',
        description: 'New name for the automation',
      },
      description: {
        type: 'string',
        description: 'New description',
      },
      instructions: {
        type: 'string',
        description: 'New plain-English instructions to execute on each run',
      },
      trigger: {
        type: 'string',
        description: 'Change how it runs: "manual" or "schedule"',
        enum: ['manual', 'schedule'],
      },
      schedule_minutes: {
        type: 'number',
        description: 'New interval in minutes (for trigger="schedule")',
      },
    },
    required: ['automation'],
  },
};

export const deleteAutomationDef: ToolDefinition = {
  name: 'delete_automation',
  description: 'Permanently delete a saved automation by id or name.',
  category: 'utility',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      automation: {
        type: 'string',
        description: 'The automation id or name to delete',
      },
    },
    required: ['automation'],
  },
};

// ============= TOOL HANDLERS =============

export const createAutomationHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const name = String(args.name || '').trim();
    const instructions = String(args.instructions || '').trim();
    if (!name) return { success: false, error: 'name is required' };
    if (!instructions) return { success: false, error: 'instructions is required' };

    const trigger: 'manual' | 'schedule' = args.trigger === 'schedule' ? 'schedule' : 'manual';
    let scheduleMinutes: number | undefined;
    if (trigger === 'schedule') {
      scheduleMinutes = Number(args.schedule_minutes) || 60;
      if (scheduleMinutes < 1) return { success: false, error: 'schedule_minutes must be at least 1' };
    }

    const automations = readAutomations();
    const dup = automations.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      return { success: false, error: `An automation named "${dup.name}" already exists (${dup.id}). Use update_automation to change it, or pick another name.` };
    }

    const automation: StoredAutomation = {
      id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: String(args.description || '').trim(),
      instructions,
      trigger,
      scheduleMinutes,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    automations.push(automation);
    writeAutomations(automations);

    const note = trigger === 'schedule'
      ? `Scheduled to run every ${scheduleMinutes} minutes; the schedule arms automatically within a minute.`
      : 'Run it any time with run_automation or the ▶ button in the Automation Center.';

    if (args.run_now) {
      const runResult = await fireAutomation(automation);
      return {
        success: true,
        result: {
          created: summarize(automation),
          note,
          first_run: runResult.success
            ? { status: 'success', output: (runResult.result as any)?.output }
            : { status: 'error', error: runResult.error },
        },
      };
    }

    return { success: true, result: { created: summarize(automation), note } };
  } catch (err: any) {
    return { success: false, error: `create_automation failed: ${err.message}` };
  }
};

export const listAutomationsHandler: ToolHandler = async (): Promise<ToolResult> => {
  const automations = readAutomations();
  return {
    success: true,
    result: { count: automations.length, automations: automations.map(summarize) },
  };
};

export const runAutomationHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const { auto, error } = findAutomation(readAutomations(), String(args.automation || ''));
    if (!auto) return { success: false, error };
    return await fireAutomation(auto);
  } catch (err: any) {
    return { success: false, error: `run_automation failed: ${err.message}` };
  }
};

export const updateAutomationHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const automations = readAutomations();
    const { auto, error } = findAutomation(automations, String(args.automation || ''));
    if (!auto) return { success: false, error };

    if (args.enabled !== undefined) auto.enabled = !!args.enabled;
    if (args.new_name !== undefined && String(args.new_name).trim()) auto.name = String(args.new_name).trim();
    if (args.description !== undefined) auto.description = String(args.description);
    if (args.instructions !== undefined && String(args.instructions).trim()) auto.instructions = String(args.instructions).trim();
    if (args.trigger !== undefined) auto.trigger = args.trigger === 'schedule' ? 'schedule' : 'manual';
    if (args.schedule_minutes !== undefined) {
      const mins = Number(args.schedule_minutes);
      if (!mins || mins < 1) return { success: false, error: 'schedule_minutes must be at least 1' };
      auto.scheduleMinutes = mins;
    }
    if (auto.trigger === 'schedule' && !auto.scheduleMinutes) auto.scheduleMinutes = 60;

    writeAutomations(automations);
    return { success: true, result: { updated: summarize(auto) } };
  } catch (err: any) {
    return { success: false, error: `update_automation failed: ${err.message}` };
  }
};

export const deleteAutomationHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const automations = readAutomations();
    const { auto, error } = findAutomation(automations, String(args.automation || ''));
    if (!auto) return { success: false, error };
    writeAutomations(automations.filter(a => a.id !== auto.id));
    return { success: true, result: { deleted: { id: auto.id, name: auto.name } } };
  } catch (err: any) {
    return { success: false, error: `delete_automation failed: ${err.message}` };
  }
};

// ============= EXPORTS =============

export const automationToolDefs: ToolDefinition[] = [
  createAutomationDef,
  listAutomationsDef,
  runAutomationDef,
  updateAutomationDef,
  deleteAutomationDef,
];

export const automationToolHandlers: Record<string, ToolHandler> = {
  create_automation: createAutomationHandler,
  list_automations: listAutomationsHandler,
  run_automation: runAutomationHandler,
  update_automation: updateAutomationHandler,
  delete_automation: deleteAutomationHandler,
};
