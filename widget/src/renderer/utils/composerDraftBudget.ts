import type { ComposerDraft } from '../components/InputBox';

export interface ComposerDraftRetentionLimits {
  maxInactiveDrafts: number;
  maxEstimatedBytes: number;
}

export const COMPOSER_DRAFT_RETENTION_LIMITS: Readonly<ComposerDraftRetentionLimits> = {
  maxInactiveDrafts: 8,
  maxEstimatedBytes: 128 * 1024 * 1024,
};

export function isComposerDraftEmpty(draft: ComposerDraft | undefined): boolean {
  return !draft || (!draft.text && draft.images.length === 0 && draft.documents.length === 0);
}

/** Conservative UTF-16 string estimate, not a measurement of the JavaScript heap.
 * Count every retained attachment string, including duplicated data/data-URL fields.
 * Raw file sizes do not describe the memory used by encoded attachment strings.
 */
export function estimateComposerDraftBytes(draft: ComposerDraft): number {
  let characters = draft.text.length;
  for (const attachment of [...draft.images, ...draft.documents]) {
    for (const value of Object.values(attachment)) {
      if (typeof value === 'string') characters += value.length;
    }
  }
  return characters * 2;
}

export interface InactiveDraftChange {
  /** Conversation whose latest draft is being retained (or recovered). */
  key: string;
  draft: ComposerDraft;
  /** Destination becoming active; its draft no longer consumes inactive capacity. */
  activatingKey?: string;
}

export type InactiveDraftRetentionResult =
  | {
      allowed: true;
      nextDrafts: Map<string, ComposerDraft>;
      inactiveCount: number;
      estimatedBytes: number;
      reason: null;
    }
  | {
      allowed: false;
      inactiveCount: number;
      estimatedBytes: number;
      reason: 'count' | 'bytes';
    };

/** Prepare an inactive-only map without modifying the caller's map or its drafts.
 * No nonempty draft is evicted to make room. Only the explicit replacement,
 * activation, and empty entries are removed. Commit nextDrafts only after the
 * corresponding navigation/recovery has succeeded; recheck if the active draft
 * changed during an asynchronous operation.
 */
export function prepareInactiveDraftRetention(
  drafts: ReadonlyMap<string, ComposerDraft>,
  change: InactiveDraftChange,
  limits: Readonly<ComposerDraftRetentionLimits> = COMPOSER_DRAFT_RETENTION_LIMITS,
): InactiveDraftRetentionResult {
  if (!Number.isSafeInteger(limits.maxInactiveDrafts) || limits.maxInactiveDrafts < 0
    || !Number.isSafeInteger(limits.maxEstimatedBytes) || limits.maxEstimatedBytes < 0) {
    throw new RangeError('Draft retention limits must be nonnegative safe integers.');
  }

  const nextDrafts = new Map<string, ComposerDraft>();
  for (const [key, draft] of drafts) {
    if (key !== change.key && key !== change.activatingKey && !isComposerDraftEmpty(draft)) {
      nextDrafts.set(key, draft);
    }
  }
  if (change.key !== change.activatingKey && !isComposerDraftEmpty(change.draft)) {
    nextDrafts.set(change.key, change.draft);
  }

  const inactiveCount = nextDrafts.size;
  let estimatedBytes = 0;
  for (const draft of nextDrafts.values()) estimatedBytes += estimateComposerDraftBytes(draft);

  if (inactiveCount > limits.maxInactiveDrafts) {
    return { allowed: false, inactiveCount, estimatedBytes, reason: 'count' };
  }
  if (estimatedBytes > limits.maxEstimatedBytes) {
    return { allowed: false, inactiveCount, estimatedBytes, reason: 'bytes' };
  }
  return { allowed: true, nextDrafts, inactiveCount, estimatedBytes, reason: null };
}
