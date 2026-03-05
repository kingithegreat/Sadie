/**
 * SADIE Planning Agent Tool
 *
 * Helps break complex goals into ordered, actionable steps.
 * The LLM generates the plan and calls plan_task to persist it;
 * get_plans retrieves previously saved plans for reference.
 *
 * Plans are saved to $USERPROFILE/sadie-plans.json (local, zero config).
 *
 * Tools:
 *   plan_task  — save a step-by-step plan for a goal
 *   get_plans  — list recently saved plans
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ToolDefinition, ToolHandler, ToolResult } from './types';

const PLANS_FILE = path.join(os.homedir(), 'sadie-plans.json');

// ----- Persistence helpers -----

interface SavedPlan {
  id: string;
  goal: string;
  steps: string[];
  createdAt: string;
  status: 'pending' | 'in-progress' | 'done';
}

function loadPlans(): SavedPlan[] {
  try {
    if (!fs.existsSync(PLANS_FILE)) return [];
    return JSON.parse(fs.readFileSync(PLANS_FILE, 'utf8')) as SavedPlan[];
  } catch {
    return [];
  }
}

function savePlans(plans: SavedPlan[]): void {
  fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2), 'utf8');
}

function generateId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ----- Tool definitions -----

export const planTaskDef: ToolDefinition = {
  name: 'plan_task',
  description:
    'Break a complex goal into a numbered sequence of actionable steps and save the plan locally. ' +
    'Call this when the user wants to accomplish something multi-step, or asks to "make a plan", ' +
    '"help me plan", or "what steps do I need to" do something. ' +
    'Provide the goal and a list of clear, concrete steps.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'A concise description of the overall goal or objective.',
      },
      steps: {
        type: 'array',
        description:
          'Ordered list of concrete steps to accomplish the goal. ' +
          'Each step should be a clear, actionable instruction.',
        items: { type: 'string' },
      },
      planId: {
        type: 'string',
        description:
          'Optional: ID of an existing plan to update. If omitted a new plan is created.',
      },
    },
    required: ['goal', 'steps'],
  },
};

export const getPlansDefn: ToolDefinition = {
  name: 'get_plans',
  description:
    'Retrieve recently saved plans. Use this when the user asks "what plans do I have", ' +
    '"show my plans", or wants to check the status of a previous plan.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of plans to return (default: 5, max: 20)',
        default: 5,
      },
    },
    required: [],
  },
};

// ----- Handlers -----

export const planTaskHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const goal = String(args.goal ?? '').trim();
  if (!goal) {
    return { success: false, error: 'plan_task: goal is required' };
  }

  const rawSteps = args.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return { success: false, error: 'plan_task: steps array is required and must be non-empty' };
  }

  const steps: string[] = rawSteps
    .map((s: any) => String(s).trim())
    .filter(s => s.length > 0)
    .slice(0, 50); // cap at 50 steps

  const plans = loadPlans();

  let plan: SavedPlan;
  const existingId = args.planId ? String(args.planId) : undefined;
  const existingIdx = existingId ? plans.findIndex(p => p.id === existingId) : -1;

  if (existingIdx >= 0) {
    // Update existing plan
    plans[existingIdx].goal = goal;
    plans[existingIdx].steps = steps;
    plan = plans[existingIdx];
  } else {
    // Create new plan
    plan = {
      id: generateId(),
      goal,
      steps,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    plans.unshift(plan); // newest first
    if (plans.length > 100) plans.splice(100); // keep at most 100 plans
  }

  try {
    savePlans(plans);
  } catch (err) {
    // Non-fatal — return the plan even if we can't persist it
    console.warn('[plan_task] Could not persist plan:', err);
  }

  return {
    success: true,
    result: {
      planId: plan.id,
      goal: plan.goal,
      steps: plan.steps,
      stepCount: plan.steps.length,
      createdAt: plan.createdAt,
      saved: true,
    },
  };
};

export const getPlansHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const limit = Math.min(Math.max(1, Number(args.limit) || 5), 20);

  const plans = loadPlans().slice(0, limit);

  return {
    success: true,
    result: {
      count: plans.length,
      plans: plans.map(p => ({
        id: p.id,
        goal: p.goal,
        stepCount: p.steps.length,
        createdAt: p.createdAt,
        status: p.status,
        steps: p.steps,
      })),
    },
  };
};

// ----- Exports -----

export const planningToolDefs: ToolDefinition[] = [planTaskDef, getPlansDefn];

export const planningToolHandlers: Record<string, ToolHandler> = {
  plan_task: planTaskHandler,
  get_plans: getPlansHandler,
};
