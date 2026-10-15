import type { ComposerDraft } from '../components/InputBox';
import {
  COMPOSER_DRAFT_RETENTION_LIMITS,
  estimateComposerDraftBytes,
  isComposerDraftEmpty,
  prepareInactiveDraftRetention,
} from '../utils/composerDraftBudget';

const draft = (text = ''): ComposerDraft => ({ text, images: [], documents: [] });
const limits = (maxInactiveDrafts: number, maxEstimatedBytes: number) => ({
  maxInactiveDrafts,
  maxEstimatedBytes,
});

describe('composer draft retention budget', () => {
  test('defaults to eight inactive drafts and 128 MiB of estimated strings', () => {
    expect(COMPOSER_DRAFT_RETENTION_LIMITS).toEqual(limits(8, 128 * 1024 * 1024));
  });

  test('estimates UTF-16 text and all retained attachment strings, including aliases', () => {
    const value: ComposerDraft = {
      text: 'a\u{1f642}',
      images: [{ id: 'i', filename: 'f', mimeType: 'm', data: 'abc', base64: 'abc', url: 'data:m;base64,abc', size: 1_000_000 }],
      documents: [{ id: 'd', filename: 'n', mimeType: 't', data: '1234', size: 10_000_000 }],
    };
    // Text: 3 UTF-16 units. Image: 1+1+1+3+3+17. Document: 1+1+1+4.
    expect(estimateComposerDraftBytes(value)).toBe((3 + 26 + 7) * 2);
    expect(estimateComposerDraftBytes(draft())).toBe(0);
  });

  test('whitespace and either attachment kind remain user work', () => {
    expect(isComposerDraftEmpty(undefined)).toBe(true);
    expect(isComposerDraftEmpty(draft())).toBe(true);
    expect(isComposerDraftEmpty(draft(' '))).toBe(false);
    expect(isComposerDraftEmpty({ ...draft(), images: [{ id: 'image' }] })).toBe(false);
    expect(isComposerDraftEmpty({ ...draft(), documents: [{ id: 'document', filename: 'f', mimeType: 't', size: 0, data: '' }] })).toBe(false);
  });

  test('allows the exact count boundary and refuses a ninth recovery without eviction', () => {
    const saved = new Map(Array.from({ length: 7 }, (_, index) => [`saved-${index}`, draft('x')] as const));
    const eighth = prepareInactiveDraftRetention(saved, { key: 'eighth', draft: draft('y') });
    expect(eighth.allowed).toBe(true);
    if (!eighth.allowed) throw new Error('Expected eight drafts to fit');
    expect(eighth.inactiveCount).toBe(8);
    expect(saved.size).toBe(7);

    const before = Array.from(eighth.nextDrafts.entries());
    const ninth = prepareInactiveDraftRetention(eighth.nextDrafts, { key: 'stopped-request', draft: draft('z') });
    expect(ninth).toEqual({ allowed: false, inactiveCount: 9, estimatedBytes: 18, reason: 'count' });
    expect(ninth).not.toHaveProperty('nextDrafts');
    expect(Array.from(eighth.nextDrafts.entries())).toEqual(before);
  });

  test('allows the exact byte boundary and refuses excess without changing saved drafts', () => {
    const savedDraft = draft('abc');
    const saved = new Map([['saved', savedDraft]]);
    const boundary = prepareInactiveDraftRetention(saved, { key: 'outgoing', draft: draft('xyz') }, limits(8, 12));
    expect(boundary.allowed).toBe(true);
    expect(boundary.estimatedBytes).toBe(12);

    const excess = prepareInactiveDraftRetention(saved, { key: 'outgoing', draft: draft('\u{1f642}\u{1f642}') }, limits(8, 12));
    expect(excess).toEqual({ allowed: false, inactiveCount: 2, estimatedBytes: 14, reason: 'bytes' });
    expect(excess).not.toHaveProperty('nextDrafts');
    expect(saved.size).toBe(1);
    expect(saved.get('saved')).toBe(savedDraft);
  });

  test('replaces the explicit outgoing snapshot instead of double counting it', () => {
    const unrelated = draft('keep');
    const saved = new Map([['outgoing', draft('old and much larger')], ['unrelated', unrelated]]);
    const latest = draft('new');
    const result = prepareInactiveDraftRetention(saved, { key: 'outgoing', draft: latest }, limits(2, 14));
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error('Expected replacement to fit');
    expect(result.inactiveCount).toBe(2);
    expect(result.estimatedBytes).toBe(14);
    expect(result.nextDrafts.get('outgoing')).toBe(latest);
    expect(result.nextDrafts.get('unrelated')).toBe(unrelated);
    expect(saved.get('outgoing')?.text).toBe('old and much larger');
  });

  test('activating a saved destination frees its count and bytes before retaining outgoing work', () => {
    const destination = draft('large saved destination');
    const saved = new Map([['destination', destination], ['other', draft('abc')]]);
    const outgoing = draft('xyz');
    const result = prepareInactiveDraftRetention(saved, {
      key: 'outgoing', draft: outgoing, activatingKey: 'destination',
    }, limits(2, 12));
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error('Expected destination to free capacity');
    expect(Array.from(result.nextDrafts.keys())).toEqual(['other', 'outgoing']);
    expect(result.estimatedBytes).toBe(12);
    expect(saved.get('destination')).toBe(destination);
  });

  test('removes explicit empty replacements and prunes empty entries while preserving whitespace', () => {
    const saved = new Map([['outgoing', draft('old')], ['empty', draft()], ['whitespace', draft(' ')]]);
    const result = prepareInactiveDraftRetention(saved, { key: 'outgoing', draft: draft() }, limits(1, 2));
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error('Expected only whitespace work to remain');
    expect(Array.from(result.nextDrafts.keys())).toEqual(['whitespace']);
    expect(result.estimatedBytes).toBe(2);
    expect(saved.size).toBe(3);
  });

  test('does not retain a draft whose conversation remains active', () => {
    const saved = new Map([['active', draft('stale')], ['other', draft('x')]]);
    const result = prepareInactiveDraftRetention(saved, {
      key: 'active', draft: draft('latest active text'), activatingKey: 'active',
    }, limits(1, 2));
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error('Expected active draft to be excluded');
    expect(Array.from(result.nextDrafts.keys())).toEqual(['other']);
    expect(result.estimatedBytes).toBe(2);
  });

  test('rechecks the latest outgoing draft after an asynchronous operation', () => {
    const saved = new Map([['other', draft('abc')]]);
    expect(prepareInactiveDraftRetention(saved, { key: 'outgoing', draft: draft('x') }, limits(2, 8)).allowed).toBe(true);
    const latest = draft('new typing');
    const rechecked = prepareInactiveDraftRetention(saved, { key: 'outgoing', draft: latest }, limits(2, 8));
    expect(rechecked.allowed).toBe(false);
    expect(rechecked.reason).toBe('bytes');
    expect(latest.text).toBe('new typing');
    expect(saved.size).toBe(1);
  });

  test.each([
    limits(-1, 0), limits(0, -1), limits(1.5, 0), limits(0, Number.POSITIVE_INFINITY),
  ])('rejects invalid limit configuration %j', (invalid) => {
    expect(() => prepareInactiveDraftRetention(new Map(), { key: 'outgoing', draft: draft() }, invalid)).toThrow(RangeError);
  });
});
