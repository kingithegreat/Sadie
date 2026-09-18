/**
 * OPT-IN (HOMEBOT_LIVE=1): burn a title card with the real ffmpeg and look at
 * the pixels.
 *
 *   cd widget && npx cross-env HOMEBOT_LIVE=1 npx jest text-cards-burn.live
 *
 * MS-5's acceptance: rendered frames show the text inside the safe area at 16:9
 * and 9:16, and long text wraps. Layout is measured by Pango, but nothing
 * proves libass drew what was measured except reading the drawn frame — the
 * caption work on this repo shipped a wrong alignment twice before frames were
 * measured.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { buildTextCardAss, SAFE_MARGIN } from '../movie/text-cards';
import { findFfmpeg } from '../media-render';

const live = process.env.HOMEBOT_LIVE === '1';
const maybe = live ? describe : describe.skip;

jest.setTimeout(180_000);

/** Bounding box of everything that is not the flat background colour. */
async function inkBox(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  const rows = new Set<number>();
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const p = (y * info.width + x) * info.channels;
      // Background is a mid grey; text is white with a dark outline.
      const luma = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
      if (luma > 170 || luma < 60) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        rows.add(y);
      }
    }
  }
  return { minX, minY, maxX, maxY, rows, width: info.width, height: info.height };
}

/** How many separate bands of ink there are vertically — one per drawn line. */
function countLines(rows: Set<number>): number {
  const sorted = [...rows].sort((a, b) => a - b);
  let lines = 0;
  let previous = -10;
  for (const row of sorted) {
    if (row - previous > 3) lines++;
    previous = row;
  }
  return lines;
}

maybe('a burned title card', () => {
  const card = {
    heading: 'The Great Pyramid of Giza, last of the Seven Wonders of the Ancient World',
    subline: 'Built for Pharaoh Khufu around 2560 BC',
    position: 'bottom' as const,
  };

  for (const [label, width, height] of [['16:9', 1920, 1080], ['9:16', 1080, 1920]] as const) {
    it(`stays inside the safe area and wraps at ${label}`, async () => {
      const ffmpeg = await findFfmpeg();
      expect(ffmpeg).toBeTruthy();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-card-'));
      try {
        const assPath = path.join(dir, 'cards.ass');
        fs.writeFileSync(assPath, await buildTextCardAss([{ card, startSec: 0, endSec: 2 }], { width, height }), 'utf-8');
        const framePath = path.join(dir, 'frame.png');
        execFileSync(ffmpeg!, [
          '-y', '-f', 'lavfi', '-i', `color=c=0x808080:s=${width}x${height}:d=2`,
          '-vf', `subtitles='${assPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'`,
          '-frames:v', '1', framePath,
        ], { stdio: 'pipe' });

        // Keep the frame when a reviewer asks for it, so the card can be judged
        // by eye and not only by its bounding box.
        if (process.env.HOMEBOT_CARD_PREVIEW_DIR) {
          fs.mkdirSync(process.env.HOMEBOT_CARD_PREVIEW_DIR, { recursive: true });
          fs.copyFileSync(framePath, path.join(process.env.HOMEBOT_CARD_PREVIEW_DIR, `card-${width}x${height}.png`));
        }

        const ink = await inkBox(framePath);
        expect(ink.maxX).toBeGreaterThan(0); // something was drawn at all
        const marginX = width * SAFE_MARGIN, marginY = height * SAFE_MARGIN;
        expect(ink.minX).toBeGreaterThanOrEqual(marginX - 2);
        expect(ink.maxX).toBeLessThanOrEqual(width - marginX + 2);
        expect(ink.minY).toBeGreaterThanOrEqual(marginY - 2);
        expect(ink.maxY).toBeLessThanOrEqual(height - marginY + 2);
        // A heading this long cannot be one line inside the safe width.
        expect(countLines(ink.rows)).toBeGreaterThanOrEqual(3);
        // Bottom position: the block ENDS at the bottom safe line. A long card
        // grows upward from there, so its top is not in the lower half.
        expect(ink.maxY).toBeGreaterThan(height - marginY - height * 0.06);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
