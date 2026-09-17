/**
 * CodexImageAdapter — frame images through the owner's ChatGPT plan, by way of
 * the signed-in Codex CLI on this PC.
 *
 * Codex has a stable built-in image generation tool (`codex features list`:
 * image_generation, stable, on) that needs a ChatGPT sign-in rather than an API
 * key, uses the plan's Codex limits instead of a per-image charge, and saves
 * its output under $CODEX_HOME/generated_images (Codex's own imagegen skill).
 *
 * Contract with Codex, and why:
 *  - The prompt goes over stdin, never argv. On Windows the CLI is codex.cmd,
 *    which needs a shell; a prompt in argv would be run through it. Only our
 *    own literal flags are on the command line (same rule as streamCodex).
 *  - Default read-only sandbox, --ephemeral, run in an empty folder: the turn
 *    may call the image tool and nothing else useful.
 *  - The image is taken from generated_images by what appeared during this
 *    run, not from anything the agent says it did.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from './types';
import { assertProviderOnlineAccess } from '../utils/provider-network-policy';
import { saveMovieShotImage } from './image-output';

const TIMEOUT_MS = 5 * 60_000;

export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/** The Codex CLI on PATH (or HOMEBOT_CODEX_BIN), or null. */
export function findCodexBin(): string | null {
  const override = process.env.HOMEBOT_CODEX_BIN;
  if (override) return fs.existsSync(override) ? override : null;
  const names = process.platform === 'win32' ? ['codex.cmd', 'codex.exe'] : ['codex'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
    }
  }
  return null;
}

/** Signed in when Codex has stored credentials. Only existence is checked; the file is never read. */
export function codexSignedIn(): boolean {
  return fs.existsSync(path.join(codexHome(), 'auth.json'));
}

export const CODEX_NOT_INSTALLED = 'The Codex CLI is not installed on this PC. Install it with: npm install -g @openai/codex';
export const CODEX_SIGNED_OUT = 'Codex is not signed in. Run "codex login" and choose Sign in with ChatGPT.';

export async function probeCodexImage(_req: GenerationRequest): Promise<GenerationCapability> {
  assertProviderOnlineAccess('ChatGPT plan (Codex)');
  const reason = !findCodexBin() ? CODEX_NOT_INSTALLED : !codexSignedIn() ? CODEX_SIGNED_OUT : null;
  return {
    canGenerate: !reason,
    ...(reason ? { reason } : {}),
    // Uses the plan's included Codex limits; no per-image charge.
    costMicroUsd: 0,
    maxDurationSec: 0,
    maxWidth: 1536,
    maxHeight: 1536,
    imageToVideo: false,
    referenceImages: 'none',
    // No visible watermark; OpenAI attaches C2PA content credentials as metadata.
    watermark: 'provider',
    availability: reason ? 'offline' : 'ready',
    deferred: false,
  };
}

function shapeWords(width: number, height: number): string {
  const r = width / height;
  if (r > 1.2) return `wide landscape (16:9, ${width}x${height})`;
  if (r < 0.83) return `tall portrait (9:16, ${width}x${height})`;
  return `square (1:1, ${width}x${height})`;
}

export function codexImagePrompt(prompt: string, width: number, height: number): string {
  return [
    'Use your built-in image generation tool exactly once to create the image below, then stop.',
    'Do not write, copy or move any files, and do not run shell commands.',
    `Shape: ${shapeWords(width, height)}. No text, captions, logos or watermarks in the image.`,
    `Image: ${prompt.replace(/\s+/g, ' ').trim().slice(0, 4000)}`,
  ].join('\n');
}

