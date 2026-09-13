import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { launchFocusedStudioApp as launchElectronApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';

for (const audioDuration of [3, 3.49]) {
test(`ordinary job format control preserves ${audioDuration}s audio through real single-image encoding`, async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_STUDIO_EXPORT_LIVE !== '1', 'Requires installed FFmpeg; synthetic local audio and image only.');
  test.setTimeout(180_000);
  const ffmpeg = process.env.HOMEBOT_FFMPEG!;
  expect(ffmpeg).toBeTruthy();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-job-format-proof-'));
  const image = path.join(profile, 'image.png');
  const audio = path.join(profile, 'audio.wav');
  const captions = path.join(profile, 'captions.srt');
  const portraitCaptions = audioDuration === 3.49;
  const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout: 60_000 });
  run(['-y', '-f', 'lavfi', '-i', 'color=c=0x164E80:s=640x480:d=1,drawbox=x=270:y=190:w=100:h=100:color=white:t=fill', '-frames:v', '1', image]);
  run(['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${audioDuration}`, '-ar', '48000', audio]);
  fs.writeFileSync(captions, `1\n00:00:00,000 --> 00:00:03,490\nPortrait caption proof\n`);
  // Legacy job fixture: no saved output spec. The real visible control must
  // turn this short portrait job into landscape without changing its duration.
  fs.writeFileSync(path.join(profile, 'media-jobs.json'), JSON.stringify([{
    id: 'job-format-proof', title: 'Job format proof', format: 'short', state: 'media_production',
    narrationPath: audio, ...(portraitCaptions ? { captionsPath: captions } : {}), burnSubtitles: false, durationSeconds: Math.round(audioDuration),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
  }]));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_FFMPEG: ffmpeg }, profile);
  try {
    await waitForAppReady(page);
    expect(await dismissFirstRun(page)).toBe(true);
    await page.evaluate(() => window.electron.saveSettings({ useCustomLLM: false, mediaMusicEnabled: false, permissions: { media_set_output: true, media_render: true } }));
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    const shape = page.getByLabel('Job format proof picture shape', { exact: true });
    await expect(shape).toHaveValue('9:16');
    await shape.selectOption('16:9');
    const read = () => JSON.parse(fs.readFileSync(path.join(profile, 'media-jobs.json'), 'utf8'))[0];
    await expect.poll(() => read().outputSpec?.variants[0].aspectRatio).toBe('16:9');
    if (portraitCaptions) {
      await expect(shape).toBeEnabled();
      await shape.selectOption('9:16');
      await expect.poll(() => read().outputSpec?.variants[0].aspectRatio).toBe('9:16');
    }
    const resolution = page.getByLabel('Job format proof resolution', { exact: true });
    await expect(resolution).toBeEnabled();
    await resolution.selectOption('720p');
    await expect.poll(() => Math.min(read().outputSpec?.variants[0].width, read().outputSpec?.variants[0].height)).toBe(720);
    const framing = page.getByLabel('Job format proof image framing', { exact: true });
    await expect(framing).toBeEnabled();
    await framing.selectOption('fit');
    await expect.poll(() => read().outputSpec?.variants[0].framing.mode).toBe('fit');
    if (portraitCaptions) {
      const choice = page.getByRole('checkbox', { name: 'Burn captions into Job format proof' });
      await expect(choice).toBeEnabled();
      await choice.click();
      await expect.poll(() => read().burnSubtitles).toBe(true);
    }
    expect(read().format).toBe('short');
    // Actual production IPC accepts the owner's existing image (the chat tool's
    // image option); do not invoke any provider to create test assets.
    const result = await page.evaluate(imagePath => window.electron.mediaRun!('job-format-proof', 'render', { image: imagePath }), image);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const job = read();
    expect(job.state).toBe('render_qa');
    expect(job.renderedOutput.outputSpec).toEqual(job.outputSpec);
    expect(job.renderPath).toContain(portraitCaptions ? 'video-portrait-' : 'video-landscape-');
    const ffprobe = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', job.renderPath], { windowsHide: true }).toString());
    expect(info.streams.find((stream: any) => stream.codec_type === 'video')).toMatchObject({ width: portraitCaptions ? 720 : 1280, height: portraitCaptions ? 1280 : 720, r_frame_rate: '30/1', sample_aspect_ratio: '1:1' });
    expect(Math.abs(Number(info.format.duration) - audioDuration)).toBeLessThan(0.15);
    expect(Number(info.streams.find((stream: any) => stream.codec_type === 'audio').duration)).toBeGreaterThanOrEqual(audioDuration - 0.015);
    expect(JSON.parse(fs.readFileSync(`${job.renderPath}.json`, 'utf8'))).toEqual(job.renderedOutput);
    if (portraitCaptions) {
      const captionPixels = execFileSync(ffmpeg, ['-v', 'error', '-ss', '1', '-i', job.renderPath, '-vf', 'crop=720:350:0:900', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
      let white = 0, edgeWhite = 0;
      for (let p = 0; p < captionPixels.length; p += 3) if (captionPixels[p] > 220 && captionPixels[p + 1] > 220 && captionPixels[p + 2] > 220) {
        white++;
        const x = (p / 3) % 720;
        if (x < 20 || x > 699) edgeWhite++;
      }
      expect(white).toBeGreaterThan(100);
      expect(edgeWhite).toBe(0);
      run(['-y', '-ss', '1', '-i', job.renderPath, '-frames:v', '1', testInfo.outputPath('portrait-captions.png')]);
    }
    const events = fs.readFileSync(path.join(profile, 'logs', 'telemetry-events.log'), 'utf8');
    expect(events).toContain('"tool":"media_set_output","outcome":"success"');
    expect(events).toContain('"tool":"media_render","outcome":"success"');
    await page.screenshot({ path: testInfo.outputPath('job-format-output.png') });
    fs.writeFileSync(testInfo.outputPath('job-format-evidence.json'), JSON.stringify({ profile, audioDuration, portraitCaptions, job, encoded: info }, null, 2));
  } finally {
    await app.close();
  }
});
}
