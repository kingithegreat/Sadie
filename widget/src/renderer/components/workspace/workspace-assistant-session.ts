import type { WorkspaceAiTurn } from '../../../shared/workspace-ai-types';
const sessions = new Map<string, WorkspaceAiTurn[]>();
const listeners = new Map<string, Set<(turns: WorkspaceAiTurn[]) => void>>();
const writes = new Map<string, Promise<boolean>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export interface AssistantSessionState { phase: 'loading' | 'ready' | 'error'; error?: string }
const readiness = new Map<string, AssistantSessionState>();
const loads = new Map<string, Promise<boolean>>();
export const ASSISTANT_HISTORY_LOAD_TIMEOUT_MS = 15_000;
const stateListeners = new Map<string, Set<(state: AssistantSessionState) => void>>();
export const assistantSessionState = (root: string): AssistantSessionState => readiness.get(root) || { phase: 'loading' };
export const assistantTurns = (root: string) => sessions.get(root) || [];
const publishState = (root: string, state: AssistantSessionState) => { readiness.set(root, state); stateListeners.get(root)?.forEach(listener => listener(state)); };

/** A failed or pending read never grants permission to replace durable history. */
export function retryAssistantSession(root: string, api: any): Promise<boolean> {
  if (loads.has(root)) return loads.get(root)!;
  if (assistantSessionState(root).phase === 'ready') return Promise.resolve(true);
  if (!api?.workspaceAiSession) {
    if (api?.workspaceAiSaveSession) { publishState(root, { phase: 'error', error: 'Conversation history loading is unavailable. Saved history was retained.' }); return Promise.resolve(false); }
    sessions.set(root, sessions.get(root) || []); publishState(root, { phase: 'ready' }); return Promise.resolve(true);
  }
  publishState(root, { phase: 'loading' });
  let timeout: ReturnType<typeof setTimeout>;
  const pending = Promise.race([Promise.resolve().then(() => api.workspaceAiSession(root)), new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Conversation history loading timed out. Saved history was retained; retry recovery.')), ASSISTANT_HISTORY_LOAD_TIMEOUT_MS);
  })]).then((result: any) => {
    if (!result?.success || !Array.isArray(result.turns)) throw new Error(result?.error || 'Conversation history could not be restored. Saved history was retained.');
    sessions.set(root, result.turns.slice(-100));
    listeners.get(root)?.forEach(listener => listener(assistantTurns(root)));
    publishState(root, { phase: 'ready' });
    return true;
  }).catch((error: unknown) => {
    publishState(root, { phase: 'error', error: error instanceof Error ? error.message : 'Conversation history could not be restored. Saved history was retained.' });
    return false;
  }).finally(() => { clearTimeout(timeout); loads.delete(root); });
  loads.set(root, pending);
  return pending;
}
export function updateAssistantTurns(root: string, update: (turns: WorkspaceAiTurn[]) => WorkspaceAiTurn[], api: any) {
  if (assistantSessionState(root).phase !== 'ready') return false;
  const turns = update(assistantTurns(root)).slice(-100); sessions.set(root, turns);
  listeners.get(root)?.forEach(listener => listener(turns));
  const timer = timers.get(root); if (timer) clearTimeout(timer);
  if (api?.workspaceAiSaveSession) timers.set(root, setTimeout(() => flushAssistantTurns(root, api), 100));
  return true;
}
export function flushAssistantTurns(root: string, api: any) {
  const timer = timers.get(root); if (timer) clearTimeout(timer); timers.delete(root);
  if (assistantSessionState(root).phase !== 'ready') return Promise.resolve(false);
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
export function subscribeAssistantTurns(root: string, listener: (turns: WorkspaceAiTurn[]) => void, api: any, onError?: (message: string) => void, onState?: (state: AssistantSessionState) => void) {
  const group = listeners.get(root) || new Set(); group.add(listener); listeners.set(root, group);
  const states = stateListeners.get(root) || new Set();
  const stateListener = (state: AssistantSessionState) => { onState?.(state); if (state.phase === 'error') onError?.(state.error || 'Conversation history could not be restored.'); };
  states.add(stateListener); stateListeners.set(root, states);
  listener(assistantTurns(root));
  stateListener(assistantSessionState(root));
  if (!readiness.has(root)) void retryAssistantSession(root, api);
  return () => { group.delete(listener); states.delete(stateListener); if (!group.size) listeners.delete(root); if (!states.size) stateListeners.delete(root); };
}
