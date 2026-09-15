/**
 * Storyboard frames were always 1024x576, whatever the project exported. A 9:16
 * export then cropped the middle 32% out of every shot - the same centred
 * portrait crop the live multi-output test watched the flat-image QA reject.
 */

import {
  STORYBOARD_FRAME_SIZES,
  storyboardFrameShape,
} from '../movie/storyboard-frame-providers';
import { createStudioOutputSpec } from '../../shared/media-output';

test('frames are drawn in the shape the project exports', () => {
  expect(storyboardFrameShape(createStudioOutputSpec('16:9'))).toMatchObject({ width: 1024, height: 576, aspectRatio: '16:9' });
  expect(storyboardFrameShape(createStudioOutputSpec('9:16'))).toMatchObject({ width: 576, height: 1024, aspectRatio: '9:16' });
  expect(storyboardFrameShape(createStudioOutputSpec('1:1'))).toMatchObject({ width: 768, height: 768, aspectRatio: '1:1' });
});

test('a portrait project no longer asks for a landscape frame', () => {
  const portrait = storyboardFrameShape(createStudioOutputSpec('9:16'));
  expect(portrait.height).toBeGreaterThan(portrait.width);
});

test('every shape costs the same to generate, so a 4 GB card is no worse off sideways', () => {
  const budgets = Object.values(STORYBOARD_FRAME_SIZES).map(s => s.width * s.height);
  expect(Math.max(...budgets)).toBe(Math.min(...budgets));
  for (const size of Object.values(STORYBOARD_FRAME_SIZES)) {
    expect(size.width % 64).toBe(0);
    expect(size.height % 64).toBe(0);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1024);
  }
});

test('with two shapes the first wins and the other is named as cropped', () => {
  const spec = createStudioOutputSpec('16:9');
  const both = { ...spec, variants: [...spec.variants, { ...createStudioOutputSpec('9:16').variants[0] }] };
  const shape = storyboardFrameShape(both);
  expect(shape.aspectRatio).toBe('16:9');
  expect(shape.croppedAspects).toEqual(['9:16']);
});

test('a project with no output spec still gets landscape frames', () => {
  expect(storyboardFrameShape(undefined)).toMatchObject({ width: 1024, height: 576, aspectRatio: '16:9' });
  expect(storyboardFrameShape('legacy-1080p-crop')).toMatchObject({ aspectRatio: '16:9' });
  expect(storyboardFrameShape({ nonsense: true })).toMatchObject({ aspectRatio: '16:9' });
});
