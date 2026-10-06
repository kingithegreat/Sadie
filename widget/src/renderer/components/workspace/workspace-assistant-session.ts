import type { WorkspaceAiTurn } from '../../../shared/workspace-ai-types';
const sessions = new Map<string, WorkspaceAiTurn[]>();
const listeners = new Map<string, Set<(turns: WorkspaceAiTurn[]) => void>>();
const writes = new Map<string, Promise<boolean>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export const assistantTurns = (root: string) => sessions.get(root) || [];
export function updateAssistantTurns(root: string, update: (turns: WorkspaceAiTurn[]) => WorkspaceAiTurn[], api: any) {
  const turns = update(assistantTurns(root)).slice(-100); sessions.set(root, turns);
  listeners.get(root)?.forEach(listener => listener(turns));
  const timer = timers.get(root); if (timer) clearTimeout(timer);
  if (api?.workspaceAiSaveSession) timers.set(root, setTimeout(() => flushAssistantTurns(root, api), 100));
}
export function flushAssistantTurns(root: string, api: any) {
  const timer = timers.get(root); if (timer) clearTimeout(timer); timers.delete(root);
  const turns = assistantTurns(root);
  if (api?.workspaceAiSaveSession) {
    const queued = (writes.get(root) || Promise.resolve()).then(async () => {
      const result = await api.workspaceAiSaveSession(root, turns);
      if (result && !result.success) throw new Error(result.error || 'Conversation could not be saved.');
      return true;
    }).catch(error => { listeners.get(root)?.forEach(listener => listener([...assistantTurns(root), { id: 'storage-error', role: 'assistant', error: true, text: `History recovery unavailable: ${error.message}` }])); return false; });
    writes.set(root, queued);
    return queued;
  }
  return Promise.resolve(false);
}
export function subscribeAssistantTurns(root: string, listener: (turns: WorkspaceAiTurn[]) => void, api: any, onError?: (message: string) => void) {
  const group = listeners.get(root) || new Set(); group.add(listener); listeners.set(root, group);
  listener(assistantTurns(root));
  if (!sessions.has(root) && api?.workspaceAiSession) {
    api.workspaceAiSession(root).then((result: any) => {
      if (result && !result.success) { onError?.(result.error || 'Conversation history could not be restored.'); return; }
      if (!sessions.has(root) && result?.success) { sessions.set(root, result.turns || []); listeners.get(root)?.forEach(l => l(assistantTurns(root))); }
    }).catch((error: Error) => onError?.(error.message));
  }
  return () => { group.delete(listener); if (!group.size) listeners.delete(root); };
}
