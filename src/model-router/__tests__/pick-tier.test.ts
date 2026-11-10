import { clampTier, escalateTier, pickChatTier, pickTier } from '../pick-tier';

describe('pickTier', () => {
  it.each([
    ['fix typo in README', 1, 2],
    ['rename the userId variable', 2, 40],
    ['update the changelog', 1, 10],
    ['add import for lodash', 1, 1],
    ['format and lint this file', 1, 80],
    ['boilerplate for a new component', 2, 60],
    ['css tweak on the header', 1, 5],
    ['copy change on the landing page', 1, 3],
    ['tests only for the parser', 2, 50],
  ])('cheap: %s (%i files, %i lines)', (task, files, diff) => {
    expect(pickTier(task, files, diff)).toBe('cheap');
  });

  it.each([
    ['redesign the architecture of the store', 1, 1],
    ['migrate the database schema', 1, 1],
    ['fix the auth redirect', 1, 1],
    ['security review of the upload path', 1, 1],
    ['SSR hydration mismatch', 1, 1],
    ['update firebase rules', 1, 1],
    ['flaky test in CI', 1, 1],
    ['race condition on save', 1, 1],
    ['find the root cause of the deadlock', 1, 1],
    ['data loss on reconnect', 1, 1],
    ['production incident on checkout', 1, 1],
    ['payment webhook retry', 1, 1],
    ['strip PII from logs', 1, 1],
    ['add an HTTP interceptor', 1, 1],
    ['change the route guard', 1, 1],
    ['tweak Cloud Run config', 1, 1],
  ])('top: %s', (task, files, diff) => {
    expect(pickTier(task, files, diff)).toBe('top');
  });

  it('forces top on size alone', () => {
    expect(pickTier('add a settings page', 8, 10)).toBe('top');
    expect(pickTier('add a settings page', 3, 400)).toBe('top');
  });

  it('a hard word beats a cheap word', () => {
    expect(pickTier('rename the auth token helper', 1, 5)).toBe('top');
  });

  it('cheap needs small size and no blockers', () => {
    expect(pickTier('fix typo', 3, 5)).toBe('mid');
    expect(pickTier('fix typo', 1, 81)).toBe('mid');
    expect(pickTier('fix the typo that caused a regression', 1, 2)).toBe('mid');
    expect(pickTier('fix typo', -1, -1)).toBe('mid');
  });

  it('defaults to mid for standard or unclear work', () => {
    expect(pickTier('add a field to the profile form', 3, 120)).toBe('mid');
    expect(pickTier('', 0, 0)).toBe('mid');
    expect(pickTier('author page for the blog', 2, 50)).toBe('mid');
  });

  it('failed escalates exactly one tier', () => {
    expect(pickTier('fix typo', 1, 2, true)).toBe('mid');
    expect(pickTier('add a field to the form', 3, 120, true)).toBe('top');
    expect(pickTier('migrate the db', 1, 1, true)).toBe('top');
  });

  it('escalateTier and clampTier', () => {
    expect(escalateTier('cheap')).toBe('mid');
    expect(escalateTier('mid')).toBe('top');
    expect(escalateTier('top')).toBe('top');
    expect(clampTier('top', 'cheap', 'mid')).toBe('mid');
    expect(clampTier('cheap', 'mid', 'top')).toBe('mid');
  });
});

describe('pickChatTier', () => {
  const policy = { defaultTier: 'cheap' as const, maxTier: 'mid' as const };
  it('defaults chat to cheap', () => {
    expect(pickChatTier('what should I cook tonight?', policy)).toBe('cheap');
  });
  it('caps hard chat topics at the chat max tier', () => {
    expect(pickChatTier('explain the security model of OAuth', policy)).toBe('mid');
    expect(pickChatTier('explain the security model of OAuth', { defaultTier: 'cheap', maxTier: 'top' })).toBe('top');
  });
  it('escalates one tier on failure', () => {
    expect(pickChatTier('hello', policy, true)).toBe('mid');
    expect(pickChatTier('security question', policy, true)).toBe('top');
  });
});
