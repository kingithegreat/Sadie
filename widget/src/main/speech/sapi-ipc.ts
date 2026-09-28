import { ipcMain } from 'electron';
import { execFile, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Windows SAPI is local. Cancellation targets the exact child started for this
// renderer, never another process with the same name or another window's mic.
const SCRIPT = `
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()
$dictation = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($dictation)
$recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6)
$recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(4)
$recognizer.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.5)
try {
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(15))
    if ($result -and $result.Text) { Write-Output $result.Text }
    else { Write-Output "" }
} catch { Write-Output "" }
finally { $recognizer.Dispose() }
`;

interface SapiResult { success: boolean; text: string; error?: string; cancelled?: boolean }
interface SapiSession {
  child?: ChildProcess;
  cancelled: boolean;
  finish: (result: SapiResult) => void;
}

export function registerSapiRecognitionIpc(): void {
  const sessions = new Map<number, SapiSession>();
  const cancel = (senderId: number): { success: boolean; error?: string } => {
    const session = sessions.get(senderId);
    if (!session) return { success: true };
    session.cancelled = true;
    try {
      if (session.child && !session.child.kill()) {
        return { success: false, error: 'Could not stop Windows dictation. Please close voice conversation and retry.' };
      }
      session.finish({ success: false, text: '', cancelled: true });
      return { success: true };
    } catch {
      return { success: false, error: 'Could not stop Windows dictation. Please close voice conversation and retry.' };
    }
  };

  ipcMain.handle('homebot:stop-speech-recognition', event => cancel(event.sender.id));
  ipcMain.handle('homebot:start-speech-recognition', event => {
    const senderId = event.sender.id;
    const previous = cancel(senderId);
    if (!previous.success) return { ...previous, text: '' };
    return new Promise<SapiResult>(resolve => {
      const tmpFile = path.join(os.tmpdir(), `homebot-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
      let settled = false;
      const onDestroyed = () => { cancel(senderId); };
      const session: SapiSession = {
        cancelled: false,
        finish: result => {
          if (settled) return;
          settled = true;
          if (sessions.get(senderId) === session) sessions.delete(senderId);
          event.sender.removeListener('destroyed', onDestroyed);
          try { fs.unlinkSync(tmpFile); } catch { /* already removed */ }
          resolve(result);
        },
      };
      sessions.set(senderId, session);
      event.sender.once('destroyed', onDestroyed);
      try {
        fs.writeFileSync(tmpFile, SCRIPT, 'utf8');
        session.child = execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', tmpFile],
          { timeout: 20_000, windowsHide: true }, (error, stdout) => {
            if (session.cancelled) session.finish({ success: false, text: '', cancelled: true });
            else if (error) session.finish({ success: false, error: 'Speech recognition failed: ' + error.message, text: '' });
            else session.finish({ success: true, text: stdout.trim() });
          });
      } catch (error: any) {
        session.finish({ success: false, text: '', error: 'Could not start Windows dictation: ' + error.message });
      }
    });
  });
}
