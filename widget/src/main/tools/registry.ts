import { ModuleContractError } from '../../shared/modules/contracts';
import { RegisteredTool, ToolDefinition, ToolHandler } from './types';
import { canonicalWorkspacePath, currentWorkspace, withinRoot, workspaceToolError } from '../workspace-context';
import * as path from 'path';
import { checkedTrustedWorkspacePath } from '../workspace-trust';
import { getMainWindow } from '../window-manager';

function scopedHandler(name: string, handler: ToolHandler): ToolHandler {
  return async (args, context) => {
    const authority = currentWorkspace();
    const finish = (result: Awaited<ReturnType<ToolHandler>>) => {
      if (authority) {
        try {
          const window = getMainWindow();
          if (window && !window.isDestroyed() && window.webContents.id === authority.senderId) window.webContents.send('homebot:assistant-tool-activity', {
            tool: name, allowed: !!result.success, error: result.success ? undefined : result.error,
            root: authority.displayRoot || authority.root, streamId: authority.streamId,
          });
        } catch { /* activity never changes tool outcomes */ }
      }
      return result;
    };
    const error = workspaceToolError(name);
    if (error) return finish({ success: false, error });
    const workspace = currentWorkspace();
    if (workspace && ['grep_code', 'project_tree', 'analyze_file', 'git_status', 'git_diff', 'git_log', 'git_branches'].includes(name)) {
      const key = name.startsWith('git_') ? 'repo_path' : name === 'analyze_file' ? 'file_path' : 'directory';
      const target = args[key] ? path.resolve(workspace.root, String(args[key])) : workspace.root;
      try {
        const canonical = canonicalWorkspacePath(target);
        if (!withinRoot(workspace.root, canonical)) return finish({ success: false, error: 'This tool path is outside the active IDE project.' });
        checkedTrustedWorkspacePath(workspace.root, canonical);
        return finish(await handler({ ...args, [key]: canonical }, context));
      } catch (failure) { return finish({ success: false, error: (failure as Error).message }); }
    }
    try { return finish(await handler(args, context)); }
    catch (failure) { finish({ success: false, error: (failure as Error).message }); throw failure; }
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

export function registerTool(name: string, definition: ToolDefinition, handler: ToolHandler): () => void {
  if (owners.has(name)) {
    throw new ModuleContractError('DUPLICATE_CONTRIBUTION', `Tool ${name} belongs to ${owners.get(name)!.moduleId}.`);
  }
  const entry = { definition, handler: scopedHandler(name, handler) };
  entries.set(name, entry);
  console.log(`[HomeBot Tools] Registered tool: ${name}`);
  // Retained transports dispose their own registration, never a newer server
  // or module contribution that happens to use the same public tool name.
  return () => { if (entries.get(name) === entry) entries.delete(name); };
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
export function getAllToolDefinitions(): ToolDefinition[] {
  // IDE file comparison needs actual opened-object containment. Do not offer
  // a path-only substitute on platforms without a supported handle query.
  const secureDiffAvailable = !currentWorkspace() || process.platform === 'win32' || process.platform === 'linux';
  return [...entries.values()].map(entry => entry.definition).filter(definition => secureDiffAvailable || definition.name !== 'diff_files');
}
export function hasTool(name: string): boolean { return entries.has(name); }
export function getTool(name: string): RegisteredTool | undefined { return entries.get(name); }
