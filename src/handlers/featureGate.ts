/**
 * HomeBot / HomeBot — Feature gate for the handler / IPC (main-process) layer.
 * ---------------------------------------------------------------------------
 * The spec is explicit: gate in the handler/IPC layer, NOT just the UI —
 * "editing the renderer can't unlock Pro. UI hiding is cosmetic; the real fence
 * is in the handlers."
 *
 * This module provides the reusable fence used by every gated IPC handler.
 * It is electron-agnostic (no `electron` import) so it is unit-testable and so
 * the same fence runs in main, in tests, and anywhere a handler executes.
 *
 * Tier is read at call time via an injected provider rather than captured once,
 * so license upgrades/downgrades take effect immediately without re-wiring.
 */
import {
  Tier,
  Capability,
  UpgradePrompt,
  checkEntitlement,
} from '../entitlements';

/** Supplies the current tier at call time (e.g. from the resolved license). */
export type TierProvider = () => Tier | Promise<Tier>;

/** Shape returned to the renderer when a free user hits a Pro fence. */
export interface GateBlockedResponse {
  status: 'upgrade_required';
  upgrade: UpgradePrompt;
}

export function isGateBlocked(value: unknown): value is GateBlockedResponse {
  return !!value && (value as any).status === 'upgrade_required';
}

/**
 * Imperative gate: resolve the current tier and check a capability.
 * Returns null when allowed, or a GateBlockedResponse when blocked.
 */
export async function ensureFeature(
  getTier: TierProvider,
  capability: Capability,
  upgradeUrl?: string
): Promise<GateBlockedResponse | null> {
  const tier = await getTier();
  const decision = checkEntitlement(tier, capability, upgradeUrl);
  if (decision.allowed) return null;
  return { status: 'upgrade_required', upgrade: decision.upgrade };
}

/**
 * Wrap an ipcMain.handle-style handler so a free user transparently gets a
 * structured upgrade response instead of the handler running.
 *
 * Usage (in widget/src/main/ipc-handlers.ts):
 *
 *   ipcMain.handle(
 *     'homebot:automation:image:generate',
 *     withFeatureGate('imageGen', getCurrentTier, async (event, args) => { ... })
 *   );
 *
 * The wrapped handler keeps the original (event, ...args) signature so it is a
 * drop-in replacement; only the gate is added in front.
 */
export function withFeatureGate<
  H extends (...args: any[]) => Promise<any>
>(
  capability: Capability,
  getTier: TierProvider,
  handler: H,
  upgradeUrl?: string
): (...args: Parameters<H>) => Promise<Awaited<ReturnType<H>> | GateBlockedResponse> {
  return async (...args: Parameters<H>) => {
    const blocked = await ensureFeature(getTier, capability, upgradeUrl);
    if (blocked) return blocked;
    return handler(...args);
  };
}
