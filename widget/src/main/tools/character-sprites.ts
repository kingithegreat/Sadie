/**
 * character-sprites.ts — Autonomous character model sheet generation,
 * background isolation, slicing, quality gate validation, and manifest generation.
 *
 * Driven directly from HomeBot chat to generate production-quality sprites for
 * Ancient Pathways and Remotion video animation.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import { getSettings } from '../config-manager';
import { apiKeyForProvider } from '../../shared/cloud-llm';
import { resolveAncientPathwaysDir } from '../ancient-pathways';

export const mediaGenerateSpritesDef: ToolDefinition = {
  name: 'media_generate_sprites',
  description:
    'Generate a production-quality 2D character sprite sheet from a character concept, validate ' +
    'it against Ancient Pathways & Remotion quality gates, remove the background to transparent alpha, ' +
    'and slice it into named sprite libraries (turnaround, poses, visemes, and manifest.json).',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short identifier slug for the character (e.g. "cleopatra", "alexander", "caesar").',
      },
      description: {
        type: 'string',
        description:
          'Detailed visual character description: era, culture, clothing, skin, hair, facial features, accessories.',
      },
      style: {
        type: 'string',
        description:
          'Optional style guidelines. Defaults to Ancient Pathways clean 2D animation storybook style with soft cel shading.',
      },
      dryRun: {
        type: 'boolean',
        description: 'If true, validates and formulates prompt without saving to disk.',
      },
    },
    required: ['name', 'description'],
  },
};

/**
 * The sheet ground is chroma, not white, and that is load-bearing.
 *
 * On a white ground the cut cannot be made clean, because the characters
 * CONTAIN white - eyes, teeth, Leila's scarf, the glare on her glasses. The
 * slicer keys background by connectivity to the tile border to protect the
 * scarf, which leaves white sealed inside an armpit or between two legs. An
 * attempt to reach those pockets removed 10,070 px and took Flappy's eye
 * whites from 534 px to 23. See Ancient Pathways docs/RIG_PLAN.md (R1/R4).
 *
 * On magenta the ground is unambiguous: measured 0 residual background pixels
 * with the character's own whites intact to within 2 px.
 */
const SHEET_GROUND_NAME = 'magenta';
const SHEET_GROUND_HEX = '#FF00FF';

/**
 * One style for the whole cast. Leila shipped soft-painterly with no keyline
 * while every guest shipped bold flat cel with a thick outline, and the clash
 * has been on record since 2026-08-30. The guests are the majority, so they
 * set the standard.
 */
const CANONICAL_SHEET_STYLE =
  'Clean 2D animation storybook style, flat cel colour with a bold consistent ' +
  'outline of uniform weight around every figure, minimal gradient shading. ' +
  'Consistent character design, proportions and costume across every single ' +
  'cell. Solid magenta #FF00FF background with nothing else on it - no ' +
  'shadows cast onto the ground, no vignette, no texture, no gradient. Do not ' +
  'put any magenta or pink anywhere on the character, their clothing or their ' +
  'props. No panel borders. No text anywhere except the eight small lowercase ' +
  'panel labels. No watermark, no signature, no numbers, no captions under the ' +
  'figures. No speckles, dots or noise anywhere.';

/**
 * Constructs the strict 8-panel prompt from docs/S2_SHEET_REMAKE_PROMPTS.md.
 * Slicing requires clear whitespace between every figure and the canonical 8 groups.
 */
