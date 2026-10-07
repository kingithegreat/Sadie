'use strict';
// Real product preparation, shared by Jest, electron-vite dev and builds.
// Never called by a running HomeBot or selected using a workspace/request path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const widget = path.resolve(__dirname, '..');
const source = path.join(widget, 'native', 'OwnedWindowsJob.cs');
const directory = path.join(widget, 'native', 'generated');
const assembly = path.join(directory, 'OwnedWindowsJob.dll');
const manifest = path.join(directory, 'manifest.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(file).toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error('Managed product asset must be a regular file at its fixed location.');
  return stat;
}
function compilerInputs(systemRoot) {
  if (typeof systemRoot !== 'string' || !path.win32.isAbsolute(systemRoot)) throw new Error('Fixed Windows system installation is required for managed asset preparation.');
  for (const family of ['Framework64', 'Framework']) {
    const framework = path.win32.join(systemRoot, 'Microsoft.NET', family, 'v4.0.30319');
    const compiler = path.win32.join(framework, 'csc.exe');
    if (!fs.existsSync(compiler)) continue;
    regular(compiler);
    const references = ['mscorlib.dll', 'System.dll', 'System.Core.dll'].map(name => path.win32.join(framework, name));
    references.forEach(regular);
    return { framework, compiler, references };
  }
  throw new Error('The installed .NET Framework compiler is unavailable; no runtime installation or download is attempted.');
}
function readPrepared(sourceSha256, compilerSha256) {
  try {
    regular(assembly); regular(manifest);
    if (fs.statSync(manifest).size > 4096) return undefined;
    const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const bytes = fs.readFileSync(assembly);
    if (value.version !== 1 || value.sourceSha256 !== sourceSha256 || value.compilerSha256 !== compilerSha256 || !/^[a-f0-9]{64}$/.test(value.assemblySha256) || bytes.length < 512 || bytes.length > 1024 * 1024 || value.assemblySha256 !== sha(bytes)) return undefined;
    return { ...value, assembly };
  } catch { return undefined; }
}
function prepareWindowsJob() {
  if (process.platform !== 'win32') return undefined; // POSIX never loads this asset.
  regular(source);
  const sourceSha256 = sha(fs.readFileSync(source));
  const { framework, compiler, references } = compilerInputs(process.env.SystemRoot || process.env.SYSTEMROOT);
  const compilerSha256 = sha(fs.readFileSync(compiler));
  const prepared = readPrepared(sourceSha256, compilerSha256);
  if (prepared) return prepared;
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync.native(directory).toLowerCase() !== directory.toLowerCase()) throw new Error('Managed asset output must stay inside the fixed real product directory.');
  for (const file of [assembly, manifest]) if (fs.existsSync(file)) regular(file);
  // Fixed installed references, no csc.rsp, project cwd, user module or compiler options.
  const temporary = path.join(directory, 'OwnedWindowsJob-' + crypto.randomUUID() + '.dll');
  const args = ['/nologo', '/noconfig', '/nostdlib+', '/target:library', '/optimize+', '/platform:anycpu', '/out:' + temporary, ...references.map(file => '/reference:' + file), source];
  try {
    const result = spawnSync(compiler, args, { cwd: framework, env: { SystemRoot: path.win32.resolve(process.env.SystemRoot || process.env.SYSTEMROOT), TEMP: directory, TMP: directory }, windowsHide: true, shell: false, timeout: 30_000, maxBuffer: 256 * 1024, encoding: 'utf8' });
    if (result.error || result.status !== 0 || result.signal) throw new Error('Managed Job asset compilation failed; no runtime fallback is available.');
    regular(temporary);
    const bytes = fs.readFileSync(temporary);
    if (bytes.length < 512 || bytes.length > 1024 * 1024 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('The compiler did not produce a bounded managed product asset.');
    const metadata = { version: 1, sourceSha256, compilerSha256, assemblySha256: sha(bytes) };
    fs.renameSync(temporary, assembly);
    fs.writeFileSync(manifest, JSON.stringify(metadata) + '\n');
    return { ...metadata, assembly };
  } finally {
    // Only the exact fresh regular compiler output created for this invocation.
    if (fs.existsSync(temporary)) { regular(temporary); fs.unlinkSync(temporary); }
  }
}
module.exports = { prepareWindowsJob, compilerInputs, readPrepared };
if (require.main === module) { prepareWindowsJob(); }
