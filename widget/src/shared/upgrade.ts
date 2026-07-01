import type { GateBlockedResponse } from './types';

/** True when a Pro-gated IPC call resolved to an upgrade_required response. */
export function isGateBlocked(value: unknown): value is GateBlockedResponse {
  return !!value && typeof value === 'object' && (value as any).status === 'upgrade_required';
}
