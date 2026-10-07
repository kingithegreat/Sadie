import * as fs from 'fs';
import { currentWorkspace, workspaceToolError } from './workspace-context';
import { validateTrustedWorkspaceRoot, workspacePathWithin } from './workspace-trust';
import { queryOpenedFilePaths } from './opened-file-paths';

/** POSIX FIFO replacement must not block before regular-file fstat checks. */
export function diffReadOpenFlags(platform = process.platform, constants: { O_RDONLY: number; O_NONBLOCK?: number } = fs.constants): number {
  if (platform === 'win32') return constants.O_RDONLY;
  if (!Number.isSafeInteger(constants.O_NONBLOCK) || !constants.O_NONBLOCK) throw new Error('Diff nonblocking file open is unavailable on this platform.');
  return constants.O_RDONLY | constants.O_NONBLOCK;
}

function sameVersion(a: fs.BigIntStats, b: fs.BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && b.nlink > 0n;
}

/** Both FDs remain held until all queries and reads finish. No path readFile. */
export async function readBoundedDiffFiles(paths: readonly [string, string], maxBytes: number): Promise<[string, string]> {
  const authority = currentWorkspace(), root = authority?.root;
  const assertAuthority = () => {
    if (!authority) return;
    const denied = workspaceToolError('diff_files');
    if (denied || currentWorkspace() !== authority || authority.root !== root || validateTrustedWorkspaceRoot(root) !== root) {
      throw new Error('The IDE project changed, was stopped or is no longer trusted. No diff content was returned.');
    }
  };
  const handles: fs.promises.FileHandle[] = [];
  let failed = false;
  try {
    assertAuthority();
    const flags = diffReadOpenFlags();
    for (const target of paths) { handles.push(await fs.promises.open(target, flags)); assertAuthority(); }
    assertAuthority();
    const initial = await Promise.all(handles.map(handle => handle.stat({ bigint: true })));
    for (const stat of initial) {
      if (!stat.isFile() || stat.nlink <= 0n) throw new Error('Diff requires two available regular files.');
      if (stat.size > BigInt(maxBytes)) throw new Error(`Diff file exceeds the ${maxBytes}-byte limit. Compare a smaller excerpt.`);
    }
    const assertOpenedPaths = async () => {
      assertAuthority();
      if (!root) return; // Ordinary chat retains its existing home boundary.
      const actual = await queryOpenedFilePaths(handles.map(handle => handle.fd));
      assertAuthority();
      if (actual.some(target => !workspacePathWithin(root, target))) throw new Error('An opened diff file is outside the original IDE project. No file content was returned.');
    };
    // Verify BOTH actual opened objects before allocating buffers or reading
    // either file. A replaced parent junction cannot redirect a path read.
    await assertOpenedPaths();
    const contents: string[] = [];
    for (let index = 0; index < handles.length; index++) {
      assertAuthority();
      const handle = handles[index], expected = initial[index];
      if (!sameVersion(expected, await handle.stat({ bigint: true }))) throw new Error('A diff file changed during verification. Compare it again.');
      // One extra byte detects growth without ever reading an unbounded file.
      const buffer = Buffer.alloc(Number(expected.size) + 1);
      let offset = 0;
      while (offset < buffer.length) {
        assertAuthority();
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== Number(expected.size) || !sameVersion(expected, await handle.stat({ bigint: true }))) throw new Error('A diff file changed while it was read. Compare it again.');
      contents.push(buffer.subarray(0, offset).toString('utf8'));
    }
    await assertOpenedPaths();
    assertAuthority();
    return contents as [string, string];
  } catch (failure) {
    failed = true;
    // Never echo filesystem errors that can reveal a replaced outside path.
    const message = (failure as Error).message;
    if (/^(Diff |A diff file |The IDE project |An opened diff file |Secure IDE |Opened-file |The fixed )/.test(message)) throw failure;
    throw new Error('The diff files could not be opened or verified safely. No file content was returned.');
  } finally {
    // Open failure on side B still joins side A's held descriptor cleanup.
    const cleanup = await Promise.allSettled(handles.map(handle => handle.close()));
    if (!failed && cleanup.some(result => result.status === 'rejected')) throw new Error('Diff file handles could not be closed safely. No diff content was returned.');
  }
}
