import { contentStdDev, FLAT_FRAME_STDDEV, grabFrame } from './media-qa';
import type { SceneImage } from './media-visuals';
import { SCENE_PICTURE_FAILURE } from '../shared/scene-picture-qa';

/** Validate the actual frozen scene pictures, before captions can conceal missing art. */
export async function preflightScenePictures(ffmpeg: string, images: SceneImage[]): Promise<void> {
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    try {
      if (!image.path) throw new Error('The scene picture is missing.');
      if (image.source === 'fallback-plate' || image.error) {
        throw new Error('Scene generation failed and did not produce usable scene art.');
      }
      const pixels = await grabFrame(ffmpeg, image.path, 0);
      if (contentStdDev(pixels) < FLAT_FRAME_STDDEV) {
        throw new Error('The scene picture is a plain color with no scene detail.');
      }
    } catch (error) {
      throw Object.assign(new Error(`Check the picture for scene ${index + 1}: ${error instanceof Error ? error.message : String(error)} Replace or regenerate its scene art before making the video. Choose "Regenerate scene pictures" to request new pictures. Any previous export is unchanged.`), { code: SCENE_PICTURE_FAILURE });
    }
  }
}
