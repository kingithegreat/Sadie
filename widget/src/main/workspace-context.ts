/** Request-local IDE authority. Prompt text and Settings never establish it. */
import { AsyncLocalStorage } from 'async_hooks';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { canonicalTrustedWorkspacePath, validateTrustedWorkspaceRoot } from './workspace-trust';
import { getMainWindow } from './window-manager';

export interface WorkspaceAuthority { root: string; displayRoot?: string; senderId: number; streamId: string; approved: boolean; mode?: 'inline-draft'; cancelled?: boolean }
const scope = new AsyncLocalStorage<WorkspaceAuthority>();
const plans = new Map<string, { root: string; senderId: number; text: string; expires: number; approved: boolean }>();
const TTL = 30 * 60_000;
const liveStreams = new Map<string, number>();
const streamScopes = new Map<string, WorkspaceAuthority>();
const bridgeTokens = new Map<string, { authority: WorkspaceAuthority; expires: number }>();
export function createWorkspaceBridgeToken(): string | undefined {
  const authority = currentWorkspace(); if (!authority) return;
  for (const [token, value] of bridgeTokens) if (value.expires < Date.now() || value.authority.cancelled) bridgeTokens.delete(token);
  if (authority.cancelled || bridgeTokens.size >= 100) throw new Error('This workspace bridge session is unavailable.');
  const token = randomUUID().replace(/-/g, ''); bridgeTokens.set(token, { authority, expires: Date.now() + TTL }); return token;
}
export function isWorkspaceBridgeToken(token: string): boolean {
  const binding = bridgeTokens.get(token); return !!binding && !binding.authority.cancelled && binding.expires > Date.now();
}
export function runWorkspaceBridgeToken<T>(token: string, run: () => T): T {
  const binding = bridgeTokens.get(token);
  if (!binding || binding.authority.cancelled || binding.expires <= Date.now()) throw new Error('The IDE bridge session expired or was stopped.');
  return scope.run(binding.authority, run);
}
export const currentWorkspace = () => scope.getStore();
export function withinRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
/** Canonicalize even missing children, rejecting junction/symlink escapes. */
export function canonicalWorkspacePath(target: string): string {
  return canonicalTrustedWorkspacePath(target);
}
export function validateWorkspaceRoot(input: unknown): string {
  return validateTrustedWorkspaceRoot(input);
}
export function prepareWorkspacePlan(rootInput: unknown, text: unknown, senderId: number) {
  const root = validateWorkspaceRoot(rootInput);
  if (typeof text !== 'string' || !text.trim() || text.length > 20_000) throw new Error('Provide a plan of up to 20,000 characters.');
  const now = Date.now();
  for (const [id, plan] of plans) if (plan.expires <= now) plans.delete(id);
  if (plans.size >= 100) throw new Error('Too many pending plans. Wait for older plans to expire.');
  const id = randomUUID();
  const expires = now + TTL;
  plans.set(id, { root, text: text.trim(), senderId, expires, approved: false });
  return { id, root, text: text.trim(), expires };
}
export function approveWorkspacePlan(rootInput: unknown, id: unknown, senderId: number) {
  const root = validateWorkspaceRoot(rootInput), plan = plans.get(String(id));
  const now = Date.now();
  if (!plan || plan.root !== root || plan.senderId !== senderId || plan.expires <= now) throw new Error('This plan expired or belongs to another project/window. Prepare it again.');
  plan.approved = true; plan.expires = now + TTL;
  return { id: String(id), root, text: plan.text, expires: plan.expires };
}
export function runWorkspaceRequest<T>(request: any, senderId: number, run: () => T): T {
  if (!request?.workspace) {
    if (String(request?.conversation_id || '').startsWith('workspace:')) throw new Error('This IDE request has no authoritative project folder.');
    return run();
  }
  const root = validateWorkspaceRoot(request.workspace.root);
  if (typeof request.streamId !== 'string' || !request.streamId) throw new Error('An IDE stream identifier is required.');
  const mode = request.workspace.mode;
  if (mode !== undefined && mode !== 'inline-draft') throw new Error('Unknown IDE request mode.');
  if (mode === 'inline-draft' && request.workspace.planId) throw new Error('Inline drafts cannot use plan approval or tool authority.');
  const plan = plans.get(String(request.workspace.planId || ''));
  const approved = !!(plan && plan.approved && plan.root === root && plan.senderId === senderId && plan.expires > Date.now());
  if (request.workspace.planId && !approved) throw new Error('Approve a current plan for this project before continuing.');
  // Server-generated instruction cannot substitute for the separate approval record.
  const instruction = mode === 'inline-draft'
    ? `You are producing an inline code draft for the IDE project ${root}. Return only the requested replacement source code, without Markdown fences or planning prose. This is a draft for human preview, not a file edit. No tools are available or permitted; do not call tools, write files, or run commands. The editor applies changes only after human acceptance and byte-conflict validation.`
    : `You are in the IDE project ${root}. Relative file paths resolve here. ${approved ? `The user approved this plan: ${plan!.text}. Propose file changes for review; do not execute shell commands.` : 'Read-only planning. Explain a concrete plan first; no edits until the user separately approves a plan.'}`;
  request.conversationPrompt = [request.conversationPrompt, instruction].filter(Boolean).join('\n\n');
  const authority: WorkspaceAuthority = { root, displayRoot: request.workspace.root, senderId, streamId: request.streamId, approved, ...(mode ? { mode } : {}) };
  if (liveStreams.has(request.streamId)) streamScopes.set(request.streamId, authority);
  return scope.run(authority, run);
}
export function releaseWorkspaceStream(id: string, senderId: number): boolean {
  const owner = liveStreams.get(id);
  if (owner !== undefined && owner !== senderId) return false;
  const authority = streamScopes.get(id); if (authority) authority.cancelled = true;
  liveStreams.delete(id); streamScopes.delete(id); return true;
}
export function workspaceStreamHandler(handler: (event: any, request: any) => Promise<void>) {
  return async (event: any, request: any) => {
    let reserved = false;
    try {
      if (request?.workspace) {
        const window = getMainWindow();
        if (!window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) throw new Error('Open the assistant in the HomeBot IDE.');
      }
      if (request && typeof request === 'object') {
        request.streamId ||= `stream-${randomUUID()}`;
        if (typeof request.streamId !== 'string' || request.streamId.length > 160) throw new Error('Invalid stream identifier.');
        if (liveStreams.has(request.streamId)) throw new Error('This stream identifier is already running.');
        liveStreams.set(request.streamId, event.sender.id); reserved = true;
      }
      const release = () => { if (reserved) { releaseWorkspaceStream(request.streamId, event.sender.id); reserved = false; } };
      const sender = new Proxy(event.sender, {
        get(target, key) {
          if (key === 'send') return (channel: string, ...args: any[]) => {
            if ((channel === 'homebot:stream-end' || channel === 'homebot:stream-error') && args[0]?.streamId === request?.streamId) release();
            return target.send(channel, ...args);
          };
          const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const scopedEvent = new Proxy(event, { get(target, key) { return key === 'sender' ? sender : Reflect.get(target, key, target); } });
      await runWorkspaceRequest(request, event.sender.id, () => handler(scopedEvent, request));
    }
    catch (error) {
      if (reserved) releaseWorkspaceStream(request.streamId, event.sender.id);
      event.sender.send('homebot:stream-error', { streamId: request?.streamId, error: true, message: (error as Error).message });
      event.sender.send('homebot:stream-end', { streamId: request?.streamId });
    }
  };
}
const READ_TOOLS = new Set(['list_directory', 'read_file', 'get_file_info', 'search_files', 'grep_code', 'project_tree', 'analyze_file', 'search_code', 'codebase_search', 'git_status', 'git_diff', 'git_log', 'git_branches', 'web_search', 'fetch_url', 'rag_query', 'memory_search', 'memory_recall', 'recall_memory']);
/** The registry calls this for single, batch, and bridge tool dispatch. */
export function workspaceToolError(name: string): string | undefined {
  const context = currentWorkspace();
  if (!context) return;
  if (context.cancelled) return 'This IDE request was stopped. No further tools can run.';
  if (context.mode === 'inline-draft') return 'Inline drafts cannot call tools. Review the generated code in the editor; no tool was run.';
  try { validateWorkspaceRoot(context.root); } catch { return 'This IDE project is no longer trusted or available. No further tools can run.'; }
  if (READ_TOOLS.has(name)) return;
  if (name === 'write_file' || name === 'edit_file') return context.approved ? undefined : 'Approve a plan in the IDE assistant before proposing edits. No file was changed.';
  if (name.startsWith('mcp_')) return context.approved ? undefined : 'Approve a plan before calling an external tool from the IDE.';
  return 'This tool cannot run from the IDE assistant because its writes cannot be reviewed here. Use the human terminal or HomeBot chat with its own confirmation.';
}
