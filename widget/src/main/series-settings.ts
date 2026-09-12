/**
 * series-settings.ts — First-class Settings & Stage Sets Catalog for Series Production.
 *
 * Provides persistent storage and retrieval of reusable stage environments (Settings)
 * under `userData/series/<seriesId>/settings/<settingId>/`.
 *
 * Each setting defines:
 *   - bg.png: Background wall, landscape, sky, and room architecture
 *   - fg.png: Optional foreground occlusion layer (desk, table, railing, pillar)
 *   - setting.json: Canonical metadata, camera setups, and bounding planes
 *   - lighting.json: Ambient lighting CSS filter parameters and floor contact shadow profiles
 *   - preview.png: Composite reference image for UI selection
 *
 * Compositing runs zero-VRAM on Remotion/CSS, using the CSS filter and contact shadow
 * profiles defined here.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface SettingLighting {
  preset: 'torchlight' | 'daylight' | 'moonlight' | 'studio_warm' | 'scifi_cool' | 'custom';
  brightness: number;    // e.g. 1.08
  contrast: number;      // e.g. 1.05
  sepia: number;         // e.g. 0.15
  hueRotateDeg: number;  // e.g. -5
  saturate: number;      // e.g. 1.02
  shadowColor: string;   // e.g. "rgba(18, 14, 20, 0.45)"
  shadowBlurPx: number;  // e.g. 10
  shadowOpacity: number; // e.g. 0.35
  shadowScaleX: number;  // e.g. 0.85
  shadowScaleY: number;  // e.g. 0.25
  shadowOffsetYPercent?: number; // e.g. 2.0
}

export type CameraFraming = 'wide' | 'medium' | 'close' | 'two' | 'ots';

export interface SettingManifest {
  id: string;
  seriesId: string;
  name: string;
  description: string;
  cameraSetups?: CameraFraming[];
  hasForeground: boolean;
  lighting: SettingLighting;
  createdAt: string;
  updatedAt: string;
}

export interface SettingBundle {
  manifest: SettingManifest;
  dirPath: string;
  bgPath: string;
  fgPath?: string;
  previewPath?: string;
}

export const LIGHTING_PRESETS: Record<SettingLighting['preset'], SettingLighting> = {
  torchlight: {
    preset: 'torchlight',
    brightness: 1.08,
    contrast: 1.10,
    sepia: 0.22,
    hueRotateDeg: -8,
    saturate: 1.15,
    shadowColor: 'rgba(25, 15, 10, 0.45)',
    shadowBlurPx: 12,
    shadowOpacity: 0.40,
    shadowScaleX: 0.85,
    shadowScaleY: 0.25,
    shadowOffsetYPercent: 2.0,
  },
  daylight: {
    preset: 'daylight',
    brightness: 1.02,
    contrast: 1.02,
    sepia: 0.04,
    hueRotateDeg: 0,
    saturate: 1.02,
    shadowColor: 'rgba(15, 20, 30, 0.35)',
    shadowBlurPx: 8,
    shadowOpacity: 0.30,
    shadowScaleX: 0.80,
    shadowScaleY: 0.20,
    shadowOffsetYPercent: 1.5,
  },
  moonlight: {
    preset: 'moonlight',
    brightness: 0.88,
    contrast: 1.15,
    sepia: 0.05,
    hueRotateDeg: 190,
    saturate: 0.80,
    shadowColor: 'rgba(5, 10, 25, 0.50)',
    shadowBlurPx: 14,
    shadowOpacity: 0.45,
    shadowScaleX: 0.90,
    shadowScaleY: 0.25,
    shadowOffsetYPercent: 2.5,
  },
  studio_warm: {
    preset: 'studio_warm',
    brightness: 1.05,
    contrast: 1.05,
    sepia: 0.10,
    hueRotateDeg: -4,
    saturate: 1.05,
    shadowColor: 'rgba(20, 20, 20, 0.30)',
    shadowBlurPx: 10,
    shadowOpacity: 0.30,
    shadowScaleX: 0.85,
    shadowScaleY: 0.25,
    shadowOffsetYPercent: 2.0,
  },
  scifi_cool: {
    preset: 'scifi_cool',
    brightness: 1.04,
    contrast: 1.12,
    sepia: 0.02,
    hueRotateDeg: 175,
    saturate: 1.10,
    shadowColor: 'rgba(10, 20, 35, 0.40)',
    shadowBlurPx: 10,
    shadowOpacity: 0.35,
    shadowScaleX: 0.85,
    shadowScaleY: 0.25,
    shadowOffsetYPercent: 2.0,
  },
  custom: {
    preset: 'custom',
    brightness: 1.0,
    contrast: 1.0,
    sepia: 0.0,
    hueRotateDeg: 0,
    saturate: 1.0,
    shadowColor: 'rgba(0, 0, 0, 0.35)',
    shadowBlurPx: 10,
    shadowOpacity: 0.30,
    shadowScaleX: 0.85,
    shadowScaleY: 0.25,
    shadowOffsetYPercent: 2.0,
  },
};

/**
 * Returns the base directory for series settings storage.
 */
