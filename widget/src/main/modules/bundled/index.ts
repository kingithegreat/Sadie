/** The reviewed bundled composition root. Core lifecycle has no Studio implementation imports. */
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { join } from 'path';
import { capabilitiesFor } from '../../../../../src/entitlements';
import { TrustedModuleHost } from '../host';
import { ModuleContractError } from '../../../shared/modules/contracts';
import { registerOwnedTool } from '../../tools/registry';
import { getCurrentTier } from '../../licensing';
import { logTelemetryEvent } from '../../utils/logger';
import { bundledStudioModule } from './studio';
import { STUDIO_WORKSPACE_VIEW_ID } from '../../../shared/modules/bundled-views';
import { ModuleController } from '../controller';
import { ModulePreferenceStore } from '../preferences';

const moduleChangeListeners = new Set<() => void>();
export function onBundledModulesChanged(listener: () => void): () => void {
  moduleChangeListeners.add(listener);
  return () => { moduleChangeListeners.delete(listener); };
}

export const bundledModuleHost = new TrustedModuleHost({
  platform: process.platform,
  registerTool: registerOwnedTool,
  supportsView: id => id === STUDIO_WORKSPACE_VIEW_ID,
  invokeTool: async (call, context) => (await import('../../tools')).executeTool(call, context),
  canUseGrants: grants => {
    const allowed = new Set<string>(capabilitiesFor(getCurrentTier()));
    return grants.every(grant => allowed.has(grant));
  },
  recordEvent: event => {
    try { logTelemetryEvent('module_lifecycle', { ...event, eventId: randomUUID(), actorType: 'core', hostApiVersion: '1.0.0' }); } catch { /* A log failure cannot suppress UI state. */ }
    for (const listener of moduleChangeListeners) {
      try { listener(); } catch { /* An observer cannot stop lifecycle transitions. */ }
    }
  },
});

export const bundledModuleController = new ModuleController(bundledModuleHost,
  new ModulePreferenceStore(() => join(app.getPath('userData'), 'config', 'module-preferences.json')));

let initialized = false;

export function initializeBundledModules(): void {
  if (initialized) return;
  initialized = true;
  try {
    bundledModuleHost.install([bundledStudioModule]);
    bundledModuleController.restore();
  } catch (error) {
    // A broken optional module cannot abort Core startup. No retry silently re-enables it.
    const code = error instanceof ModuleContractError ? error.code : 'ACTIVATION_FAILED';
    console.error(`[Modules] Production Studio could not start (${code}).`);
  }
}