export function buildCharacterSpritePrompt(description: string, styleOverride?: string): string {
  const style =
    styleOverride?.trim() ||
    CANONICAL_SHEET_STYLE;

  return (
    `A 2D animation character model sheet on a solid ${SHEET_GROUND_NAME} background (${SHEET_GROUND_HEX}), laid out as eight labelled panels in a grid. Each panel is labelled in small lowercase text at its top-left corner. Every cell contains exactly ONE character, fully separated from its neighbours by clear ${SHEET_GROUND_NAME} space, never touching or overlapping another figure.\n\n` +
    'Panel "turnaround": 5 full-body poses of the same character - front, three-quarter front, side, three-quarter back, back.\n' +
    'Panel "pose_a": 5 full-body poses - idle, walking, running, jumping, waving.\n' +
    'Panel "pose_b": 5 full-body poses - pointing, thinking with hand to chin, happy, sitting, reading.\n' +
    'Panel "expression_a": 4 head-and-shoulders busts - neutral, happy, excited, laughing.\n' +
    'Panel "expression_b": 4 head-and-shoulders busts - thinking, surprised, sad, angry.\n' +
    'Panel "head_turn": 5 head-only views - front, three-quarter left, left, three-quarter right, right.\n' +
    'Panel "mouth": 8 tight close-up crops of the LOWER FACE ONLY - the base of the nose, the lips, and the chin. No eyes, no forehead, no hat or headdress in these. The eight mouth shapes, left to right in this exact order (the slicer names cells positionally A E I O U M B L): jaw dropped wide open (A); mouth part open in a flat oval with teeth showing (E); mouth stretched wide and thin with teeth showing (I); lips rounded into an O (O); lips pursed forward into a small tight circle (U); lips pressed firmly closed (M); lips gently closed and relaxed (B); mouth open with the tongue tip touching the upper teeth (L).\n' +
    'Panel "body_mechanics": 6 full-body poses - standing confident with hands on belt, hands clasped, a garment swish mid-turn, looking up, listening attentively, cheerful with both arms raised.\n\n' +
    description.trim() +
    '\n\n' +
    style
  );
}

function httpPostJson(urlStr: string, body: unknown, timeoutMs = 90000): Promise<any> {
  return new Promise((resolve, reject) => {
    const isHttps = urlStr.startsWith('https');
    const lib = isHttps ? https : http;
    const url = new URL(urlStr);
    const payload = JSON.stringify(body);
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve({ _raw: text, statusCode: res.statusCode });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Imagen 3 request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

function httpGetBuffer(urlStr: string, timeoutMs = 60000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const isHttps = urlStr.startsWith('https');
    const lib = isHttps ? https : http;
    const req = lib.get(urlStr, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpGetBuffer(res.headers.location, timeoutMs));
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP GET failed with status ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Image fetch timed out'));
    });
  });
}

/**
 * Generates the sheet via Google AI Studio's Imagen 3 API, or falls back to Pollinations FLUX.
 */
export async function generateSpriteSheetImage(
  prompt: string,
  geminiKey?: string
): Promise<{ buffer: Buffer; source: 'imagen-3' | 'pollinations-flux' }> {
  if (geminiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(
        geminiKey
      )}`;
      const payload = {
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9',
          outputOptions: { mimeType: 'image/png' },
        },
      };
      const res = await httpPostJson(endpoint, payload, 90000);
      const b64 = res?.predictions?.[0]?.bytesBase64Encoded;
      if (b64 && typeof b64 === 'string') {
        return { buffer: Buffer.from(b64, 'base64'), source: 'imagen-3' };
      }
      console.warn('[CharacterSprites] Imagen 3 response missing prediction buffer, falling back to Pollinations:', res?.error || res);
    } catch (err: any) {
      console.warn('[CharacterSprites] Imagen 3 generation error, falling back to Pollinations:', err?.message);
    }
  }

  // Fallback to Pollinations FLUX
  const encoded = encodeURIComponent(prompt);
  const pollUrl = `https://image.pollinations.ai/prompt/${encoded}?width=3072&height=2048&model=flux&nologo=true`;
  const buffer = await httpGetBuffer(pollUrl, 90000);
  return { buffer, source: 'pollinations-flux' };
}

