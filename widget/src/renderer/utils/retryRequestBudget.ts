import type { HomeBotRequestWithImages } from '../../shared/types';

export interface RetryRequestRetentionLimits {
  maxEntries: number;
  maxEstimatedBytes: number;
}

export const RETRY_REQUEST_RETENTION_LIMITS: Readonly<RetryRequestRetentionLimits> = {
  maxEntries: 8,
  maxEstimatedBytes: 32 * 1024 * 1024,
};

/** Conservative UTF-16 string estimate; raw file sizes are not retained bytes.
 * Attachment object aliases count once within a request, while distinct objects
 * and distinct string fields (including data plus preview URL) count separately.
 */
export function estimateRetryRequestBytes(request: HomeBotRequestWithImages): number {
  const stringCharacters = (value: object): number => Object.values(value)
    .reduce((total: number, field: unknown) => total + (typeof field === 'string' ? field.length : 0), 0);
  let characters = stringCharacters(request);
  const seen = new WeakSet<object>();
  const addAttachment = (attachment: object | undefined): void => {
    if (!attachment || seen.has(attachment)) return;
    seen.add(attachment);
    characters += stringCharacters(attachment);
  };
  addAttachment(request.image);
  for (const image of request.images || []) addAttachment(image);
  for (const document of request.documents || []) addAttachment(document);
  return characters * 2;
}

/** Store the newest original request for an assistant turn, evicting oldest
 * snapshots when the aggregate budget is exceeded. An oversized replacement
 * removes its stale same-key request so Retry cannot accidentally use old work.
 * Returns whether the supplied request remains available in the cache.
 */
export function retainRetryRequest(
  requests: Map<string, HomeBotRequestWithImages>,
  assistantId: string,
  request: HomeBotRequestWithImages,
  limits: Readonly<RetryRequestRetentionLimits> = RETRY_REQUEST_RETENTION_LIMITS,
): boolean {
  if (!Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 0
    || !Number.isSafeInteger(limits.maxEstimatedBytes) || limits.maxEstimatedBytes < 0) {
    throw new RangeError('Retry retention limits must be nonnegative safe integers.');
  }

  const incomingBytes = estimateRetryRequestBytes(request);
  requests.delete(assistantId);
  if (incomingBytes > limits.maxEstimatedBytes) return false;
  requests.set(assistantId, request);

  let retainedBytes = 0;
  for (const retained of requests.values()) retainedBytes += estimateRetryRequestBytes(retained);
  while (requests.size > limits.maxEntries || retainedBytes > limits.maxEstimatedBytes) {
    const oldest = requests.keys().next();
    if (oldest.done) break;
    retainedBytes -= estimateRetryRequestBytes(requests.get(oldest.value)!);
    requests.delete(oldest.value);
  }
  return requests.has(assistantId);
}
