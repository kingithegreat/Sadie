import type {
  CameraMotion,
  CharacterDepthStaging,
  MultiPlaneShotManifest,
} from '../movie/types';

export function validateMultiPlaneShot(shot: MultiPlaneShotManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!shot.shotId) errors.push('shotId is required');
  if (!shot.seriesId) errors.push('seriesId is required');
  if (!shot.settingId) errors.push('settingId is required');
  if (typeof shot.durationSec !== 'number' || shot.durationSec <= 0) {
    errors.push('durationSec must be a positive number');
  }

  const validMotions: CameraMotion[] = ['pan_left', 'pan_right', 'zoom_in', 'zoom_out', 'static'];
  if (!validMotions.includes(shot.cameraMotion)) {
    errors.push(`Invalid cameraMotion: ${shot.cameraMotion}`);
  }

  if (shot.character) {
    const c = shot.character;
    if (!c.characterId) errors.push('character.characterId is required');
    if (typeof c.xPercent !== 'number' || c.xPercent < 0 || c.xPercent > 100) {
      errors.push('character.xPercent must be between 0 and 100');
    }
    if (typeof c.yPercent !== 'number' || c.yPercent < 0 || c.yPercent > 100) {
      errors.push('character.yPercent must be between 0 and 100');
    }
    const validDepths: CharacterDepthStaging[] = ['midground_behind_fg', 'foreground_in_front_of_fg'];
    if (!validDepths.includes(c.depth)) {
      errors.push(`Invalid character.depth: ${c.depth}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

describe('MultiPlaneShotManifest Schema Validation', () => {
  it('accepts a valid multi-plane shot specification', () => {
    const shot: MultiPlaneShotManifest = {
      shotId: 'shot_01',
      sceneId: 'scene_01',
      seriesId: 'ancient_egypt',
      settingId: 'imhotep_workshop',
      durationSec: 4.5,
      cameraMotion: 'pan_left',
      framing: 'medium',
      character: {
        characterId: 'imhotep',
        pose: 'examining_plans',
        xPercent: 50,
        yPercent: 65,
        scale: 0.85,
        depth: 'midground_behind_fg',
      },
    };

    const result = validateMultiPlaneShot(shot);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid camera motion and out-of-range coordinates', () => {
    const shot: MultiPlaneShotManifest = {
      shotId: 'shot_bad',
      sceneId: 'scene_01',
      seriesId: 'rome',
      settingId: 'senate',
      durationSec: -1,
      cameraMotion: 'barrel_roll' as any,
      framing: 'wide',
      character: {
        characterId: 'caesar',
        pose: 'stand',
        xPercent: 120,
        yPercent: -5,
        scale: 1.0,
        depth: 'flying' as any,
      },
    };

    const result = validateMultiPlaneShot(shot);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('durationSec must be a positive number');
    expect(result.errors).toContain('Invalid cameraMotion: barrel_roll');
    expect(result.errors).toContain('character.xPercent must be between 0 and 100');
    expect(result.errors).toContain('character.yPercent must be between 0 and 100');
    expect(result.errors).toContain('Invalid character.depth: flying');
  });
});
