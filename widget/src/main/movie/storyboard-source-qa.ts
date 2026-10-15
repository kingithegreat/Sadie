import { grabFrame, contentStdDev, FLAT_FRAME_STDDEV } from '../media-qa';
import { plainBackgroundAccepted } from '../../shared/shot-picture-intent';
import type { AssembledScene } from './storyboard-assembly';
import { storyboardFileDigest } from './storyboard-export-state';

/** Inspect original pictures before speech, captions or title overlays can hide blank art. */
export async function preflightStoryboardPictures(ffmpeg: string, scenes: AssembledScene[]): Promise<{ allPicturesPlain: boolean }> {
  let checked = 0;
  let plain = 0;
  for (const scene of scenes) {
    for (const shot of scene.shots) {
      const label = `${scene.sceneId} / ${shot.shotId}`;
      try {
        if (!shot.frameImagePath) throw new Error('The picture is missing.');
        const pixels = await grabFrame(ffmpeg, shot.frameImagePath, 0);
        const variation = contentStdDev(pixels);
        checked++;
        if (variation < FLAT_FRAME_STDDEV) plain++;
        if (variation < FLAT_FRAME_STDDEV &&
            !plainBackgroundAccepted(shot.plainBackgroundSha256, await storyboardFileDigest(shot.frameImagePath))) {
          throw new Error('The picture is a plain color with no scene detail. Replace or regenerate it, or select "Use a plain background for this shot" in its shot editor if this is intentional. Any previous export is unchanged.');
        }
      } catch (error) {
        throw new Error(`Check the picture for ${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { allPicturesPlain: checked > 0 && plain === checked };
}
