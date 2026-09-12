/**
 * storyboard-assembly.ts — the one place that turns on-disk shot folders into
 * shot objects.
 *
 * Before this existed, the Storyboard Deck's read path (`mediaGetStoryboardHandler`)
 * and the renderer (`renderStoryboardMovie`) each had their own idea of "what are
 * this scene's shots": the editor read real `prompt.json`/`status.json`/`script.txt`
 * files, while the renderer read a separate `manifest.json` that the editor's save
 * path never wrote to. An edit made and saved through the UI was invisible to
 * export. Both now call this module, so there is exactly one on-disk representation
 * of a scene's shots to keep correct.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ShotStatus } from './types';

export interface AssembledShot {
  shotId: string;
  order: number;
  prompt: string;
  framing: string;
  lens: string;
  movement: string;
  durationSec: number;
  narration: string;
  status: string;
  frameImagePath: string | null;
  /** True when a frame exists but was generated from a prompt that has since changed. */
  frameStale: boolean;
}

export interface AssembledScene {
  sceneId: string;
  title?: string;
  description?: string;
  order?: number;
  shots: AssembledShot[];
}

/** Reads scene.json plus each shot's prompt.json/status.json/script.txt/image dir off disk. */
export function assembleScene(projectDir: string, sceneId: string): AssembledScene | null {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(sceneId)) throw new Error('The saved storyboard contains an invalid scene ID.');
  const scenePath = path.join(projectDir, 'scenes', sceneId);
  if (!fs.existsSync(scenePath)) return null;

  let sceneMeta: any = { sceneId };
  const scJson = path.join(scenePath, 'scene.json');
  if (fs.existsSync(scJson)) {
    sceneMeta = JSON.parse(fs.readFileSync(scJson, 'utf-8'));
  }

  const onDisk = fs.readdirSync(scenePath)
    .filter((s) => s.startsWith('shot_') && fs.statSync(path.join(scenePath, s)).isDirectory());

  // Reorder edits are saved into scene.json's `shots` array (shot IDs in the
  // desired order). Retained folders for removed shots are recoverable assets,
  // not instructions to put those shots back into the movie. Older scenes
  // without an explicit shot list keep their directory-based order.
  const shotDirs: string[] = Array.isArray(sceneMeta.shots) ? sceneMeta.shots : onDisk.sort();
  if (shotDirs.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) || new Set(shotDirs).size !== shotDirs.length) {
    throw new Error('The saved storyboard contains invalid or duplicate shot IDs.');
  }

  const shots: AssembledShot[] = shotDirs.map((shotId, idx) => {
    const shotPath = path.join(scenePath, shotId);
    let promptData: any = {};
    let statusData: any = {};
    let narration = '';

    const pFile = path.join(shotPath, 'prompt.json');
    if (fs.existsSync(pFile)) {
      try { promptData = JSON.parse(fs.readFileSync(pFile, 'utf-8')); } catch { /* ignore */ }
    }
    const sFile = path.join(shotPath, 'status.json');
    if (fs.existsSync(sFile)) {
      try { statusData = JSON.parse(fs.readFileSync(sFile, 'utf-8')); } catch { /* ignore */ }
    }
    const scriptFile = path.join(shotPath, 'script.txt');
    if (fs.existsSync(scriptFile)) {
      try { narration = fs.readFileSync(scriptFile, 'utf-8'); } catch { /* ignore */ }
    }

    // Check for a generated still frame image.
    let frameImagePath: string | null = null;
    const imgDir = path.join(shotPath, 'image');
    if (fs.existsSync(imgDir)) {
      const imgs = fs.readdirSync(imgDir).filter((f) => f.endsWith('.png') || f.endsWith('.jpg'));
      if (imgs.length > 0) {
        frameImagePath = path.join(imgDir, imgs[0]!);
      }
    }

    // Stale only when a frame exists AND we know what prompt made it AND it no
    // longer matches — a shot generated before this field existed is never
    // flagged, so existing projects don't suddenly show false warnings.
    const frameStale = !!frameImagePath
      && typeof statusData.generatedPrompt === 'string'
      && statusData.generatedPrompt !== (promptData.prompt || '');

    return {
      shotId,
      order: idx + 1,
      prompt: promptData.prompt || '',
      framing: promptData.framing || (idx === 0 ? 'wide' : 'medium'),
      lens: promptData.lens || '35mm',
      movement: promptData.movement || 'static',
      // Missing legacy timing has a default; invalid saved timing must reach
      // export validation instead of silently becoming a different duration.
      durationSec: promptData.durationSec === undefined ? 5 : promptData.durationSec,
      narration,
      status: statusData.status || ShotStatus.PLANNED,
      frameImagePath,
      frameStale,
    };
  });

  return { ...sceneMeta, sceneId, shots };
}

/** The editor and complete-project export use the same persisted scene order. */
export function assembleStoryboardScenes(projectDir: string): AssembledScene[] {
  const scenesDir = path.join(projectDir, 'scenes');
  if (!fs.existsSync(scenesDir)) return [];
  return fs.readdirSync(scenesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => assembleScene(projectDir, entry.name)!)
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.order) ? a.order! : 0;
      const bOrder = Number.isFinite(b.order) ? b.order! : 0;
      return aOrder - bOrder || a.sceneId.localeCompare(b.sceneId, undefined, { numeric: true });
    });
}

/** Convenience for callers that only need one scene's shots (the renderer). */
export function assembleShotsForScene(projectDir: string, sceneId: string): AssembledShot[] {
  return assembleScene(projectDir, sceneId)?.shots ?? [];
}