/** Plain words for what Codex reported, or null when nothing went wrong. */
export function describeCodexFailure(messages: string[]): string | null {
  const text = messages.join(' ');
  // "...usage limit. Visit https://chatgpt.com/codex/settings/usage ... or try again at Sep 19th, 2026 10:59 PM."
  // The URL has dots, so the time is read from "try again at" to the end of the message.
  const limit = /try again at (.+?)\.?\s*$/i.exec(messages.find(m => /try again at/i.test(m)) ?? '');
  if (/usage limit/i.test(text)) {
    return `Your ChatGPT plan's Codex limit is used up${limit?.[1] ? ` until ${limit[1].trim()}` : ''}. Choose another way to make frames, or wait.`;
  }
  if (/not logged in|login|unauthori[sz]ed|401/i.test(text)) return CODEX_SIGNED_OUT;
  const real = messages.filter(m => !/Skill descriptions were shortened/i.test(m));
  return real.length ? `Codex could not make the image: ${real.join(' ').slice(0, 300)}` : null;
}

function imagesUnder(dir: string): Map<string, number> {
  const found = new Map<string, number>();
  const walk = (d: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && depth < 4) walk(full, depth + 1);
      else if (e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)) {
        try { found.set(full, fs.statSync(full).mtimeMs); } catch { /* vanished */ }
      }
    }
  };
  walk(dir, 0);
  return found;
}

/** Run one Codex turn and return the image it generated. */
export async function generateCodexImage(prompt: string, width: number, height: number): Promise<{ base64: string; file: string }> {
  assertProviderOnlineAccess('ChatGPT plan (Codex)');
  const bin = findCodexBin();
  if (!bin) throw new Error(CODEX_NOT_INSTALLED);
  if (!codexSignedIn()) throw new Error(CODEX_SIGNED_OUT);

  const generatedDir = path.join(codexHome(), 'generated_images');
  const before = imagesUnder(generatedDir);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-codex-image-'));
  const errors: string[] = [];
  let stderrTail = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
      const child = spawn(bin, ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-'], {
        cwd: workDir, windowsHide: true, shell: needsShell,
        // Explicit, so Codex reads the same CODEX_HOME this adapter watches.
        env: { ...process.env },
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Codex did not finish the image within 5 minutes.')); }, TIMEOUT_MS);
      let buffered = '';
      child.stdout?.on('data', chunk => {
        buffered += chunk.toString();
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'error' && evt.message) errors.push(String(evt.message));
            if (evt.type === 'turn.failed' && evt.error?.message) errors.push(String(evt.error.message));
            if (evt.type === 'item.completed' && evt.item?.type === 'error' && evt.item.message) errors.push(String(evt.item.message));
          } catch { /* not a JSON event line */ }
        }
      });
      child.stderr?.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-2000); });
      child.on('error', err => { clearTimeout(timer); reject(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? CODEX_NOT_INSTALLED : `Could not start Codex: ${err.message}`)); });
      child.on('close', () => { clearTimeout(timer); resolve(); });
      child.stdin?.end(codexImagePrompt(prompt, width, height));
    });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const fresh = [...imagesUnder(generatedDir).entries()]
    .filter(([file, mtime]) => !before.has(file) || before.get(file) !== mtime)
    .sort((a, b) => b[1] - a[1]);
  if (fresh.length === 0) {
    const detail = stderrTail.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/failed to load skill|DeprecationWarning/i.test(l)).slice(-2).join(' ');
    throw new Error(describeCodexFailure(errors) ?? `Codex finished without making an image.${detail ? ` ${detail.slice(0, 300)}` : ''}`);
  }
  const file = fresh[0]![0];
  return { base64: fs.readFileSync(file).toString('base64'), file };
}

export async function generateCodexImageShot(req: GenerationRequest): Promise<GenerationResult> {
  try {
    const { base64 } = await generateCodexImage(req.prompt, req.width, req.height);
    const file = saveMovieShotImage(req, base64);
    return { status: 'done', provider: 'codex-image', files: [file], costMicroUsd: 0 };
  } catch (err) {
    return { status: 'failed', provider: 'codex-image', error: (err as Error).message || String(err) };
  }
}

export const codexImageProvider: GenerationProvider = {
  id: 'codex-image',
  kind: 'image',
  probe: probeCodexImage,
  generate: generateCodexImageShot,
};
