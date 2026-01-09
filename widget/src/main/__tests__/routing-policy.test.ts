import { fuzzyIncludes } from '../../main/message-router';

describe('routing policy helpers', () => {
  test('fuzzyIncludes matches correct typos', () => {
    expect(fuzzyIncludes('give mea sumary', 'summary')).toBe(true);
    expect(fuzzyIncludes('please produce a report', 'report')).toBe(true);
    expect(fuzzyIncludes('something unrelated', 'summary')).toBe(false);
  });
});