'use strict';
// Passive, CI-only observations. This module never signals an application,
// configures WER/Crashpad, changes an exit result, or attributes a root cause.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const LIMITS = Object.freeze({ dumpBytes: 32 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, streams: 128, modules: 512, stringBytes: 4096, entries: 256, depth: 4, xmlBytes: 128 * 1024, helperMs: 4000 });
const within = (root, target) => { const r = path.relative(path.resolve(root), path.resolve(target)); return !path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep); };
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
const validBirth = value => typeof value === 'string' && /^\d{1,19}$/.test(value) && BigInt(value) > 0n;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const message = error => String(error?.message || error).slice(0, 1024);

/** Microsoft minidumpapiset.h uses four-byte packing. No memory/stack bytes or symbols are interpreted. */
function summarizeMinidump(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > LIMITS.dumpBytes) throw Error('Minidump byte bound invalid');
  const range = (offset, size) => { if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > bytes.length - size) throw Error('Minidump RVA/size outside file'); };
  if (bytes.toString('ascii', 0, 4) !== 'MDMP' || (bytes.readUInt32LE(4) & 0xffff) !== 42899) throw Error('Minidump signature/version invalid');
  const count = bytes.readUInt32LE(8), directory = bytes.readUInt32LE(12);
  if (!count || count > LIMITS.streams || directory < 32) throw Error('Minidump stream count/directory invalid');
  range(directory, count * 12);
  const streams = new Map();
  for (let index = 0; index < count; index++) {
    const item = directory + index * 12, type = bytes.readUInt32LE(item), size = bytes.readUInt32LE(item + 4), rva = bytes.readUInt32LE(item + 8);
    range(rva, size);
    if ([4, 6, 15].includes(type)) { if (streams.has(type)) throw Error('Duplicate selected minidump stream'); streams.set(type, { rva, size }); }
  }
  const exception = streams.get(6);
  if (!exception || exception.size < 168) throw Error('Minidump exception stream missing/truncated');
  const e = exception.rva, parameters = bytes.readUInt32LE(e + 32);
  if (parameters > 15) throw Error('Minidump exception parameter count invalid');
  range(bytes.readUInt32LE(e + 164), bytes.readUInt32LE(e + 160));
  const address = bytes.readBigUInt64LE(e + 24);
  const result = { threadId: bytes.readUInt32LE(e), exceptionCode: '0x' + bytes.readUInt32LE(e + 8).toString(16).padStart(8, '0'), exceptionAddress: '0x' + address.toString(16).padStart(16, '0'), faultModule: null };
  const modules = streams.get(4);
  if (modules) {
    if (modules.size < 4) throw Error('Minidump module list truncated');
    const moduleCount = bytes.readUInt32LE(modules.rva);
    if (moduleCount > LIMITS.modules || modules.size < 4 + moduleCount * 108) throw Error('Minidump module count invalid');
    for (let index = 0; index < moduleCount; index++) {
      const m = modules.rva + 4 + index * 108, base = bytes.readBigUInt64LE(m), size = BigInt(bytes.readUInt32LE(m + 8)), nameRva = bytes.readUInt32LE(m + 20);
      range(nameRva, 4); const nameSize = bytes.readUInt32LE(nameRva);
      if (nameSize > LIMITS.stringBytes || nameSize % 2) throw Error('Minidump module string bound invalid');
      range(nameRva + 4, nameSize);
      const name = path.win32.basename(bytes.toString('utf16le', nameRva + 4, nameRva + 4 + nameSize));
      if (address >= base && address - base < size) {
        if (result.faultModule) throw Error('Minidump address matches overlapping modules');
        result.faultModule = { name, base: '0x' + base.toString(16), offset: '0x' + (address - base).toString(16) };
      }
    }
  }
  const misc = streams.get(15);
  if (misc) {
    if (misc.size < 24 || bytes.readUInt32LE(misc.rva) < 24 || bytes.readUInt32LE(misc.rva) > misc.size) throw Error('Minidump MiscInfo bound invalid');
    const flags = bytes.readUInt32LE(misc.rva + 4);
    if (flags & 1) result.processId = bytes.readUInt32LE(misc.rva + 8);
    if (flags & 2) result.processCreateTime = bytes.readUInt32LE(misc.rva + 12);
  }
  return result;
}

