import {
  browserDraftStorage, canRedo, canUndo, clearDraft, COALESCE_MS, describeDraftAge,
  initialHistory, loadDraft, MAX_HISTORY, record, redo, reset, saveDraft, undo,
  type DraftStorage,
} from '../components/storyboard-history';

const identity = (board: { shots: string[] }) => board.shots.join('|');

describe('storyboard undo/redo', () => {
  it('undoes and redoes edits in the order they happened', () => {
    let h = initialHistory({ shots: ['a'] });
    h = record(h, { shots: ['ab'] }, { key: 'shot1', now: 1_000 });
    h = record(h, { shots: ['ab', 'c'] }, { key: 'addShot', now: 5_000 });
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);

    h = undo(undo(h));
    expect(h.present).toEqual({ shots: ['a'] });
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toEqual({ shots: ['ab'] });
    h = redo(h);
    expect(h.present).toEqual({ shots: ['ab', 'c'] });
    expect(canRedo(h)).toBe(false);
    // Redo past the end, and undo past the start, are no-ops rather than errors.
    expect(redo(h)).toBe(h);
    expect(undo(undo(initialHistory({ shots: [] }))).past).toEqual([]);
  });

  it('typing in one field is one step, but a different field starts a new one', () => {
    let h = initialHistory({ shots: ['H'] });
    h = record(h, { shots: ['He'] }, { key: 'shot1:text', now: 1_000 });
    h = record(h, { shots: ['Hel'] }, { key: 'shot1:text', now: 1_300 });
    h = record(h, { shots: ['Hello'] }, { key: 'shot1:text', now: 1_600 });
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toEqual({ shots: ['H'] });

    // A pause beyond the window, or another field, is its own step.
    h = record(h, { shots: ['Hello!'] }, { key: 'shot1:text', now: 1_600 + COALESCE_MS + 1 });
    h = record(h, { shots: ['Hello!', 'x'] }, { key: 'shot2:text', now: 3_000 });
    expect(h.past).toHaveLength(3);
  });

  it('a redo stack is dropped by a new edit, and an unchanged value records nothing', () => {
    let h = initialHistory({ shots: ['a'] });
    const same = h.present;
    expect(record(h, same, { now: 10 })).toBe(h);
    h = record(h, { shots: ['b'] }, { now: 10 });
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = record(h, { shots: ['c'] }, { now: 20 });
    expect(canRedo(h)).toBe(false);
  });

  it('keeps memory bounded and starts fresh for another project', () => {
    let h = initialHistory({ shots: ['0'] });
    for (let i = 1; i <= MAX_HISTORY + 20; i++) h = record(h, { shots: [String(i)] }, { now: i * 10_000 });
    expect(h.past).toHaveLength(MAX_HISTORY);
    expect(h.past[0]).toEqual({ shots: ['20'] });
    const fresh = reset({ shots: ['other project'] });
    expect(canUndo(fresh)).toBe(false);
  });
});

describe('storyboard drafts', () => {
  const memory = (): DraftStorage & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: k => void map.delete(k) };
  };
  const draft = (board: { shots: string[] }, savedIdentity: string) => ({ projectId: 'egypt', savedIdentity, savedAt: 1_000, board });

  it('offers back an edit made before the app closed', () => {
    const store = memory();
    expect(saveDraft(store, draft({ shots: ['edited'] }, 'saved'))).toBe(true);
    const found = loadDraft(store, 'egypt', 'saved', identity);
    expect(found?.board).toEqual({ shots: ['edited'] });
    clearDraft(store, 'egypt');
    expect(loadDraft(store, 'egypt', 'saved', identity)).toBeNull();
  });

  it('drops a draft that is stale, is for another project, or matches what is saved', () => {
    const store = memory();
    // Saved on disk has moved on since the draft was written.
    saveDraft(store, draft({ shots: ['edited'] }, 'old-version'));
    expect(loadDraft(store, 'egypt', 'saved', identity)).toBeNull();
    expect(store.map.size).toBe(0);

    saveDraft(store, draft({ shots: ['edited'] }, 'saved'));
    expect(loadDraft(store, 'rome', 'saved', identity)).toBeNull();

    // A draft identical to the saved project is not an unsaved edit.
    saveDraft(store, draft({ shots: ['saved'] }, 'saved'));
    expect(loadDraft(store, 'egypt', 'saved', identity)).toBeNull();

    store.map.set('homebot.storyboard.draft.egypt', '{not json');
    expect(loadDraft(store, 'egypt', 'saved', identity)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it('storage that is missing or throws never breaks editing', () => {
    const throwing: DraftStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(saveDraft(throwing, draft({ shots: ['x'] }, 'saved'))).toBe(false);
    expect(loadDraft(throwing, 'egypt', 'saved', identity)).toBeNull();
    expect(() => clearDraft(throwing, 'egypt')).not.toThrow();
    expect(saveDraft(null, draft({ shots: ['x'] }, 'saved'))).toBe(false);
    expect(loadDraft(null, 'egypt', 'saved', identity)).toBeNull();
    expect(browserDraftStorage()).toBe(globalThis.localStorage ?? null);
  });

  it('says how old the draft is, in words', () => {
    const now = 10_000_000;
    expect(describeDraftAge(now - 5_000, now)).toBe('moments ago');
    expect(describeDraftAge(now - 60_000, now)).toBe('1 minute ago');
    expect(describeDraftAge(now - 20 * 60_000, now)).toBe('20 minutes ago');
    expect(describeDraftAge(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(describeDraftAge(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});