export function getSeriesStorageBaseDir(): string {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'series');
    }
  } catch {
    /* non-electron environment (tests, scripts) */
  }

  const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  return path.join(appData, 'HomeBot', 'series');
}

/**
 * Resolves the directory for a specific setting in a series.
 */
export function resolveSettingDir(seriesId: string, settingId: string, baseDir?: string): string {
  const root = baseDir || getSeriesStorageBaseDir();
  const cleanSeries = seriesId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const cleanSetting = settingId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return path.join(root, cleanSeries, 'settings', cleanSetting);
}

/**
 * Builds the CSS filter string matching the lighting profile for Remotion character sprites.
 */
export function buildCssFilter(lighting: SettingLighting): string {
  const b = lighting.brightness ?? 1.0;
  const c = lighting.contrast ?? 1.0;
  const sep = lighting.sepia ?? 0.0;
  const hue = lighting.hueRotateDeg ?? 0;
  const sat = lighting.saturate ?? 1.0;

  return `brightness(${b}) contrast(${c}) sepia(${sep}) hue-rotate(${hue}deg) saturate(${sat})`;
}

/**
 * Builds contact shadow inline style parameters for zero-VRAM Remotion compositing.
 */
export function buildContactShadowStyle(
  lighting: SettingLighting,
  xPercent: number,
  yPercent: number,
  charScale: number = 1.0,
  baseWidthPx: number = 220
): {
  position: 'absolute';
  left: string;
  top: string;
  width: string;
  height: string;
  borderRadius: string;
  backgroundColor: string;
  filter: string;
  opacity: number;
  transform: string;
  zIndex: number;
} {
  const scaleX = (lighting.shadowScaleX ?? 0.85) * charScale;
  const scaleY = (lighting.shadowScaleY ?? 0.25) * charScale;
  const offsetY = lighting.shadowOffsetYPercent ?? 2.0;
  const widthPx = Math.round(baseWidthPx * scaleX);
  const heightPx = Math.round(baseWidthPx * scaleY);

  return {
    position: 'absolute',
    left: `${xPercent}%`,
    top: `${yPercent + offsetY}%`,
    width: `${widthPx}px`,
    height: `${heightPx}px`,
    borderRadius: '50%',
    backgroundColor: lighting.shadowColor || 'rgba(0, 0, 0, 0.35)',
    filter: `blur(${lighting.shadowBlurPx ?? 10}px)`,
    opacity: lighting.shadowOpacity ?? 0.35,
    transform: 'translate(-50%, -50%)',
    zIndex: 10,
  };
}

/**
 * List all available settings for a series.
 */
