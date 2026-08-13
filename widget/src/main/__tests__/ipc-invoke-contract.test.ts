/**
 * The renderer's half of the IPC boundary must match the main process's half.
 *
 * `ipcRenderer.invoke` is answered ONLY by `ipcMain.handle`. A channel
 * registered with `ipcMain.on` receives `ipcRenderer.send` and nothing else,
 * so an invoke against it never resolves — it rejects with
 *
 *   Error: No handler registered for 'homebot:download-update'
 *
 * Both halves compile, both are exercised by their own unit tests, and the
 * mismatch is invisible until a user clicks the button. That is exactly how
 * the update banner shipped: Download and Restart-now were wired to
 * `ipcMain.on`, so a released user could not install an update at all, and
 * every test in the suite still passed.
 *
 * This is a STATIC scan of the source rather than a runtime check, because the
 * updater's registrations live behind `if (!isE2E && NODE_ENV !== 'test')` and
 * therefore never execute under jest — the one place a runtime test cannot
 * look is the place the bug was.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Channels are written both as bare literals and as members of a
 * `const X = { KEY: 'homebot:thing' }` map, so a literal-only scan reports the
 * whole browser/terminal/workspace/trust groups as missing. Collect every such
 * map so `X.KEY` resolves to its string.
 */
function channelConstants(sources: string[]): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    for (const decl of text.matchAll(/const\s+([A-Z_][A-Za-z0-9_]*)\s*=\s*\{([\s\S]*?)\n\}/g)) {
      for (const pair of decl[2].matchAll(/([A-Za-z0-9_]+)\s*:\s*['"`]([^'"`]+)['"`]/g)) {
        resolved[`${decl[1]}.${pair[1]}`] = pair[2];
      }
    }
  }
  return resolved;
}

/** Every channel `call` is applied to, with `X.KEY` references resolved. */
function channelsFor(text: string, call: string, constants: Record<string, string>): Set<string> {
  const found = new Set<string>();
  const literal = new RegExp(`${call}\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
  for (const m of text.matchAll(literal)) found.add(m[1]);

  const viaConst = new RegExp(`${call}\\(\\s*([A-Z_][A-Za-z0-9_]*\\.[A-Za-z0-9_]+)`, 'g');
  for (const m of text.matchAll(viaConst)) {
    const value = constants[m[1]];
    if (value) found.add(value);
  }
  return found;
}

describe('IPC invoke/handle contract', () => {
  const mainFiles = sourceFiles(path.join(SRC, 'main'));
  const preloadFiles = sourceFiles(path.join(SRC, 'preload'));
  const constants = channelConstants([...mainFiles, ...preloadFiles]);

  const preloadText = preloadFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const invoked = channelsFor(preloadText, 'ipcRenderer\\.invoke', constants);

  const handled = new Set<string>();
  const onned = new Set<string>();
  for (const file of mainFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const c of channelsFor(text, 'ipcMain\\.handle', constants)) handled.add(c);
    for (const c of channelsFor(text, 'ipcMain\\.on', constants)) onned.add(c);
  }

  it('finds both halves of the boundary (guards against the scan silently matching nothing)', () => {
    // If a refactor renames the bridge or moves registration, the scan must
    // fail loudly here rather than pass by finding zero channels to check.
    expect(invoked.size).toBeGreaterThan(100);
    expect(handled.size).toBeGreaterThan(100);
  });

  it('never answers an invoked channel with ipcMain.on', () => {
    const mismatched = [...invoked].filter((c) => onned.has(c) && !handled.has(c)).sort();

    expect(mismatched).toEqual([]);
  });

  it('registers every channel the preload bridge invokes', () => {
    const unregistered = [...invoked].filter((c) => !onned.has(c) && !handled.has(c)).sort();

    expect(unregistered).toEqual([]);
  });
});
