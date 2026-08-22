import { resolveWithinHome } from '../utils/path-guard';
import * as os from 'os';
import * as path from 'path';

describe('resolveWithinHome', () => {
  const home = os.homedir();

  test('accepts a path inside the home directory', () => {
    const res = resolveWithinHome(path.join(home, 'docs', 'file.txt'));
    expect('error' in res).toBe(false);
    if (!('error' in res)) expect(res.resolved).toBe(path.resolve(path.join(home, 'docs', 'file.txt')));
  });

  test('accepts the home directory itself', () => {
    const res = resolveWithinHome(home);
    expect('error' in res).toBe(false);
  });

  test('expands a leading ~ to the home directory', () => {
    const res = resolveWithinHome('~/notes.md');
    expect('error' in res).toBe(false);
    if (!('error' in res)) expect(res.resolved).toBe(path.resolve(path.join(home, 'notes.md')));
  });

  test('rejects a traversal path escaping home', () => {
    const res = resolveWithinHome(path.join(home, '..', '..', 'Windows', 'system32'));
    expect('error' in res).toBe(true);
  });

  test('rejects an absolute path outside home', () => {
    const res = resolveWithinHome('C:\\Windows\\system32\\config');
    expect('error' in res).toBe(true);
  });

  test('rejects empty input', () => {
    expect('error' in resolveWithinHome('')).toBe(true);
  });

  test('is case-insensitive on the home prefix (Windows semantics)', () => {
    const flipped = home.charAt(0).toUpperCase() === home.charAt(0)
      ? home.charAt(0).toLowerCase() + home.slice(1)
      : home.charAt(0).toUpperCase() + home.slice(1);
    const res = resolveWithinHome(path.join(flipped, 'file.txt'));
    expect('error' in res).toBe(false);
  });
});
