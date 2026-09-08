import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { ModuleContractError } from '../../shared/modules/contracts';

/** Core-owned preferences, separate from renderer-saveable application settings. */
export class ModulePreferenceStore {
  constructor(private readonly filePath: () => string) {}

  read(): string[] {
    try {
      const value = JSON.parse(readFileSync(this.filePath(), 'utf8'));
      if (value?.schemaVersion !== 1 || !Array.isArray(value.disabledModules) ||
          value.disabledModules.length > 1000 || value.disabledModules.some((id: unknown) =>
            typeof id !== 'string' || !/^[a-z][a-z0-9-]*\.[a-z0-9.-]+$/.test(id) || id.length > 200)) {
        throw new Error('Invalid module preferences');
      }
      return [...new Set<string>(value.disabledModules)];
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw new ModuleContractError('PREFERENCES_UNAVAILABLE', 'HomeBot could not read your module choices. Modules stay off until these settings can be restored.');
    }
  }

  setEnabled(id: string, enabled: boolean): void {
    const disabled = new Set(this.read());
    if (enabled) disabled.delete(id); else disabled.add(id);
    const target = this.filePath();
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, disabledModules: [...disabled] }, null, 2), { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, target);
    } catch {
      throw new ModuleContractError('PREFERENCES_UNAVAILABLE', 'HomeBot could not save your module choice. Check that your settings folder is writable and try again.');
    } finally {
      try { unlinkSync(temporary); } catch { /* Only this operation's temporary file. */ }
    }
  }
}