function associateDump(summary, identity) {
  if (!Number.isSafeInteger(summary.processId) || !Number.isSafeInteger(summary.processCreateTime)) return { status: 'unqualified', reason: 'Dump lacks flagged process identity/time' };
  if (summary.processId !== identity.pid || !validBirth(identity.creation)) return { status: 'unqualified', reason: 'Dump process identity mismatch' };
  const nativeSecond = (BigInt(identity.creation) - 621355968000000000n) / 10000000n;
  if (nativeSecond !== BigInt(summary.processCreateTime)) return { status: 'unqualified', reason: 'Dump process creation second mismatch' };
  return { status: 'candidate', pid: identity.pid, nativeCreation: identity.creation, precision: 'seconds-only; not native exit/kill authority' };
}

function qualifiedEvent(row, identities, started, finished) {
  if (!row || row.eventId !== 1000 || !Number.isSafeInteger(row.pid) || !validBirth(row.creation) || typeof row.xml !== 'string' || Buffer.byteLength(row.xml) > LIMITS.xmlBytes) return undefined;
  const time = Date.parse(row.time);
  if (!Number.isFinite(time) || time < Date.parse(started) || time > Date.parse(finished)) return undefined;
  const identity = identities.find(item => item.pid === row.pid && samePath(item.execPath, row.execPath) && validBirth(item.creation) && BigInt(item.creation) / 10n === BigInt(row.creation) / 10n);
  if (!identity || !/^(?:0x)?[0-9a-f]{8}$/i.test(row.exceptionCode || '') || !/^(?:0x)?[0-9a-f]{1,16}$/i.test(row.faultingOffset || '') || typeof row.moduleName !== 'string' || row.moduleName.length > 4096) return undefined;
  return { ...row, moduleName: path.win32.basename(row.moduleName), ownership: { pid: identity.pid, creation: identity.creation, precision: 'matching captured native microsecond' } };
}

function eventQuerySource(identities, started, finished) {
  const encoded = Buffer.from(JSON.stringify(identities)).toString('base64');
  return `$ErrorActionPreference='Stop';$owners=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')));$rows=@();$unknown=0;$events=@();try{$events=@(Get-WinEvent -FilterHashtable @{LogName='Application';ProviderName='Application Error';Id=1000;StartTime=[DateTime]::Parse('${started}');EndTime=[DateTime]::Parse('${finished}')} -MaxEvents 128 -ErrorAction Stop)}catch{if($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*'){throw}};foreach($event in $events){try{$raw=$event.ToXml();if([Text.Encoding]::UTF8.GetByteCount($raw) -gt ${LIMITS.xmlBytes}){$unknown++;continue};[xml]$xml=$raw;$fields=@{};foreach($field in $xml.Event.EventData.Data){$fields[$field.Name]=[string]$field.InnerText};$appPid=0;if($fields.ProcessId -match '^0x([0-9a-fA-F]{1,8})$'){$appPid=[Convert]::ToUInt32($Matches[1],16)}elseif($fields.ProcessId -match '^\\d{1,10}$'){$appPid=[uint32]$fields.ProcessId}else{$unknown++;continue};if($fields.ProcessCreationTime -notmatch '^(?:0x)?([0-9a-fA-F]{1,16})$'){$unknown++;continue};$birth=[DateTime]::FromFileTimeUtc([Convert]::ToInt64($Matches[1],16)).Ticks;$owner=$owners|Where-Object{$_.pid -eq $appPid -and $_.execPath -eq $fields.AppPath -and [decimal]::Truncate([decimal]$_.creation/10) -eq [decimal]::Truncate([decimal]$birth/10)};if(!$owner){continue};$rows+=@{eventId=1000;recordId=[string]$event.RecordId;time=[string]$xml.Event.System.TimeCreated.SystemTime;pid=$appPid;creation=[string]$birth;execPath=$fields.AppPath;exceptionCode=$fields.ExceptionCode;faultingOffset=$fields.FaultingOffset;moduleName=$fields.ModuleName;xml=$raw}}catch{$unknown++}};ConvertTo-Json -InputObject @{events=@($rows);examined=$events.Count;unknown=$unknown;capped=($events.Count -eq 128)} -Depth 5 -Compress`;
}
function queryEvents(source, env) {
  return new Promise((resolve, reject) => cp.execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { env, windowsHide: true, timeout: LIMITS.helperMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => { if (error) reject(error); else { try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); } } }));
}
function checkedPath(root, file) {
  const absolute = path.resolve(file), boundary = fs.realpathSync.native(root);
  if (!within(root, absolute)) throw Error('Diagnostic path escaped private root');
  const relative = path.relative(path.resolve(root), absolute);
  let current = path.resolve(root);
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Diagnostic path is redirected');
  }
  const canonical = fs.realpathSync.native(absolute);
  if (!within(boundary, canonical)) throw Error('Diagnostic canonical path escaped private root');
  return canonical;
}
function readBounded(root, file, limit) {
  const canonical = checkedPath(root, file), before = fs.lstatSync(canonical, { bigint: true });
  if (!before.isFile() || before.size > BigInt(limit)) throw Error('Diagnostic file type/size bound invalid');
  const fd = fs.openSync(canonical, 'r');
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.birthtimeNs !== before.birthtimeNs || !opened.isFile() || opened.size > BigInt(limit)) throw Error('Diagnostic file changed before open');
    const bytes = Buffer.alloc(Number(opened.size) + 1); let length = 0;
    while (length < bytes.length) { const count = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    const after = fs.fstatSync(fd, { bigint: true });
    if (length !== Number(opened.size) || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || checkedPath(root, file) !== canonical) throw Error('Diagnostic file changed during read');
    const current = fs.lstatSync(canonical, { bigint: true });
    if (current.dev !== opened.dev || current.ino !== opened.ino || current.birthtimeNs !== opened.birthtimeNs) throw Error('Diagnostic file identity changed during read');
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}
function readReceipts(root, directory, match) {
  const result = [], errors = []; let count = 0;
  const handle = fs.opendirSync(checkedPath(root, directory));
  try { for (let entry; (entry = handle.readSync());) { if (++count > LIMITS.entries) throw Error('Diagnostic receipt entry bound exceeded'); if (!match.test(entry.name)) continue; try { result.push(JSON.parse(readBounded(root, path.join(directory, entry.name), 2 * 1024 * 1024).toString('utf8'))); } catch (error) { errors.push({ file: entry.name, error: message(error) }); } } } finally { handle.closeSync(); }
  return { result, errors };
}
function scanDumps(root, directory, errors) {
  const files = []; let count = 0;
  function visit(folder, depth) {
    if (depth > LIMITS.depth) { errors.push({ error: 'Dump depth bound exceeded' }); return; }
    const handle = fs.opendirSync(checkedPath(root, folder));
    try { for (let entry; (entry = handle.readSync());) {
      if (++count > LIMITS.entries) throw Error('Dump entry bound exceeded');
      const file = path.join(folder, entry.name);
      try { const stat = fs.lstatSync(file); if (stat.isSymbolicLink()) throw Error('Dump scan rejects redirected entry'); if (stat.isDirectory()) visit(file, depth + 1); else if (stat.isFile() && /\.dmp$/i.test(entry.name)) files.push(file); } catch (error) { errors.push({ file: path.relative(directory, file), error: message(error) }); }
    } } finally { handle.closeSync(); }
  }
  if (fs.existsSync(directory)) visit(directory, 0);
  return files;
}

