import React, { useState } from 'react';
import type { GeneratedEpisodeScript } from '../../shared/types';

/**
 * "Generate episode script" step for the Media Studio Storyboard workspace.
 *
 * The premise goes to main (homebot:media:storyboard:generate-script), which
 * calls the owner's configured OpenAI-compatible provider. This component never
 * sees the API key or the provider URL; it only shows the validated JSON, lets
 * the owner copy/export it, and saves it as a storyboard through main.
 */
export interface MediaStudioEpisodeScriptProps {
  disabled?: boolean;
  onClose: () => void;
  /** Called after a successful save with the new storyboard project id. */
  onSaved: (projectId: string, script: GeneratedEpisodeScript) => void | Promise<void>;
}

export const SAMPLE_EPISODE_PREMISE =
  'A lighthouse keeper on a stormy island finds a message in a bottle from her younger self, warning her not to light the lamp tonight.';

const api = () => (window as any).electron;

export function MediaStudioEpisodeScript({ disabled, onClose, onSaved }: MediaStudioEpisodeScriptProps): React.ReactElement {
  const [premise, setPremise] = useState('');
  const [shotCount, setShotCount] = useState(4);
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [script, setScript] = useState<GeneratedEpisodeScript | null>(null);
  const json = script ? JSON.stringify(script, null, 2) : '';

  const generate = async () => {
    if (!premise.trim()) { setError('Enter a premise for the episode first.'); return; }
    setBusy('generate'); setError(null); setNotice(null); setScript(null);
    try {
      const res = await api()?.mediaStoryboardGenerateScript?.({ premise: premise.trim(), shotCount });
      if (res?.ok && res.script) setScript(res.script);
      else setError(res?.error || 'Could not generate an episode script.');
    } catch (e: any) {
      setError(e?.message || 'Could not generate an episode script.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!script) return;
    setBusy('save'); setError(null); setNotice(null);
    try {
      const res = await api()?.mediaStoryboardSaveScript?.({ script, premise: premise.trim() });
      if (res?.ok && res.projectId) await onSaved(res.projectId, script);
      else setError(res?.error || 'Could not save the episode script as a storyboard.');
    } catch (e: any) {
      setError(e?.message || 'Could not save the episode script as a storyboard.');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setNotice('Episode script JSON copied.');
    } catch {
      setError('Could not copy to the clipboard. Use Export JSON instead.');
    }
  };

  const exportJson = () => {
    if (!script) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${script.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'episode-script'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Episode script JSON exported.');
  };

  return (
    <div className="ms-storyboard-create-box ms-storyboard-director-box" data-testid="episode-script-generator">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '0.96rem', color: '#00f0ff' }}>📝 Generate episode script</h4>
          <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
            Uses the cloud model set in Settings → Models (any OpenAI-compatible provider). The premise leaves this PC; nothing is saved until you choose Load as storyboard.
          </p>
        </div>
        <button type="button" className="ms-shot-icon-btn ms-shot-icon-btn--del" onClick={onClose} aria-label="Close episode script generator">✕</button>
      </div>

      <textarea
        className="ms-input ms-director-textarea"
        rows={3}
        placeholder={`Premise, e.g. "${SAMPLE_EPISODE_PREMISE}"`}
        value={premise}
        onChange={e => setPremise(e.target.value)}
        aria-label="Episode premise"
      />
      <div className="ms-director-controls-row">
        <select className="ms-input ms-director-select" value={shotCount} onChange={e => setShotCount(Number(e.target.value) || 4)} aria-label="Episode shot count">
          {[3, 4, 5, 6, 8].map(n => <option key={n} value={n}>{n} shots</option>)}
        </select>
        <button type="button" className="ms-btn ms-btn--primary" disabled={disabled || busy !== null || !premise.trim()} onClick={generate}>
          {busy === 'generate' ? <><span className="ms-spinner" /> Generating…</> : 'Generate'}
        </button>
      </div>

      {error && <div className="ms-error" role="alert">{error}</div>}
      {notice && <div className="ms-done" role="status">{notice}</div>}

      {script && (
        <div data-testid="episode-script-result">
          <p style={{ margin: '8px 0 4px', fontSize: '0.82rem' }}>
            <strong>{script.title}</strong> · {script.genre} · {script.shots.length} shots · {script.totalDurationSec}s
          </p>
          <ol style={{ margin: '0 0 6px 18px', fontSize: '0.78rem' }}>
            {script.shots.map(s => <li key={s.shotId}>{s.title} — {s.narration}</li>)}
          </ol>
          <textarea className="ms-input" readOnly rows={8} value={json} aria-label="Episode script JSON" style={{ fontFamily: 'monospace', fontSize: '0.72rem' }} />
          <div className="ms-storyboard-create-actions">
            <button type="button" className="ms-btn ms-btn--primary" disabled={disabled || busy !== null} onClick={save}>
              {busy === 'save' ? <><span className="ms-spinner" /> Saving…</> : 'Load as storyboard'}
            </button>
            <button type="button" className="ms-btn" disabled={busy !== null} onClick={copy}>Copy JSON</button>
            <button type="button" className="ms-btn" disabled={busy !== null} onClick={exportJson}>Export JSON</button>
          </div>
        </div>
      )}
    </div>
  );
}
