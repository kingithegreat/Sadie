import { execFile } from 'child_process';

/** Output-only gate: metadata and sampled frames cannot prove a complete decode. */
export async function validateCompleteMediaDecode(ffmpeg: string, moviePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(ffmpeg, [
      '-hide_banner', '-nostats', '-loglevel', 'error', '-xerror',
      '-i', moviePath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-',
    ], { timeout: 300_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, _stdout, stderr) => {
      if (!error) { resolve(); return; }
      const text = String(stderr || '').split(moviePath).join('<export>').trim();
      const detail = text.length > 1536 ? `${text.slice(0, 768)}\n[diagnostic truncated]\n${text.slice(-768)}` : text;
      const code = typeof error.code === 'string' || typeof error.code === 'number' ? String(error.code).slice(0, 80) : 'decoder stopped';
      const signal = error.signal ? String(error.signal).slice(0, 40) : null;
      const diagnostic = { code, signal, stderr: detail };
      console.warn('[Media decode] Output validation failed', diagnostic);
      reject(Object.assign(new Error('The movie could not be checked completely. Retry the export. Any previous export is unchanged.'), { cause: diagnostic }));
    });
  });
}
