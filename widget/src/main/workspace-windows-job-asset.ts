import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

declare const HOMEBOT_WINDOWS_JOB_ASSET_IDENTITY: string | undefined;
const buildMarker = 'HOMEBOT_OWNED_WINDOWS_JOB_ASSET_V1:';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;

function readRegular(file: string, maximum: number): Buffer {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum || path.resolve(fs.realpathSync.native(file)).toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error('The managed Job product asset is not at its fixed regular location.');
  const descriptor = fs.openSync(file, 'r');
  try {
    const held = fs.fstatSync(descriptor);
    if (!held.isFile() || held.dev !== before.dev || held.ino !== before.ino || held.size !== before.size) throw new Error('The managed Job product asset changed while opening.');
    // Never let a growing file make readFileSync allocate beyond the budget.
    const bytes = Buffer.alloc(held.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (!after.isFile() || after.dev !== held.dev || after.ino !== held.ino || after.size !== held.size || offset !== held.size || offset > maximum) throw new Error('The managed Job product asset changed while reading.');
    return bytes.subarray(0, offset);
  } finally { fs.closeSync(descriptor); }
}

/** Bundled output pins its hash. Unbundled source trusts ONLY its fixed product
 * source/manifest preparation boundary; no request, cwd or environment selects it. */
export function verifiedWorkspaceWindowsJobAsset(): { assembly: string; sha256: string } {
  const bundled = typeof HOMEBOT_WINDOWS_JOB_ASSET_IDENTITY !== 'undefined';
  let assembly: string, expected: string;
  if (bundled) {
    const identity = HOMEBOT_WINDOWS_JOB_ASSET_IDENTITY!;
    if (!identity.startsWith(buildMarker)) throw new Error('The managed Job build identity is invalid.');
    expected = identity.slice(buildMarker.length);
    // Framework PowerShell cannot open Electron's virtual ASAR filesystem.
    const mainDirectory = __dirname.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    assembly = path.resolve(mainDirectory, 'assets', 'OwnedWindowsJob.dll');
  } else {
    // Explicit source layout is required; a missing build define in out cannot
    // silently load a nearby source checkout or use cwd as an asset search path.
    if (path.basename(__dirname) !== 'main' || path.basename(path.dirname(__dirname)) !== 'src') throw new Error('The managed Job build hash is missing.');
    const native = path.resolve(__dirname, '../../native');
    assembly = path.join(native, 'generated', 'OwnedWindowsJob.dll');
    const value: unknown = JSON.parse(readRegular(path.join(native, 'generated', 'manifest.json'), 4096).toString('utf8'));
    if (!value || typeof value !== 'object') throw new Error('The managed Job product manifest is malformed.');
    const manifest = value as Record<string, unknown>;
    const referenceNames = ['mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Web.Extensions.dll'];
    if (manifest.version !== 2 || typeof manifest.sourceSha256 !== 'string' || !hashPattern.test(manifest.sourceSha256) || typeof manifest.compilerSha256 !== 'string' || !hashPattern.test(manifest.compilerSha256) || typeof manifest.preparationSha256 !== 'string' || !hashPattern.test(manifest.preparationSha256) || typeof manifest.optionsSha256 !== 'string' || !hashPattern.test(manifest.optionsSha256) || typeof manifest.assemblySha256 !== 'string' || !hashPattern.test(manifest.assemblySha256) || !Array.isArray(manifest.references) || manifest.references.length !== referenceNames.length || manifest.references.some((value: unknown, index: number) => !value || typeof value !== 'object' || (value as Record<string, unknown>).name !== referenceNames[index] || typeof (value as Record<string, unknown>).sha256 !== 'string' || !hashPattern.test((value as Record<string, string>).sha256)) || sha(readRegular(path.join(native, 'OwnedWindowsJob.cs'), 1024 * 1024)) !== manifest.sourceSha256 || sha(readRegular(path.resolve(__dirname, '../../scripts/prepare-windows-job.cjs'), 1024 * 1024)) !== manifest.preparationSha256) throw new Error('The managed Job product manifest is stale or malformed.');
    expected = manifest.assemblySha256;
  }
  if (!hashPattern.test(expected)) throw new Error('The managed Job build hash is invalid.');
  const bytes = readRegular(assembly, 1024 * 1024);
  if (bytes.length < 512 || bytes.toString('ascii', 0, 2) !== 'MZ' || sha(bytes) !== expected) throw new Error('The managed Job product asset hash does not match its preparation.');
  return { assembly, sha256: expected };
}