async function collectWindowsCrashDiagnostics(options) {
  // Caller-provided environment cannot turn a local run into an authorized CI run.
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows') return { status: 'unavailable', reason: 'Passive collection is Windows GitHub Actions only', helperLaunched: false };
  const { privateRoot, output, started, finished, shutdownDirectory, env } = options;
  const report = { status: 'not-observed', events: [], dumps: [], errors: [], limits: LIMITS, absenceMeaning: 'No matching diagnostic observed; not proof of no crash', causeEstablished: false };
  if (!privateRoot || !shutdownDirectory || !Number.isFinite(Date.parse(started)) || !Number.isFinite(Date.parse(finished)) || Date.parse(finished) < Date.parse(started)) throw Error('Diagnostic collection window/root invalid');
  const target = fs.mkdtempSync(path.join(checkedPath(output, output), 'crash-diagnostics-'));
  report.directory = target;
  const shutdown = readReceipts(privateRoot, shutdownDirectory, /^electron-shutdown-.*\.json$/), paths = readReceipts(privateRoot, shutdownDirectory, /^ide-native-paths-\d+\.json$/);
  report.errors.push(...shutdown.errors, ...paths.errors);
  const identities = shutdown.result.map(item => item.native).filter(item => item && Number.isSafeInteger(item.pid) && item.pid > 0 && Number.isSafeInteger(item.ppid) && item.ppid > 0 && validBirth(item.creation) && typeof item.execPath === 'string' && path.win32.isAbsolute(item.execPath));
  if (!identities.length) { report.status = 'unavailable'; report.errors.push({ error: 'No captured native identity; no OS query authorized' }); return report; }
  const helperHome = path.join(privateRoot, 'crash-diagnostic-helper');
  fs.mkdirSync(helperHome, { recursive: false });
  checkedPath(privateRoot, helperHome);
  const helperEnv = { ...env, HOME: helperHome, USERPROFILE: helperHome, APPDATA: path.join(helperHome, 'AppData/Roaming'), LOCALAPPDATA: path.join(helperHome, 'AppData/Local'), TEMP: path.join(helperHome, 'Temp'), TMP: path.join(helperHome, 'Temp'), TMPDIR: path.join(helperHome, 'Temp') };
  for (const directory of [helperEnv.APPDATA, helperEnv.LOCALAPPDATA, helperEnv.TEMP]) fs.mkdirSync(directory, { recursive: true });
  try {
    report.helperLaunched = true;
    const result = await queryEvents(eventQuerySource(identities, new Date(started).toISOString(), new Date(finished).toISOString()), helperEnv);
    if (!result || !Array.isArray(result.events) || result.events.length > 128 || !Number.isSafeInteger(result.examined) || result.examined < 0 || result.examined > 128 || !Number.isSafeInteger(result.unknown) || result.unknown < 0 || result.unknown > 128 || typeof result.capped !== 'boolean') throw Error('Event query result invalid');
    report.eventQuery = { examined: result.examined, unknown: result.unknown, capped: result.capped };
    for (const row of result.events) {
      const qualified = qualifiedEvent(row, identities, started, finished);
      if (!qualified) { report.errors.push({ error: 'Returned event did not match complete native identity/bounds' }); continue; }
      const bytes = Buffer.from(qualified.xml), file = path.join(target, `application-error-${qualified.pid}-${report.events.length}.xml`);
      fs.writeFileSync(file, bytes, { flag: 'wx' });
      const { xml, ...detail } = qualified; report.events.push({ ...detail, file, bytes: bytes.length, sha256: sha256(bytes) });
    }
  } catch (error) { report.errors.push({ source: 'event-query', error: message(error) }); }
  let copied = 0;
  for (const identity of identities) {
    const receipt = paths.result.find(row => row.pid === identity.pid && row.mode === 'existing-E2E-fixtures; isolation-only-bootstrap' && samePath(row.main, path.join(privateRoot, 'app/widget/out/main/index.js')) && samePath(row.ragRoot, privateRoot) && row.paths && row.expectedPaths && typeof row.paths.crashDumps === 'string' && typeof row.paths.userData === 'string' && samePath(row.paths.crashDumps, row.expectedPaths.crashDumps) && samePath(row.paths.crashDumps, path.join(row.paths.userData, 'CrashDumps')) && within(privateRoot, row.paths.crashDumps) && within(privateRoot, row.paths.userData));
    if (!receipt) { report.errors.push({ pid: identity.pid, source: 'dump-path', error: 'No matching private crashDumps path receipt' }); continue; }
    try {
      for (const file of scanDumps(privateRoot, receipt.paths.crashDumps, report.errors)) {
        try {
          const bytes = readBounded(privateRoot, file, LIMITS.dumpBytes);
          if (copied + bytes.length > LIMITS.totalBytes) throw Error('Aggregate dump copy bound exceeded');
          const destination = path.join(target, `dump-${identity.pid}-${report.dumps.length}.dmp`);
          fs.writeFileSync(destination, bytes, { flag: 'wx' }); copied += bytes.length;
          const record = { file: destination, source: path.relative(privateRoot, file), bytes: bytes.length, sha256: sha256(bytes), association: { status: 'unqualified', reason: 'Not parsed' } };
          try { record.summary = summarizeMinidump(bytes); record.association = associateDump(record.summary, identity); } catch (error) { record.parseError = message(error); }
          report.dumps.push(record);
        } catch (error) { report.errors.push({ source: 'dump-copy', error: message(error) }); }
      }
    } catch (error) { report.errors.push({ pid: identity.pid, source: 'dump-scan', error: message(error) }); }
  }
  report.status = report.events.length || report.dumps.length ? 'observed' : report.errors.length ? 'incomplete' : 'not-observed';
  if (report.eventQuery?.capped) report.status = 'bounded';
  fs.writeFileSync(path.join(target, 'diagnostics.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}
async function attachCrashDiagnostics(proof, options, collect = collectWindowsCrashDiagnostics) {
  try { proof.crashDiagnostics = await collect(options); } catch (error) { proof.crashDiagnostics = { status: 'error', error: message(error), originalResultPreserved: true, causeEstablished: false }; }
}
module.exports = { LIMITS, summarizeMinidump, associateDump, qualifiedEvent, eventQuerySource, readBounded, collectWindowsCrashDiagnostics, attachCrashDiagnostics };
