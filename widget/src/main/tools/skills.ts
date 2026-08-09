/**
 * skills.ts (tool) — the single tool through which every skill is reached.
 *
 * One tool, not one per skill. tools/index.ts caps small models at
 * SMALL_MODEL_MAX_TOOLS (12), so registering a tool per skill would push out
 * real tools the moment a user added a handful. The catalogue lives in the
 * system prompt (cheap, one line each) and the body is fetched on demand here.
 */

import { ToolDefinition, ToolResult } from './types';
import { getSkill, loadSkills } from '../skills';

export const useSkillDef: ToolDefinition = {
  name: 'use_skill',
  description:
    'Load a saved skill: a step-by-step recipe for a task. Call this FIRST when a skill in the ' +
    'Skills list matches the request, then follow the steps it returns. Returns the instructions, ' +
    'not a result — you still carry them out using your other tools.',
  category: 'utility',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Exact skill name from the Skills list, e.g. "research-a-question"',
      },
    },
    required: ['name'],
  },
};

export const listSkillsDef: ToolDefinition = {
  name: 'list_skills',
  description: 'List the saved skills available, with what each is for.',
  category: 'utility',
  parameters: { type: 'object', properties: {}, required: [] },
};

export const skillToolDefs: ToolDefinition[] = [useSkillDef, listSkillsDef];

export const skillToolHandlers: Record<string, (args: any) => Promise<ToolResult>> = {
  use_skill: async (args: { name?: string }): Promise<ToolResult> => {
    const requested = (args?.name || '').trim();
    if (!requested) return { success: false, error: 'name is required' };

    const skill = getSkill(requested);
    if (!skill) {
      const available = loadSkills().map(s => s.name);
      return {
        success: false,
        // Name what does exist. A bare "not found" invites a small model to
        // retry the same wrong name, or to invent a plan instead.
        error: available.length
          ? `No skill called "${requested}". Available: ${available.join(', ')}`
          : `No skills are installed yet.`,
      };
    }

    return {
      success: true,
      result: {
        skill: skill.name,
        instructions: skill.body,
        // Surfaced so the model knows which tools the skill expects to use.
        suggested_tools: skill.tools ?? null,
      },
    };
  },

  list_skills: async (): Promise<ToolResult> => {
    const all = loadSkills();
    return {
      success: true,
      result: all.length
        ? all.map(s => ({ name: s.name, description: s.description, when_to_use: s.whenToUse ?? null }))
        : 'No skills installed.',
    };
  },
};
