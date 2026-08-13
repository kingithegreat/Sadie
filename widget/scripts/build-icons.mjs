/**
 * Build the application icons from resources/brand/homebot-mark.svg.
 *
 * The icons that shipped were a letter "S" — left over from the SADIE name and
 * wrong on the taskbar, the installer, the window and the shortcut ever since
 * the rename. They were also binaries with no source, so nobody could adjust
 * them. This regenerates every raster from one vector, which is the part worth
 * keeping: run it again after editing the SVG and every size stays in step.
 *
 *   node scripts/build-icons.mjs
 *
 * Writes:
 *   resources/icon.png        512  — the window/tray image
 *   build/icon.ico            16..256 — electron-builder's Windows icon
 *
 * The .ico is assembled here rather than by a dependency: sharp has no ICO
 * encoder, and the container is simple enough that adding a package for it
 * would be the larger risk. Every entry is a PNG payload, which Windows has
 * accepted since Vista and which keeps the 256 crisp.
 */

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const widget = path.resolve(here, '..');
const repo = path.resolve(widget, '..');

const SVG = path.join(widget, 'resources', 'brand', 'homebot-mark.svg');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Rasterise at a high density so the curves are resolved before downscaling. */
const render = (svg, size) =>
  sharp(svg, { density: 600 }).resize(size, size, { fit: 'contain' }).png({ compressionLevel: 9 }).toBuffer();

/**
 * Wrap PNG buffers in an ICO container.
 *
 * Layout: a 6-byte ICONDIR, then one 16-byte ICONDIRENTRY per image, then the
 * payloads. A dimension of 256 is written as 0 — the field is a single byte, so
 * 256 does not fit and 0 is defined to mean it.
 */
function buildIco(images) {
  const HEADER = 6;
  const ENTRY = 16;
  const dir = Buffer.alloc(HEADER + ENTRY * images.length);

  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // 1 = icon
  dir.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  images.forEach(({ size, data }, i) => {
    const at = HEADER + ENTRY * i;
    dir.writeUInt8(size >= 256 ? 0 : size, at);
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
    dir.writeUInt8(0, at + 2); // palette size — 0 for true colour
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([dir, ...images.map((i) => i.data)]);
}

async function main() {
  if (!fs.existsSync(SVG)) throw new Error(`Missing source vector: ${SVG}`);
  const svg = fs.readFileSync(SVG);

  const images = [];
  for (const size of ICO_SIZES) {
    images.push({ size, data: await render(svg, size) });
  }

  const ico = buildIco(images);

  // Both copies are real: electron-builder reads widget/build, and the repo
  // root carries its own pair that other tooling points at.
  const icoTargets = [path.join(widget, 'build', 'icon.ico'), path.join(repo, 'build', 'icon.ico')];
  const pngTargets = [path.join(widget, 'resources', 'icon.png'), path.join(repo, 'resources', 'icon.png')];

  const png512 = await render(svg, 512);

  for (const target of icoTargets) {
    if (!fs.existsSync(path.dirname(target))) continue;
    fs.writeFileSync(target, ico);
    console.log(`wrote ${path.relative(repo, target)}  ${ico.length} bytes, ${ICO_SIZES.length} sizes`);
  }
  for (const target of pngTargets) {
    if (!fs.existsSync(path.dirname(target))) continue;
    fs.writeFileSync(target, png512);
    console.log(`wrote ${path.relative(repo, target)}  ${png512.length} bytes, 512x512`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