export const mediaGenerateSpritesHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const rawName = typeof args.name === 'string' ? args.name.trim() : '';
  const description = typeof args.description === 'string' ? args.description.trim() : '';
  const style = typeof args.style === 'string' ? args.style.trim() : undefined;
  const dryRun = Boolean(args.dryRun);

  if (!rawName) {
    return { success: false, error: 'A character name or slug is required.' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(rawName)) {
    return { success: false, error: 'Character name must be alphanumeric (letters, numbers, underscores, dashes).' };
  }
  const name = rawName.toLowerCase();

  if (!description) {
    return { success: false, error: 'A visual character description is required.' };
  }

  const prompt = buildCharacterSpritePrompt(description, style);

  if (dryRun) {
    const panels = [
      'turnaround',
      'pose_a',
      'pose_b',
      'expression_a',
      'expression_b',
      'head_turn',
      'mouth',
      'body_mechanics',
    ];
    const data = {
      character: name,
      dryRun: true,
      prompt,
      panels,
      message: `Prompt formulated for ${name}. Ready for generation.`,
    };
    return {
      success: true,
      result: data,
    };
  }

  const settings = getSettings();
  const geminiKey = apiKeyForProvider(settings as any, 'google-ai-studio');

  // 1. Generate master sheet
  let generated: { buffer: Buffer; source: 'imagen-3' | 'pollinations-flux' };
  try {
    generated = await generateSpriteSheetImage(prompt, geminiKey);
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to generate character model sheet: ${err?.message || 'unknown error'}`,
    };
  }

  // 2. Save sheet to disk
  const apDir = resolveAncientPathwaysDir();
  const tempSheetPath = path.join(os.tmpdir(), `sheet-${name}-${Date.now()}.png`);
  fs.writeFileSync(tempSheetPath, generated.buffer);

  if (!apDir) {
    // If Ancient Pathways is not found on machine, return the raw generated sheet
    return {
      success: true,
      result: {
        character: name,
        source: generated.source,
        sheetPath: tempSheetPath,
        sliced: false,
        message: `Model sheet generated successfully (${generated.source}). Ancient Pathways repository was not found locally to execute automated slicing.`,
      },
    };
  }

  // 3. Run Python slicer bridge
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = path.join(apDir, 'scripts', 'slice_character_sprites.py');

  if (!fs.existsSync(scriptPath)) {
    return {
      success: true,
      result: {
        character: name,
        source: generated.source,
        sheetPath: tempSheetPath,
        sliced: false,
        message: `Model sheet generated, but scripts/slice_character_sprites.py was missing from Ancient Pathways.`,
      },
    };
  }

  return new Promise((resolve) => {
    const proc = spawn(
      python,
      ['scripts/slice_character_sprites.py', '--sheet', tempSheetPath, '--character', name],
      { cwd: apDir, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      // Clean up temp sheet
      try {
        fs.unlinkSync(tempSheetPath);
      } catch {
        /* best effort */
      }

      if (code !== 0) {
        resolve({
          success: false,
          error: `Slicer script failed (exit code ${code}): ${stderr || stdout || 'unknown error'}`,
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        if (!parsed.ok) {
          resolve({ success: false, error: parsed.error || 'Slicer reported failure' });
          return;
        }

        const data = {
          character: parsed.character,
          source: generated.source,
          spriteCount: parsed.spriteCount,
          groups: parsed.groups,
          charDir: parsed.charDir,
          manifestPath: parsed.manifestPath,
          warnings: parsed.warnings || [],
          message: `Generated and auto-rigged ${parsed.spriteCount} sprites for "${parsed.character}" across 8 canonical groups. Registered in ${parsed.charDir} ready for Remotion & Ancient Pathways.`,
        };
        resolve({
          success: true,
          result: data,
        });
      } catch (err: any) {
        resolve({
          success: false,
          error: `Could not parse slicer output: ${err?.message}\nOutput: ${stdout}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Could not launch Python slicer: ${err.message}`,
      });
    });
  });
};

export const characterSpriteToolDefs: ToolDefinition[] = [mediaGenerateSpritesDef];
export const characterSpriteToolHandlers: Record<string, ToolHandler> = {
  media_generate_sprites: mediaGenerateSpritesHandler,
};
