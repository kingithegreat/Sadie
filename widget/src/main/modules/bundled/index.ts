/** The reviewed bundled composition root. Core lifecycle has no Studio implementation imports. */
import { randomUUID } from 'crypto';
import { capabilitiesFor } from '../../../../../src/entitlements';
import { TrustedModuleHost } from '../host';
import { ModuleContractError } from '../../../shared/modules/contracts';
import { registerOwnedTool } from '../../tools/registry';
import { getCurrentTier } from '../../licensing';
import { logTelemetryEvent } from '../../utils/logger';
import { bundledStudioModule, STUDIO_MODULE_ID } from './studio';

export const bundledModuleHost = new TrustedModuleHost({
  platform: process.platform,
  registerTool: registerOwnedTool,
  invokeTool: async (call, context) => (await import('../../tools')).executeTool(call, context),
  canUseGrants: grants => {
    const allowed = new Set<string>(capabilitiesFor(getCurrentTier()));
    return grants.every(grant => allowed.has(grant));
  },
  recordEvent: event => logTelemetryEvent('module_lifecycle', { ...event, eventId: randomUUID(), actorType: 'core', hostApiVersion: '1.0.0' }),
});

let initialized = false;

export function initializeBundledModules(): void {
  if (initialized) return;
  initialized = true;
  try {
    bundledModuleHost.install([bundledStudioModule]);
    bundledModuleHost.enable(STUDIO_MODULE_ID);
  } catch (error) {
    // A broken optional module cannot abort Core startup. No retry silently re-enables it.
    const code = error instanceof ModuleContractError ? error.code : 'ACTIVATION_FAILED';
    console.error(`[Modules] Production Studio could not start (${code}).`);
  }
}
