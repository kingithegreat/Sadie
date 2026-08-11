/**
 * UpdateBanner — tells the user an update exists, and lets them take it.
 *
 * The main process has checked for, downloaded and installed updates since the
 * updater shipped. Nothing in the renderer listened, so a released user was
 * never told and could never upgrade — a whole capability with no surface.
 *
 * Deliberately not a modal. An update is not urgent enough to interrupt what
 * someone is doing, and a modal that steals focus mid-sentence is how update
 * prompts earn their reputation. This sits out of the way and can be dismissed.
 */

import { useCallback, useEffect, useState } from 'react';

type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'failed';

export default function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [version, setVersion] = useState('');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const api = (window as any).electron;

  useEffect(() => {
    const offAvailable = api?.onUpdateAvailable?.((info: { version: string }) => {
      setVersion(info?.version || '');
      setPhase('available');
      setDismissed(false); // a NEW version undoes an earlier dismissal
    });
    const offProgress = api?.onUpdateProgress?.((p: { percent: number }) => {
      setPhase('downloading');
      setPercent(Math.max(0, Math.min(100, Math.round(p?.percent ?? 0))));
    });
    const offDownloaded = api?.onUpdateDownloaded?.(() => setPhase('ready'));

    return () => { offAvailable?.(); offProgress?.(); offDownloaded?.(); };
  }, [api]);

  const download = useCallback(async () => {
    setError(null);
    setPhase('downloading');
    try {
      const res = await api?.downloadUpdate?.();
      // A handler that reports failure must not leave a stuck progress bar.
      if (res && res.success === false) {
        setPhase('failed');
        setError(res.error || 'The download did not start.');
      }
    } catch (e: any) {
      setPhase('failed');
      setError(e?.message || 'The download did not start.');
    }
  }, [api]);

  const install = useCallback(async () => {
    try {
      await api?.installUpdate?.();
    } catch (e: any) {
      setPhase('failed');
      setError(e?.message || 'Could not restart to install.');
    }
  }, [api]);

  if (phase === 'idle' || dismissed) return null;

  return (
    <div className="update-banner" role="status" aria-live="polite">
      {phase === 'available' && (
        <>
          <span className="update-text">
            HomeBot {version || 'update'} is available.
          </span>
          <button className="update-btn primary" onClick={() => void download()}>Download</button>
          <button className="update-btn" onClick={() => setDismissed(true)}>Later</button>
        </>
      )}

      {phase === 'downloading' && (
        <>
          <span className="update-text">Downloading update… {percent}%</span>
          <div className="update-progress" aria-hidden="true">
            <div className="update-progress-fill" style={{ inlineSize: `${percent}%` }} />
          </div>
        </>
      )}

      {phase === 'ready' && (
        <>
          <span className="update-text">Update ready. Restart to finish installing.</span>
          <button className="update-btn primary" onClick={() => void install()}>Restart now</button>
          {/* Not "Later" — the update is downloaded and will apply on the next
              launch anyway, so this only hides the banner. */}
          <button className="update-btn" onClick={() => setDismissed(true)}>On next launch</button>
        </>
      )}

      {phase === 'failed' && (
        <>
          <span className="update-text update-error">{error || 'The update failed.'}</span>
          <button className="update-btn" onClick={() => void download()}>Try again</button>
          <button className="update-btn" onClick={() => setDismissed(true)}>Dismiss</button>
        </>
      )}
    </div>
  );
}
