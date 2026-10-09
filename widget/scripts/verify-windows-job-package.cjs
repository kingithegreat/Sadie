'use strict';
// Public electron-builder beforePack contract. No compilation or fallback copy.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function readBounded(file, maximum) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || fs.realpathSync.native(file).toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error('Windows Job packaging requires fixed regular prepared output.');
  const fd = fs.openSync(file, 'r');
  try {
    const held = fs.fstatSync(fd);
    if (held.dev !== stat.dev || held.ino !== stat.ino || held.size !== stat.size) throw new Error('Windows Job packaging input changed.');
    const bytes = Buffer.alloc(held.size + 1); let count = 0;
    while (count < bytes.length) { const read = fs.readSync(fd, bytes, count, bytes.length - count, count); if (!read) break; count += read; }
    const after = fs.fstatSync(fd);
    if (after.dev !== held.dev || after.ino !== held.ino || after.size !== held.size || count !== held.size) throw new Error('Windows Job packaging input changed.');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
module.exports = function verifyManagedWindowsJob(context) {
  if (context.electronPlatformName !== 'win32') return;
  // This is electron-builder's public application root, never request cwd/env.
  const appDir = context.packager?.info?.appDir;
  if (typeof appDir !== 'string' || !path.isAbsolute(appDir)) throw new Error('Windows Job packaging requires the actual absolute product application root.');
  const main = readBounded(path.join(appDir, 'out', 'main', 'index.js'), 32 * 1024 * 1024).toString('utf8');
  const identities = [...main.matchAll(/HOMEBOT_OWNED_WINDOWS_JOB_ASSET_V1:([a-f0-9]{64})/g)];
  if (identities.length !== 1) throw new Error('Windows packaging requires exactly one pinned managed Job build identity. Build on Windows before packaging.');
  const bytes = readBounded(path.join(appDir, 'out', 'main', 'assets', 'OwnedWindowsJob.dll'), 1024 * 1024);
  if (bytes.length < 512 || bytes.toString('ascii', 0, 2) !== 'MZ' || crypto.createHash('sha256').update(bytes).digest('hex') !== identities[0][1]) throw new Error('Windows packaging requires the unchanged managed Job asset pinned by its actual build.');
  const hostIdentities = [...main.matchAll(/HOMEBOT_OWNED_WINDOWS_JOB_HOST_V1:([a-f0-9]{64})/g)];
  if (hostIdentities.length !== 1) throw new Error('Windows packaging requires exactly one pinned managed Job console host identity.');
  const host = readBounded(path.join(appDir, 'out', 'main', 'assets', 'OwnedWindowsJobHost.exe'), 1024 * 1024);
  if (host.length < 512 || host.toString('ascii', 0, 2) !== 'MZ' || crypto.createHash('sha256').update(host).digest('hex') !== hostIdentities[0][1]) throw new Error('Windows packaging requires the unchanged managed Job console host pinned by its actual build.');
};
