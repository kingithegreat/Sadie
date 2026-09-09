import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleControlResultV1, ModuleSnapshotV1 } from '../../shared/modules/contracts';

export function useModules() {
  const [modules, setModules] = useState<ModuleSnapshotV1[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const generation = useRef(0);
  const invalidatePending = useCallback(() => { generation.current++; }, []);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await window.electron?.moduleList?.();
      if (request !== generation.current) return;
      if (!result?.ok || !result.modules) throw new Error(result?.error || 'Module controls are unavailable. Restart HomeBot and try again.');
      setModules(result.modules);
      setWarning(result.warning);
      setError(undefined);
    } catch (failure) {
      if (request !== generation.current) return;
      setModules([]);
      setError(failure instanceof Error ? failure.message : 'Could not load modules. Try again.');
    } finally { if (request === generation.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron?.onModulesChanged?.(() => { void refresh(); });
    void refresh();
    return () => { invalidatePending(); unsubscribe?.(); };
  }, [refresh, invalidatePending]);

  const change = useCallback(async (id: string, enabled: boolean): Promise<ModuleControlResultV1> => {
    try {
      const result = await window.electron.moduleSetEnabled(id, enabled);
      await refresh();
      return result;
    } catch {
      await refresh();
      return { ok: false, error: 'Could not change this module. Refresh and try again.' };
    }
  }, [refresh]);

  return { modules, loading, error, warning, refresh, change };
}