export async function listSeriesSettings(seriesId: string, baseDir?: string): Promise<SettingManifest[]> {
  const root = baseDir || getSeriesStorageBaseDir();
  const cleanSeries = seriesId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const settingsDir = path.join(root, cleanSeries, 'settings');

  if (!fs.existsSync(settingsDir)) {
    return [];
  }

  const entries = fs.readdirSync(settingsDir, { withFileTypes: true });
  const results: SettingManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(settingsDir, entry.name, 'setting.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw) as SettingManifest;
        results.push(manifest);
      } catch {
        /* skip corrupt manifest */
      }
    }
  }

  return results;
}

/**
 * Fetch a specific setting bundle by seriesId and settingId.
 */
export async function getSetting(
  seriesId: string,
  settingId: string,
  baseDir?: string
): Promise<SettingBundle | null> {
  const dir = resolveSettingDir(seriesId, settingId, baseDir);
  const manifestPath = path.join(dir, 'setting.json');
  const bgPath = path.join(dir, 'bg.png');

  if (!fs.existsSync(manifestPath) || !fs.existsSync(bgPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as SettingManifest;
    const fgPath = path.join(dir, 'fg.png');
    const previewPath = path.join(dir, 'preview.png');

    return {
      manifest,
      dirPath: dir,
      bgPath,
      fgPath: fs.existsSync(fgPath) ? fgPath : undefined,
      previewPath: fs.existsSync(previewPath) ? previewPath : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Save or update a setting bundle in the catalog.
 */
export async function saveSetting(
  seriesId: string,
  manifestInput: Partial<SettingManifest> & { id: string; name: string },
  bgBuffer: Buffer,
  fgBuffer?: Buffer,
  previewBuffer?: Buffer,
  baseDir?: string
): Promise<SettingBundle> {
  const dir = resolveSettingDir(seriesId, manifestInput.id, baseDir);
  fs.mkdirSync(dir, { recursive: true });

  const bgPath = path.join(dir, 'bg.png');
  fs.writeFileSync(bgPath, bgBuffer);

  let hasForeground = false;
  let fgPath: string | undefined;
  if (fgBuffer && fgBuffer.length > 0) {
    fgPath = path.join(dir, 'fg.png');
    fs.writeFileSync(fgPath, fgBuffer);
    hasForeground = true;
  }

  let previewPath: string | undefined;
  if (previewBuffer && previewBuffer.length > 0) {
    previewPath = path.join(dir, 'preview.png');
    fs.writeFileSync(previewPath, previewBuffer);
  } else {
    // Default preview to bg if not provided
    previewPath = bgPath;
  }

  const now = new Date().toISOString();
  const lightingPreset = manifestInput.lighting?.preset || 'studio_warm';
  const defaultLighting = LIGHTING_PRESETS[lightingPreset] || LIGHTING_PRESETS.studio_warm;

  const fullLighting: SettingLighting = {
    ...defaultLighting,
    ...(manifestInput.lighting || {}),
  };

  const manifest: SettingManifest = {
    id: manifestInput.id,
    seriesId,
    name: manifestInput.name,
    description: manifestInput.description || '',
    cameraSetups: manifestInput.cameraSetups || ['wide', 'medium', 'close'],
    hasForeground,
    lighting: fullLighting,
    createdAt: manifestInput.createdAt || now,
    updatedAt: now,
  };

  const manifestPath = path.join(dir, 'setting.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const lightingPath = path.join(dir, 'lighting.json');
  fs.writeFileSync(lightingPath, JSON.stringify(fullLighting, null, 2), 'utf8');

  return {
    manifest,
    dirPath: dir,
    bgPath,
    fgPath,
    previewPath,
  };
}

/**
 * Delete a setting bundle from disk.
 */
export async function deleteSetting(
  seriesId: string,
  settingId: string,
  baseDir?: string
): Promise<boolean> {
  const dir = resolveSettingDir(seriesId, settingId, baseDir);
  if (!fs.existsSync(dir)) {
    return false;
  }

  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
