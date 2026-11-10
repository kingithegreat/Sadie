/** HomeBot OpenRouter model router. See README.md in this folder. */
export { pickTier, pickChatTier, escalateTier, clampTier, tierSignals, TIER_ORDER } from './pick-tier';
export type { RouterTier, ChatTierPolicy, TierSignals } from './pick-tier';
export { loadRouterConfig, parseRouterConfig, resolveConfigPath, decideLive, defaultLedgerPath, homebotRouterDir, RouterConfigError, REPO_DEFAULT_CONFIG_PATH } from './config';
export type { RouterConfig, TierConfig, PricePerMillion, LoadConfigOptions, LiveDecision, Env } from './config';
export { SpendLedger, SpendCapExceededError, LedgerCorruptError, monthKey } from './ledger';
export type { LedgerEntry } from './ledger';
export { ModelRouter, RouterRequestError, buildChatRequest, stableSessionId, usesCacheControl, estimateCostUsd, estimateTokens, formatRouteBadge, formatUsd } from './client';
export type { RouterFetch, FetchResponseLike, RouterMessage, OpenRouterChatBody, RouteRequest, RouteResult, AttemptRecord, ModelRouterOptions } from './client';
export { createRouter, routeChatTurn } from './chat-route';
export type { CreateRouterOptions, ChatTurn, ChatTurnResult } from './chat-route';
export { createRouterServer, startRouterServer } from './server';
export {
  parseCodeCommand, detectCodingIntent, extractUnifiedDiff, diffStats, mockVibeDiff, proposeVibeChange,
  applyVibeProposal, checkDiffApplies, formatVibePreview, runVibeCodeTurn, vibeBranchName, VibeCodeError, VIBE_BRANCH_PREFIX,
} from './vibe-code';
export type { VibeProposal, VibeApplyResult, VibeTurnIO, VibeTurnOutcome, VibeDiffStats } from './vibe-code';
