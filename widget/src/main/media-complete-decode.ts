import { execFile } from 'child_process';

/** Output-only gate: metadata and sampled frames cannot prove a complete decode. */
export async function validateCompleteMediaDecode(ffmpeg: string, moviePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(ffmpeg, [
      '-hide_banner', '-nostats', '-loglevel', 'error', '-xerror',
      '-i', moviePath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-',
    ], { timeout: 300_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, _stdout, stderr) => {
      if (!error) { resolve(); return; }
      const text = String(stderr || error.message).trim();
      const detail = text.length > 1536 ? `${text.slice(0, 768)}\n[diagnostic truncated]\n${text.slice(-768)}` : text;
      const code = typeof error.code === 'string' || typeof error.code === 'number' ? String(error.code).slice(0, 80) : 'decoder stopped';
      const signal = error.signal ? `; signal ${String(error.signal).slice(0, 40)}` : '';
      reject(new Error(`The exported movie could not be decoded completely (${code}${signal}). ${detail} Retry the export. Any previous export is unchanged.`));
    });
  });
}
