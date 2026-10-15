import type { HomeBotRequestWithImages, ImageAttachment } from '../../shared/types';
import {
  estimateRetryRequestBytes,
  retainRetryRequest,
  RETRY_REQUEST_RETENTION_LIMITS,
} from '../utils/retryRequestBudget';

const request = (message = ''): HomeBotRequestWithImages => ({
  user_id: '', conversation_id: '', message,
});
const limits = (maxEntries: number, maxEstimatedBytes: number) => ({ maxEntries, maxEstimatedBytes });

describe('retry original-request retention budget', () => {
  test('defaults to eight entries and 32 MiB of estimated strings', () => {
    expect(RETRY_REQUEST_RETENTION_LIMITS).toEqual(limits(8, 32 * 1024 * 1024));
  });

  test('counts UTF-16 text, request metadata and every attachment string rather than raw sizes', () => {
    const value: HomeBotRequestWithImages & { streamId: string } = {
      user_id: 'u', conversation_id: 'c', message: 'a\u{1f642}', timestamp: 't',
      conversationPrompt: 'p\u{1f642}', modelOverride: 'model', streamId: 's', retry: true,
      images: [{ filename: 'f', path: 'p', mimeType: 'm', data: 'abc', base64: 'abc', dataUrl: 'u', url: 'v', size: 9_000_000 }],
      documents: [{ id: 'd', filename: 'x', mimeType: 't', data: '1234', size: 10_000_000 }],
    };
    // Request: 1+1+3+1+3+5+1. Image: 1+1+1+3+3+1+1. Document: 1+1+1+4.
    expect(estimateRetryRequestBytes(value)).toBe((15 + 11 + 7) * 2);
    expect(estimateRetryRequestBytes(request())).toBe(0);
  });

  test('counts shared image/images objects once but distinct equal objects separately', () => {
    const image: ImageAttachment = { data: 'abc', url: 'preview' };
    const shared = { ...request(), image, images: [image, image] };
    expect(estimateRetryRequestBytes(shared)).toBe(20);
    expect(estimateRetryRequestBytes({ ...shared, images: [image, { ...image }] })).toBe(40);
    expect(estimateRetryRequestBytes({ ...request(), image })).toBe(20);
  });

  test('counts repeated document object aliases once within a request', () => {
    const document = { id: 'd', filename: 'f', mimeType: 't', data: 'abc', size: 999 };
    expect(estimateRetryRequestBytes({ ...request(), documents: [document, document] })).toBe(12);
    expect(estimateRetryRequestBytes({ ...request(), documents: [document, { ...document }] })).toBe(24);
  });

  test('accepts the exact singleton byte boundary and rejects oversized replacements without stale retry work', () => {
    const retained = new Map<string, HomeBotRequestWithImages>();
    const exact = request('abc');
    expect(retainRetryRequest(retained, 'turn', exact, limits(8, 6))).toBe(true);
    expect(retained.get('turn')).toBe(exact);
    const unrelated = request('x');
    retained.set('other', unrelated);

    expect(retainRetryRequest(retained, 'turn', request('\u{1f642}\u{1f642}'), limits(8, 6))).toBe(false);
    expect(retained.has('turn')).toBe(false);
    expect(retained.get('other')).toBe(unrelated);
    expect(retained.size).toBe(1);
  });

  test('keeps the exact aggregate boundary then evicts oldest requests until the newest fits', () => {
    const retained = new Map<string, HomeBotRequestWithImages>();
    expect(retainRetryRequest(retained, 'oldest', request('ab'), limits(8, 12))).toBe(true);
    expect(retainRetryRequest(retained, 'middle', request('cd'), limits(8, 12))).toBe(true);
    expect(retainRetryRequest(retained, 'newest', request('ef'), limits(8, 12))).toBe(true);
    expect(Array.from(retained.keys())).toEqual(['oldest', 'middle', 'newest']);

    const latest = request('12345');
    expect(retainRetryRequest(retained, 'latest', latest, limits(8, 12))).toBe(true);
    expect(Array.from(retained.keys())).toEqual(['latest']);
    expect(retained.get('latest')).toBe(latest);
  });

  test('allows eight entries and evicts only the oldest when a ninth is retained', () => {
    const retained = new Map<string, HomeBotRequestWithImages>();
    for (let index = 0; index < 8; index++) {
      expect(retainRetryRequest(retained, `turn-${index}`, request('x'))).toBe(true);
    }
    expect(retained.size).toBe(8);
    expect(retained.has('turn-0')).toBe(true);
    expect(retainRetryRequest(retained, 'turn-8', request('y'))).toBe(true);
    expect(Array.from(retained.keys())).toEqual(Array.from({ length: 8 }, (_, index) => `turn-${index + 1}`));
  });

  test('replaces a same-key request without double counting and refreshes its eviction order', () => {
    const retained = new Map([['first', request('abc')], ['second', request('x')]]);
    const replacement = request('y');
    expect(retainRetryRequest(retained, 'first', replacement, limits(2, 4))).toBe(true);
    expect(Array.from(retained.keys())).toEqual(['second', 'first']);
    expect(retained.get('first')).toBe(replacement);
    expect(retainRetryRequest(retained, 'third', request('z'), limits(2, 4))).toBe(true);
    expect(Array.from(retained.keys())).toEqual(['first', 'third']);
  });

  test('does not deduplicate the same request across separately retained assistant turns', () => {
    const retained = new Map<string, HomeBotRequestWithImages>();
    const value = request('abc');
    retainRetryRequest(retained, 'first', value, limits(8, 6));
    expect(retainRetryRequest(retained, 'second', value, limits(8, 6))).toBe(true);
    expect(Array.from(retained.keys())).toEqual(['second']);
  });

  test('a zero-entry budget retains no request and returns false', () => {
    const retained = new Map<string, HomeBotRequestWithImages>();
    expect(retainRetryRequest(retained, '', request(), limits(0, 0))).toBe(false);
    expect(retained.size).toBe(0);
  });

  test.each([
    limits(-1, 0), limits(0, -1), limits(1.5, 0), limits(0, Number.POSITIVE_INFINITY),
  ])('rejects invalid configuration %j before mutating the cache', (invalid) => {
    const original = request('work');
    const retained = new Map([['turn', original]]);
    expect(() => retainRetryRequest(retained, 'turn', request('replacement'), invalid)).toThrow(RangeError);
    expect(retained.get('turn')).toBe(original);
  });
});
