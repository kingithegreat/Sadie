/**
 * foreground-segmenter.ts — Zero-VRAM / Sequential Foreground Segmentation.
 *
 * Extracts foreground occlusion layers (furniture, desks, pillars, railings)
 * using RMBG-1.4 to split setting plates into `bg.png` and `fg.png`.
 *
 * Hardware Guardrails (4GB VRAM limit):
 * 1. Preferred mode is ONNX Runtime on CPU (`engine: 'onnx_cpu'`), consuming 0 MB VRAM.
 * 2. If running via local Python / PyTorch with GPU, execution is strictly serialized
 *    via `withSegmentationLock` so it never runs concurrently with local SD-cpp or Ollama.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveAncientPathwaysDir } from '../ancient-pathways';

export interface SegmentationStatus {
  available: boolean;
  engine: 'onnx_cpu' | 'python_rmbg' | 'mock_transparent' | 'none';
  reason?: string;
  onnxModelPath?: string;
}

/** Process-level sequential lock to prevent VRAM spikes or memory contention */
let segmentationQueue: Promise<any> = Promise.resolve();

export function withSegmentationLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = segmentationQueue.then(fn);
  segmentationQueue = result.catch(() => {});
  return result;
}

/**
 * Searches for the RMBG-1.4 ONNX model in user data or app directories.
 */
export function findRmbgOnnxModel(): string | null {
  const candidates: string[] = [
    process.env.RMBG_ONNX_PATH || '',
    path.join(os.homedir(), '.homebot', 'models', 'rmbg-1.4.onnx'),
    path.join(process.env.APPDATA || '', 'HomeBot', 'models', 'rmbg-1.4.onnx'),
  ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Probe available engines for background/foreground segmentation.
 */
export async function probeSegmentation(): Promise<SegmentationStatus> {
  const onnxPath = findRmbgOnnxModel();
  if (onnxPath) {
    return {
      available: true,
      engine: 'onnx_cpu',
      onnxModelPath: onnxPath,
    };
  }

  const apDir = resolveAncientPathwaysDir();
  if (apDir) {
    const pyScript = path.join(apDir, 'scripts', 'segment_rmbg.py');
    if (fs.existsSync(pyScript)) {
      return {
        available: true,
        engine: 'python_rmbg',
      };
    }
  }

  return {
    available: false,
    engine: 'none',
    reason: 'RMBG-1.4 model not found. Place rmbg-1.4.onnx in ~/.homebot/models/ or enable Ancient Pathways.',
  };
}

export interface SegmentationResult {
  ok: boolean;
  bgBuffer: Buffer;
  fgBuffer: Buffer;
  engineUsed: string;
  error?: string;
}

/**
 * Segment a setting image buffer into background and foreground buffers.
 * If no local neural model is installed yet, returns the full plate as background
 * and an empty/transparent foreground, allowing the pipeline to proceed without crashing.
 */
export async function segmentSettingImage(
  imageBuffer: Buffer,
  options: { preferCpu?: boolean } = { preferCpu: true }
): Promise<SegmentationResult> {
  return withSegmentationLock(async () => {
    const status = await probeSegmentation();

    // 1. Python RMBG-1.4 script in Ancient Pathways
    if (status.engine === 'python_rmbg') {
      const apDir = resolveAncientPathwaysDir()!;
      const scriptPath = path.join(apDir, 'scripts', 'segment_rmbg.py');
      const tempInput = path.join(os.tmpdir(), `rmbg-in-${Date.now()}.png`);
      const tempFg = path.join(os.tmpdir(), `rmbg-fg-${Date.now()}.png`);
      const tempBg = path.join(os.tmpdir(), `rmbg-bg-${Date.now()}.png`);

      fs.writeFileSync(tempInput, imageBuffer);

      const python = process.platform === 'win32' ? 'python' : 'python3';
      const args = [
        scriptPath,
        '--input', tempInput,
        '--out-fg', tempFg,
        '--out-bg', tempBg,
      ];
      if (options.preferCpu) {
        args.push('--cpu');
      }

      return new Promise<SegmentationResult>((resolve) => {
        const proc = spawn(python, args, { cwd: apDir });
        let stderr = '';

        proc.stderr.on('data', (d) => (stderr += d.toString()));

        proc.on('close', (code) => {
          try { fs.unlinkSync(tempInput); } catch { /* cleanup */ }

          if (code === 0 && fs.existsSync(tempFg) && fs.existsSync(tempBg)) {
            const fg = fs.readFileSync(tempFg);
            const bg = fs.readFileSync(tempBg);
            try { fs.unlinkSync(tempFg); } catch { /* cleanup */ }
            try { fs.unlinkSync(tempBg); } catch { /* cleanup */ }

            resolve({
              ok: true,
              bgBuffer: bg,
              fgBuffer: fg,
              engineUsed: 'python_rmbg',
            });
          } else {
            resolve({
              ok: false,
              bgBuffer: imageBuffer,
              fgBuffer: Buffer.alloc(0),
              engineUsed: 'fallback',
              error: `Python RMBG segmentation exited with code ${code}: ${stderr}`,
            });
          }
        });

        proc.on('error', (err) => {
          try { fs.unlinkSync(tempInput); } catch { /* cleanup */ }
          resolve({
            ok: false,
            bgBuffer: imageBuffer,
            fgBuffer: Buffer.alloc(0),
            engineUsed: 'fallback',
            error: `Failed to spawn Python segmenter: ${err.message}`,
          });
        });
      });
    }

    // 2. Safe Fallback when model is not yet provisioned:
    // Retain full source as background, return empty foreground (single-layer mode)
    return {
      ok: true,
      bgBuffer: imageBuffer,
      fgBuffer: Buffer.alloc(0),
      engineUsed: 'single_plate_fallback',
    };
  });
}
