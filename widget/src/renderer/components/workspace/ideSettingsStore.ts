/** Renderer cache of the validated user settings.json / keybindings.json (owned by main). */
import type { IdeSettingsSnapshot } from '../../../shared/ide-settings';

let snapshot: IdeSettingsSnapshot | null = null;
const listeners = new Set<(value: IdeSettingsSnapshot | null) => void>();
export function getIdeSettingsSnapshot(): IdeSettingsSnapshot | null { return snapshot; }
export function setIdeSettingsSnapshot(value: IdeSettingsSnapshot | null): void { snapshot = value; for (const listener of [...listeners]) listener(value); }
export function subscribeIdeSettings(listener: (value: IdeSettingsSnapshot | null) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function loadIdeSettings(): Promise<IdeSettingsSnapshot | null> {
  const api = (window as any).electron;
  if (!api?.workspaceIdeSettings) return null;
  try { const result = await api.workspaceIdeSettings({ action: 'get' }); if (result?.success) setIdeSettingsSnapshot(result.snapshot); return result?.snapshot ?? null; }
  catch { return null; }
}
