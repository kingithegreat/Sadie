import { ModuleContractError } from '../../shared/modules/contracts';
import { RegisteredTool, ToolDefinition, ToolHandler } from './types';
import { canonicalWorkspacePath, currentWorkspace, withinRoot, workspaceToolError } from '../workspace-context';
import * as path from 'path';

function scopedHandler(name: string, handler: ToolHandler): ToolHandler {
  return async (args, context) => {
    const error = workspaceToolError(name);
    if (error) return { success: false, error };
    const workspace = currentWorkspace();
    if (workspace && ['grep_code', 'project_tree', 'analyze_file', 'git_status', 'git_diff', 'git_log', 'git_branches'].includes(name)) {
      const key = name.startsWith('git_') ? 'repo_path' : name === 'analyze_file' ? 'file_path' : 'directory';
      const target = args[key] ? path.resolve(workspace.root, String(args[key])) : workspace.root;
      try {
        const canonical = canonicalWorkspacePath(target);
        if (!withinRoot(workspace.root, canonical)) return { success: false, error: 'This tool path is outside the active IDE project.' };
        return handler({ ...args, [key]: canonical }, context);
      } catch (failure) { return { success: false, error: (failure as Error).message }; }
    }
    return handler(args, context);
  };
}

/** The existing desktop tool Map, extracted so the trusted host can own entries. */
const entries = new Map<string, RegisteredTool>();

export interface ModuleToolOwner {
  moduleId: string;
  capabilityId: string;
  generation: number;
}

const owners = new Map<string, ModuleToolOwner>();

export function registerTool(name: string, definition: ToolDefinition, handler: ToolHandler): void {
  if (owners.has(name)) {
    throw new ModuleContractError('DUPLICATE_CONTRIBUTION', `Tool ${name} belongs to ${owners.get(name)!.moduleId}.`);
  }
  entries.set(name, { definition, handler: scopedHandler(name, handler) });
  console.log(`[HomeBot Tools] Registered tool: ${name}`);
}

export function registerOwnedTool(owner: ModuleToolOwner, definition: ToolDefinition, handler: ToolHandler): () => void {
  const name = definition.name;
  if (entries.has(name)) {
    throw new ModuleContractError('DUPLICATE_CONTRIBUTION', `Tool ${name} is already registered by ${owners.get(name)?.moduleId || 'Core'}.`);
  }
  const entry = { definition, handler: scopedHandler(name, handler) };
  const identity = Object.freeze({ ...owner });
  entries.set(name, entry);
  owners.set(name, identity);
  // An old disposer must never remove a later registration with the same public name.
  return () => {
    if (entries.get(name) === entry && owners.get(name) === identity) {
      entries.delete(name);
      owners.delete(name);
    }
  };
}

export function getToolOwner(name: string): ModuleToolOwner | undefined { return owners.get(name); }
export function getAllToolDefinitions(): ToolDefinition[] { return [...entries.values()].map(entry => entry.definition); }
export function hasTool(name: string): boolean { return entries.has(name); }
export function getTool(name: string): RegisteredTool | undefined { return entries.get(name); }
