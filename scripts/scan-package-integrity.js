#!/usr/bin/env node
'use strict';
// Read-only electron-builder scan: no extraction, npm or child processes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const LIMITS = Object.freeze({ header: 16 * 1024 * 1024, entries: 200_000,
  depth: 128, path: 4096, bytes: 64 * 1024 * 1024 * 1024, chunk: 64 * 1024 });
// Preserve the previous case-sensitive basename policy, including directories.
const FORBIDDEN = ['__tests__', 'mocks', '.test.tsx', '.spec.ts', '.e2e.spec.ts'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function check(condition, message) { if (!condition) throw new Error(message); }
function integer(value, label) {
  check(Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.bytes, `Invalid ${label} size/offset`);
  return value;
}
function component(name) {
  check(typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..'
    && !/[\\/\x00-\x1f<>:"|?*]/.test(name) && !/[. ]$/.test(name)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name), `Unsafe archive entry path: ${name}`);
}
function archiveName(name) {
  check(typeof name === 'string' && name.length <= LIMITS.path, 'Invalid archive link/path limit');
  const parts = name.split('/'); parts.forEach(component);
  check(parts.length <= LIMITS.depth, 'Archive path depth limit exceeded');
  return parts;
}
function unchanged(before, after, label) {
  check(before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, `${label} changed during integrity scan`);
}
function regular(file, label) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular file, not a link/reparse point`);
  check(fs.realpathSync(file) === path.resolve(file), `${label} has redirected ancestry`);
  return stat;
}
function findApplicationArchive(distDir) {
  const candidates = [], stack = [{ dir: path.resolve(distDir), depth: 0 }];
  let entries = 0;
  while (stack.length) {
    const { dir, depth } = stack.pop();
    check(depth <= LIMITS.depth, 'Package discovery depth limit exceeded');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      check(++entries <= LIMITS.entries, 'Package discovery entry limit exceeded');
      const file = path.join(dir, entry.name);
      if (entry.name === 'app.asar' && path.basename(dir).toLowerCase() === 'resources') {
        regular(file, 'Application archive'); candidates.push(file);
      } else if (entry.isDirectory() && entry.name !== 'asar-extract') {
        stack.push({ dir: file, depth: depth + 1 });
      }
    }
  }
  check(candidates.length === 1, candidates.length ? 'Ambiguous package: multiple resources/app.asar application archives'
    : `Missing resources/app.asar application archive under ${distDir}`);
  return candidates[0];
}
// Inspect only fixed eight-byte framing before the official Pickle/JSON parser
// can allocate. Its header length is capped and bound to actual archive length.
function rawHeader(asar, file, fd, size) {
  const framing = Buffer.alloc(8);
  check(fs.readSync(fd, framing, 0, 8, 0) === 8, 'Truncated ASAR header framing');
  const length = framing.readUInt32LE(4);
  check(framing.readUInt32LE(0) === 4 && length >= 8 && length % 4 === 0
    && length <= LIMITS.header && length <= size - 8, 'Invalid ASAR header size or limit');
  asar.uncache(file);
  const raw = asar.getRawHeader(file);
  check(raw.headerSize === length && object(raw.header) && object(raw.header.files), 'Invalid ASAR header');
  return { header: raw.header, dataOffset: 8 + length };
}
function inventory(header, payloadSize) {
  const nodes = new Map(), extents = [];
  let bytes = 0;
  function visit(files, parent, depth) {
    check(depth <= LIMITS.depth, 'Archive header depth limit exceeded');
    const siblings = new Set();
    for (const [name, node] of Object.entries(files)) {
      component(name);
      const folded = name.normalize('NFC').toLowerCase();
      check(!siblings.has(folded), `Ambiguous archive name collision: ${parent}/${name}`);
      siblings.add(folded);
      const relative = parent ? `${parent}/${name}` : name;
      check(relative.length <= LIMITS.path && nodes.size < LIMITS.entries, 'Archive entry/path limit exceeded');
      check(object(node), `Invalid archive header entry: ${relative}`);
      check(!FORBIDDEN.some(fragment => name.includes(fragment)), `Forbidden entry found: ${relative}`);
      const directory = own(node, 'files'), link = own(node, 'link'), file = own(node, 'size');
      check(Number(directory) + Number(link) + Number(file) === 1, `Ambiguous archive entry shape: ${relative}`);
      if (own(node, 'unpacked')) check(typeof node.unpacked === 'boolean', `Invalid unpacked flag: ${relative}`);
      if (directory) {
        check(object(node.files) && !own(node, 'offset') && !own(node, 'integrity'), `Invalid directory header: ${relative}`);
        nodes.set(relative, { kind: 'directory', node }); visit(node.files, relative, depth + 1);
      } else if (link) {
        check(!own(node, 'offset') && !own(node, 'integrity') && !node.unpacked, `Invalid archive link: ${relative}`);
        try { archiveName(node.link); } catch (error) {
          throw new Error(`Invalid archive link target for ${relative}: ${error.message}`);
        }
        nodes.set(relative, { kind: 'link', node });
      } else {
        const size = integer(node.size, `${relative} file`);
        bytes += size; check(bytes <= LIMITS.bytes, 'Total archive payload size limit exceeded');
        let offset;
        if (node.unpacked) check(!own(node, 'offset'), `Invalid unpacked file offset: ${relative}`);
        else {
          check(typeof node.offset === 'string' && /^(0|[1-9]\d*)$/.test(node.offset), `Invalid packed offset: ${relative}`);
          offset = integer(Number(node.offset), `${relative} packed`);
          check(offset <= payloadSize && size <= payloadSize - offset, `Packed payload extent is truncated/out of range: ${relative}`);
          if (size) extents.push({ start: offset, end: offset + size, relative });
        }
        nodes.set(relative, { kind: 'file', node, size, offset });
      }
    }
  }
  visit(header.files, '', 0);
  extents.sort((a, b) => a.start - b.start);
  let packedEnd = 0;
  for (const extent of extents) {
    check(extent.start === packedEnd, `Packed payload gap/overlap: ${extent.relative}`);
    packedEnd = extent.end;
  }
  check(packedEnd === payloadSize, 'Unclaimed/trailing packed payload bytes');
  for (let i = 1; i < extents.length; i++) check(extents[i].start >= extents[i - 1].end, `Overlapping packed payload extents: ${extents[i].relative}`);
  // Rewrite link prefixes to handle directory aliases too; visited paths prevent cycles.
  function resolve(name) {
    const seen = new Set();
    for (let rewrites = 0; rewrites <= LIMITS.depth; rewrites++) {
      check(!seen.has(name), `Archive link cycle: ${name}`); seen.add(name);
      const parts = archiveName(name);
      let redirected = false;
      for (let i = 0; i < parts.length; i++) {
        const prefix = parts.slice(0, i + 1).join('/'), entry = nodes.get(prefix);
        check(entry, `Missing archive link target: ${prefix}`);
        if (entry.kind === 'link') {
          name = [entry.node.link, ...parts.slice(i + 1)].join('/'); redirected = true; break;
        }
        check(i === parts.length - 1 || entry.kind === 'directory', `Non-directory archive link target: ${prefix}`);
      }
      if (!redirected) return nodes.get(name);
    }
    throw new Error('Archive link resolution depth limit exceeded');
  }
  const targets = new Map();
  for (const [name, entry] of nodes) if (entry.kind === 'link') targets.set(entry, resolve(name));
  // A directory alias can create a traversal cycle without a link-to-link cycle
  // (for example d/alias -> d). Check the resolved directory graph as well.
  const colors = new Map();
  const names = new Map([...nodes].map(([name, entry]) => [entry, name]));
  function visitGraph(entry, depth) {
    const name = names.get(entry);
    check(colors.get(entry) !== 'visiting', `Archive directory link cycle: ${name}`);
    if (colors.get(entry) === 'done') return;
    check(depth <= LIMITS.depth, 'Archive directory link depth limit exceeded');
    colors.set(entry, 'visiting');
    if (entry.kind === 'link') visitGraph(targets.get(entry), depth + 1);
    else if (entry.kind === 'directory') {
      for (const child of Object.keys(entry.node.files)) {
        visitGraph(nodes.get(`${name}/${child}`), depth + 1);
      }
    }
    colors.set(entry, 'done');
  }
  for (const entry of nodes.values()) visitGraph(entry, 0);
  return { nodes, bytes };
}
function integrityMetadata(value, size, relative) {
  if (value === undefined) return null; // Optional in legacy archives.
  check(object(value) && value.algorithm === 'SHA256' && typeof value.hash === 'string'
    && /^[a-f0-9]{64}$/i.test(value.hash) && Number.isSafeInteger(value.blockSize)
    && value.blockSize > 0 && value.blockSize <= LIMITS.bytes && Array.isArray(value.blocks), `Invalid declared integrity: ${relative}`);
  // Official writer includes a final empty block for zero/exact-multiple sizes.
  const minimum = Math.ceil(size / value.blockSize), maximum = Math.floor(size / value.blockSize) + 1;
  check(value.blocks.length >= minimum && value.blocks.length <= maximum && value.blocks.length <= LIMITS.entries
    && value.blocks.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash)), `Invalid integrity block count/hash: ${relative}`);
  return value;
}
function readPayload(fd, start, size, declared, relative, buffer) {
  const integrity = integrityMetadata(declared, size, relative);
  const full = integrity && crypto.createHash('sha256');
  let block = integrity && crypto.createHash('sha256'), blockBytes = 0, blockIndex = 0;
  function finishBlock() {
    check(block.digest('hex').toLowerCase() === integrity.blocks[blockIndex]?.toLowerCase(), `Integrity block hash mismatch: ${relative}`);
    blockIndex++; blockBytes = 0; block = crypto.createHash('sha256');
  }
  for (let consumed = 0; consumed < size;) {
    const length = Math.min(buffer.length, size - consumed);
    check(fs.readSync(fd, buffer, 0, length, start + consumed) === length, `Short/truncated payload read: ${relative}`);
    const chunk = buffer.subarray(0, length);
    if (integrity) {
      full.update(chunk);
      for (let position = 0; position < length;) {
        const count = Math.min(length - position, integrity.blockSize - blockBytes);
        block.update(chunk.subarray(position, position + count)); blockBytes += count; position += count;
        if (blockBytes === integrity.blockSize) finishBlock();
      }
    }
    consumed += length;
  }
  if (integrity) {
    if (blockBytes || blockIndex < integrity.blocks.length) finishBlock();
    check(blockIndex === integrity.blocks.length && full.digest('hex').toLowerCase() === integrity.hash.toLowerCase(), `Integrity file hash mismatch: ${relative}`);
  }
}
function unpackedFile(root, relative) {
  const parts = archiveName(relative);
  let current = root;
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i]);
    const stat = fs.lstatSync(current);
    check(!stat.isSymbolicLink() && fs.realpathSync(current) === path.resolve(current), `Unpacked link/redirected ancestor: ${relative}`);
    check(i === parts.length - 1 ? stat.isFile() : stat.isDirectory(), `Invalid unpacked file/ancestor: ${relative}`);
  }
  check(current.startsWith(root + path.sep), `Unpacked path escape: ${relative}`);
  return current;
}
function scanPackage(distDir, asar = createRequire(path.join(__dirname, '..', 'widget', 'package.json'))('@electron/asar')) {
  const archive = findApplicationArchive(distDir), before = regular(archive, 'Application archive');
  integer(before.size, 'Archive');
  const fd = fs.openSync(archive, 'r');
  try {
    unchanged(before, fs.fstatSync(fd), 'Application archive');
    const { header, dataOffset } = rawHeader(asar, archive, fd, before.size);
    const { nodes, bytes } = inventory(header, before.size - dataOffset);
    const buffer = Buffer.alloc(LIMITS.chunk);
    let files = 0;
    for (const [relative, entry] of nodes) {
      if (entry.kind !== 'file') continue;
      files++;
      if (entry.node.unpacked) {
        const file = unpackedFile(archive + '.unpacked', relative), stat = regular(file, `Unpacked ${relative}`);
        check(stat.size === entry.size, `Unpacked payload size mismatch: ${relative}`);
        const unpacked = fs.openSync(file, 'r');
        try {
          unchanged(stat, fs.fstatSync(unpacked), `Unpacked ${relative}`);
          readPayload(unpacked, 0, entry.size, entry.node.integrity, relative, buffer);
          unchanged(stat, fs.fstatSync(unpacked), `Unpacked ${relative}`);
          unchanged(stat, regular(file, `Unpacked ${relative}`), `Unpacked ${relative}`);
        } finally { fs.closeSync(unpacked); }
      } else readPayload(fd, dataOffset + entry.offset, entry.size, entry.node.integrity, relative, buffer);
    }
    unchanged(before, fs.fstatSync(fd), 'Application archive');
    unchanged(before, regular(archive, 'Application archive'), 'Application archive');
    return { archive, entries: nodes.size, files, bytes };
  } finally { fs.closeSync(fd); asar.uncache(archive); }
}
function main() {
  const widget = path.join(__dirname, '..', 'widget');
  const dist = ['dist-electron', 'dist'].map(name => path.join(widget, name)).find(dir => fs.existsSync(dir));
  check(dist, 'No packaged output directory found (expected widget/dist-electron or widget/dist).');
  const result = scanPackage(dist);
  console.log('[PACKAGE SCAN] Verified application archive:', result.archive);
  console.log(`[PACKAGE SCAN] Read ${result.files} files (${result.bytes} bytes) without extraction.`);
  console.log('[PACKAGE SCAN] Package integrity check passed.');
}
module.exports = { scanPackage, findApplicationArchive };
if (require.main === module) {
  try { main(); } catch (error) { console.error('[PACKAGE SCAN] ERROR:', error.message); process.exitCode = 1; }
}
