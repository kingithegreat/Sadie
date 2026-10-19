/**
 * Picks the decision provider from the `decision.provider` setting.
 * Unknown or missing values select the local provider.
 */
import { JevDecisionProvider, type JevProviderOptions } from './jev-provider';
import { LocalDecisionProvider } from './local-provider';
import { DecisionError, normalizeDecisionProvider, type DecisionProvider } from './types';

export * from './types';
export { LocalDecisionProvider } from './local-provider';
export { JevDecisionProvider } from './jev-provider';

export interface DecisionSettingsLike {
  decision?: { provider?: unknown } | null;
}

export function createDecisionProvider(
  settings: DecisionSettingsLike | null | undefined,
  jevOptions: JevProviderOptions = {},
): DecisionProvider {
  const id = normalizeDecisionProvider(settings?.decision?.provider);
  return id === 'jev' ? new JevDecisionProvider(jevOptions) : new LocalDecisionProvider();
}

/**
 * Optional safety net: run `primary`, and on any DecisionError answer from the
 * local provider instead, so the app keeps working offline. Not applied by
 * default — the plan wants the "disabled" error to be visible.
 */
export function withLocalFallback(
  primary: DecisionProvider,
  onFallback?: (err: DecisionError) => void,
): DecisionProvider {
  const local = new LocalDecisionProvider();
  return {
    id: primary.id,
    async decide(state, questions) {
      try {
        return await primary.decide(state, questions);
      } catch (err) {
        if (!(err instanceof DecisionError)) throw err;
        onFallback?.(err);
        return local.decide(state, questions);
      }
    },
  };
}
