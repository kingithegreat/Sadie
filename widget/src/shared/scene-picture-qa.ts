/** Stable identification for source-picture failure and its explicit recovery action. */
export const SCENE_PICTURE_FAILURE = 'SCENE_PICTURE_FAILURE' as const;
export const isScenePictureFailure = (value: unknown): boolean =>
  !!value && typeof value === 'object' && (value as { code?: unknown }).code === SCENE_PICTURE_FAILURE;
