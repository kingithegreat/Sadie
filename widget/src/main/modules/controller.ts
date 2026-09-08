import { ModuleContractError, type ModuleControlResultV1 } from '../../shared/modules/contracts';
import { TrustedModuleHost } from './host';
import { ModulePreferenceStore } from './preferences';

export class ModuleController {
  private readonly changing = new Set<string>();
  private warning?: string;
  constructor(private readonly host: TrustedModuleHost, private readonly preferences: ModulePreferenceStore) {}

  restore(): void {
    // Read the entire file before enabling anything: corrupt preferences cannot
    // turn a previously disabled module back on during startup.
    let disabled: string[];
    try { disabled = this.preferences.read(); }
    catch (error) { this.warning = (error as Error).message; return; }
    const installed = new Map(this.host.list().map(item => [item.manifest.id, item]));
    const visited = new Set<string>();
    const enable = (id: string): void => {
      const item = installed.get(id);
      if (!item || visited.has(id) || disabled.includes(id)) return;
      visited.add(id);
      // Installation order is not dependency order. A saved disabled dependency
      // still wins; the host then rejects its dependent without overriding it.
      for (const dependency of item.manifest.dependencies) enable(dependency.id);
      try { this.host.enable(id); }
      catch { /* The module's state/access reports why it could not start. */ }
    };
    for (const id of installed.keys()) enable(id);
  }

  list(): ModuleControlResultV1 {
    return { ok: true, modules: this.host.list(), ...(this.warning ? { warning: this.warning } : {}) };
  }

  async setEnabled(id: string, enabled: boolean): Promise<ModuleControlResultV1> {
    if (!this.host.list().some(item => item.manifest.id === id)) return { ok: false, code: 'MODULE_UNAVAILABLE', error: 'That module is not installed.' };
    if (this.changing.has(id)) return { ok: false, code: 'MODULE_BUSY', error: 'This module is finishing a change. Wait for it to finish.' };
    this.changing.add(id);
    try {
      const wasEnabled = !this.preferences.read().includes(id);
      this.preferences.setEnabled(id, enabled);
      try {
        if (enabled) this.host.enable(id);
        else await this.host.disable(id);
      } catch (error) {
        // Merge the rollback with the latest file, retaining other modules' choices.
        this.preferences.setEnabled(id, wasEnabled);
        throw error;
      }
      this.warning = undefined;
      return this.list();
    } catch (error) {
      return error instanceof ModuleContractError
        ? { ok: false, code: error.code, error: error.message }
        : { ok: false, code: 'MODULE_CHANGE_FAILED', error: 'HomeBot could not change this module. Refresh and try again.' };
    } finally { this.changing.delete(id); }
  }
}
