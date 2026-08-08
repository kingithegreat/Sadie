/**
 * HomeBot / HomeBot — Automation Center gate (the spec's recommended proof point).
 * ---------------------------------------------------------------------------
 * "Gate the Automation Center first (highest-value)." The Automation Center is
 * the flagship Pro feature: scheduled + triggered workflows (n8n), plus the
 * proactive/briefing and local-image-generation surfaces that depend on it.
 *
 * In the running app these are exposed as ipcMain.handle channels in
 * widget/src/main/ipc-handlers.ts — the literal channel strings registered
 * there, e.g.:
 *   - 'homebot:automation:image:generate'   (sd.cpp image gen)   → imageGen
 *   - 'homebot:scheduler-list'/-add/-remove/-toggle               → automation
 *
 * This module enumerates those channels, maps each to the capability that
 * unlocks it, and provides a single guard + a helper to register pre-gated
 * handlers. The fence lives here at the handler layer, not in the renderer.
 */
import { Capability } from '../entitlements';
import {
  TierProvider,
  GateBlockedResponse,
  ensureFeature,
  withFeatureGate,
} from './featureGate';

/**
 * Automation Center IPC channels → required capability.
 * Listing them in one place means adding a new automation channel is a
 * one-line addition that is automatically fenced. Keys mirror the literal
 * channel names registered in widget/src/main/ipc-handlers.ts.
 */
export const AUTOMATION_CENTER_CHANNELS: Readonly<Record<string, Capability>> = {
  'homebot:automation:image:generate': 'imageGen',
  'homebot:scheduler-list': 'automation',
  'homebot:scheduler-add': 'automation',
  'homebot:scheduler-remove': 'automation',
  'homebot:scheduler-toggle': 'automation',
  // Automation Center CRUD — the channels the running UI actually calls.
  // Creating, running, editing, and deploying automations is the flagship Pro
  // feature and must be fenced here at the handler layer. (Listing/loading is
  // intentionally left open so Free users can still see the panel and its
  // upgrade prompt rather than an empty error.)
  'homebot:create-automation': 'automation',
  'homebot:update-automation': 'automation',
  'homebot:run-automation': 'automation',
};

/** Is this IPC channel part of the (Pro-gated) Automation Center? */
export function isAutomationChannel(channel: string): boolean {
  return Object.prototype.hasOwnProperty.call(AUTOMATION_CENTER_CHANNELS, channel);
}

/** The capability that unlocks a given Automation Center channel. */
export function capabilityForChannel(channel: string): Capability | undefined {
  return AUTOMATION_CENTER_CHANNELS[channel];
}

/**
 * Guard a specific Automation Center channel. Returns null when allowed, or a
 * structured upgrade response when the caller's tier is insufficient.
 * Throws for an unknown channel (programmer error, not a runtime tier issue).
 */
export async function guardAutomationChannel(
  channel: string,
  getTier: TierProvider,
  upgradeUrl?: string
): Promise<GateBlockedResponse | null> {
  const capability = capabilityForChannel(channel);
  if (!capability) {
    throw new Error(`Unknown Automation Center channel: ${channel}`);
  }
  return ensureFeature(getTier, capability, upgradeUrl);
}

/**
 * Convenience: build a pre-gated ipcMain.handle listener for an Automation
 * Center channel. Wire it in the app like:
 *
 *   import { ipcMain } from 'electron';
 *   import { gatedAutomationHandler } from '../../src/handlers/automationCenter';
 *   import { addJob } from './scheduler';
 *
 *   ipcMain.handle(
 *     'homebot:scheduler-add',
 *     gatedAutomationHandler('homebot:scheduler-add', getCurrentTier,
 *       async (_event, job) => addJob(job))
 *   );
 *
 * A free user calling the channel receives { status:'upgrade_required', upgrade }
 * and the real handler never runs — the renderer renders the upgrade modal.
 */
export function gatedAutomationHandler<
  H extends (...args: any[]) => Promise<any>
>(
  channel: string,
  getTier: TierProvider,
  handler: H,
  upgradeUrl?: string
) {
  const capability = capabilityForChannel(channel);
  if (!capability) {
    throw new Error(`Unknown Automation Center channel: ${channel}`);
  }
  return withFeatureGate(capability, getTier, handler, upgradeUrl);
}
