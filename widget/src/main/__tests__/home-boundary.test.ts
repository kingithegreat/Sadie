import * as path from 'path';
import { isWithinHomeDir } from '../utils/home-boundary';

// The shared predicate behind every home sandbox. Inputs are already resolved,
// as the contract requires; path.win32/posix.resolve shows what callers pass.
describe('isWithinHomeDir', () => {
  test.each([
    ['a child of a drive-root profile', 'D:\\Documents\\notes.txt', path.win32.resolve('D:\\')],
    ['a child of a drive-root profile, forward slashes', 'D:/Documents/notes.txt', 'D:\\'],
    ['a child of a UNC share-root profile', '\\\\server\\share\\Documents\\notes.txt', '\\\\server\\share\\'],
    ['a child of a POSIX root home', '/srv/notes.txt', path.posix.resolve('/')],
    ['a child of a profile given with a trailing separator', 'C:\\Users\\adenk\\notes.txt', 'C:\\Users\\adenk\\'],
    ['the profile itself when given with a trailing separator', 'C:\\Users\\adenk', 'C:\\Users\\adenk\\'],
    ['a child of an ordinary profile, in any case', 'c:\\users\\ADENK\\Documents\\a.txt', 'C:\\Users\\adenk'],
  ])('accepts %s', (_label, child, home) => {
    expect(isWithinHomeDir(child, home)).toBe(true);
  });

  test.each([
    ['a same-prefix sibling', 'C:\\Users\\adenk-other\\a.txt', 'C:\\Users\\adenk'],
    ['a same-prefix sibling, home with trailing separator', 'C:\\Users\\adenk-other\\a.txt', 'C:\\Users\\adenk\\'],
    ['a same-prefix sibling, POSIX', '/home/aden2/a.txt', '/home/aden'],
    ['another drive under a drive-root profile', 'E:\\secret.txt', 'D:\\'],
    ['a same-prefix share under a UNC share-root profile', '\\\\server\\share2\\a.txt', '\\\\server\\share\\'],
    ['traversal out of the profile', path.win32.resolve('C:\\Users\\adenk\\..\\adam\\a.txt'), 'C:\\Users\\adenk\\'],
    ['traversal out of the profile, POSIX', path.posix.resolve('/home/aden/../aden2/a.txt'), '/home/aden'],
  ])('rejects %s', (_label, candidate, home) => {
    expect(isWithinHomeDir(candidate, home)).toBe(false);
  });

  test('fails closed on empty input', () => {
    expect(isWithinHomeDir('', 'D:\\')).toBe(false);
    expect(isWithinHomeDir('D:\\a.txt', '')).toBe(false);
  });
});
