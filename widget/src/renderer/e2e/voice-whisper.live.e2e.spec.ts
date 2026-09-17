import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dismissFirstRun } from './helpers/firstRun';

/**
 * Voice input end to end, in the built app: click the mic, a fake microphone
 * plays a spoken sentence, Whisper transcribes it in the main process, and the
 * words land in the message box. Before this fix the model download was a
 * renderer fetch blocked by the CSP ("Voice error: Failed to fetch").
 *
 * Opt-in (HOMEBOT_VOICE_LIVE=1): downloads whisper-tiny.en (~40 MB) once per
 * profile, and uses Windows speech synthesis to make the spoken fixture.
 */
test.skip(process.env.HOMEBOT_VOICE_LIVE !== '1' || process.platform !== 'win32', 'Opt-in live voice check on Windows.');
test.setTimeout(6 * 60_000);

function spokenWav(dir: string): string {
  const wav = path.join(dir, 'spoken.wav');
  // Speech, then silence so the recorder's silence gate stops on its own.
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    `$s.SetOutputToWaveFile('${wav}', $f)`,
    '$b = New-Object System.Speech.Synthesis.PromptBuilder',
    '$b.AppendText("The quick brown fox jumps over the lazy dog.")',
    '$b.AppendBreak([TimeSpan]::FromSeconds(4))',
    '$s.Speak($b)',
    '$s.Dispose()',
  ].join('; ');
  execFileSync('powershell', ['-NoProfile', '-Command', script]);
  return wav;
}

async function launch(userData: string, wav: string) {
  const env = { ...process.env, HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_E2E_USER_DATA_DIR: userData } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require('electron') as unknown as string,
    args: [
      path.join(__dirname, '../../../out/main/index.js'),
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
    ],
    env,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

function profile(dir: string, online: boolean): string {
  const userData = path.join(dir, online ? 'online' : 'offline');
  fs.mkdirSync(path.join(userData, 'config'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'config', 'user-settings.json'), JSON.stringify({
    voiceEngine: 'whisper', whisperModel: 'tiny', voiceLanguage: 'en', voiceSilenceStopSec: 1, useCustomLLM: online,
  }));
  return userData;
}

test('the mic transcribes spoken words into the message box, and offline without the model says how to get it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-voice-live-'));
  const wav = spokenWav(dir);
  try {
    // Online off, no cached model: a plain instruction, not "Failed to fetch".
    {
      const { app, page } = await launch(profile(dir, false), wav);
      try {
        await dismissFirstRun(page);
        await page.getByRole('button', { name: 'Voice input' }).click();
        await expect(page.getByText(/downloads once\. Turn on Online in Settings/)).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText(/Failed to fetch/)).toHaveCount(0);
      } finally { await app.close(); }
    }
    // Online on: the model downloads into the profile and the words arrive.
    {
      const userData = profile(dir, true);
      const { app, page } = await launch(userData, wav);
      try {
        await dismissFirstRun(page);
        await page.getByRole('button', { name: 'Voice input' }).click();
        await expect(page.getByRole('textbox', { name: 'Message HomeBot' })).toHaveValue(/quick brown fox jumps over the lazy dog/i, { timeout: 5 * 60_000 });
        const cached = fs.readdirSync(path.join(userData, 'models', 'transformers'), { recursive: true }) as string[];
        expect(cached.some(f => /whisper-tiny\.en/.test(String(f)))).toBe(true);
      } finally { await app.close(); }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
