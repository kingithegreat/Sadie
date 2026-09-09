import { useCallback, useEffect, useState } from 'react';
import type { YouTubeConnectionReply, YouTubeConnectionStatus } from '../../shared/youtube-connection';

/** Native connection in the existing Connections front door. Keys never enter React. */
export default function YouTubeConnectionCard() {
  const [status, setStatus] = useState<YouTubeConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const reply = await window.electron?.youtubeConnectionStatus?.();
      if (reply?.ok && reply.status) setStatus(reply.status);
      else { setStatus(null); setError(reply?.error || 'YouTube connection is unavailable. Update HomeBot and enable Production Studio in Modules.'); }
    } catch { setStatus(null); setError('Could not load the saved YouTube connection.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!status?.busy) return;
    const timer = window.setInterval(() => { void load(); }, 1000);
    return () => window.clearInterval(timer);
  }, [status?.busy, load]);

  const act = async (operation: (() => Promise<YouTubeConnectionReply>) | undefined, success?: string) => {
    if (!operation) { setError('This HomeBot version does not support YouTube connections.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const reply = await operation();
      if (reply.status) setStatus(reply.status);
      if (!reply.ok) setError(reply.error || 'The Google connection could not be completed.');
      else if (!reply.cancelled && success) setNotice(success);
    } catch { setError('The Google connection could not be completed. Try again.'); }
    finally { setBusy(false); void load(); }
  };
  const working = busy || !!status?.busy;
  return (
    <section className="cnx-card" aria-label="YouTube connection">
      <div className="cnx-card-head">
        <span className="cnx-name">YouTube</span>
        <span className="cnx-cost cnx-cost-free-key">Google sign-in</span>
        <span className="cnx-expand-hint">{working ? 'Working…' : status?.signedIn ? 'Saved sign-in' : status?.configured ? 'Ready to sign in' : 'Setup needed'}</span>
      </div>
      <p className="cnx-reach">Connect your YouTube account and check its channels. This connection only reads account information; uploading videos is not available here.</p>
      {error && <p className="cnx-notice cnx-notice-error" role="alert">{error}</p>}
      {notice && <p className="cnx-notice" role="status">{notice}</p>}
      {!!status?.channels.length && (
        <ul className="youtube-channels">
          {status.channels.map(channel => <li key={channel.id}>
            <a href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noreferrer">{channel.title}</a>
          </li>)}
        </ul>
      )}
      {status?.signedIn && !status.channels.length && <p className="cnx-reach">Google returned no YouTube channel for this account. You can sign in with a different account.</p>}
      {status?.lastChecked && <p className="cnx-cost-note">Last checked: {new Date(status.lastChecked).toLocaleString()}. Use Check connection to confirm access again.</p>}
      <div className="cnx-form">
        {!status?.configured && <>
          <p className="cnx-form-hint">Choose the Desktop app JSON you downloaded from Google Cloud. HomeBot stores it using this PC&apos;s secure storage. Your Gemini key belongs in model settings.</p>
          <a className="cnx-where" href="https://developers.google.com/youtube/v3/guides/auth/installed-apps" target="_blank" rel="noreferrer">Google setup instructions</a>
          <button type="button" className="button cnx-connect-btn" disabled={working || !status} onClick={() => void act(window.electron?.youtubeImportCredentials, 'Desktop app credentials saved. Next, sign in with Google.')}>Choose Google JSON</button>
        </>}
        {status?.configured && <>
          <p className="cnx-form-hint">Sign-in opens your browser, where you choose an account and review Google&apos;s permission request. Online access must be enabled in Settings.</p>
          <div className="youtube-actions">
            <button type="button" className="button" disabled={working} onClick={() => void act(window.electron?.youtubeConnect, 'Google sign-in and channel check completed.')}>Sign in with Google</button>
            {status.signedIn && <button type="button" className="button" disabled={working} onClick={() => void act(window.electron?.youtubeRefresh, 'YouTube access checked successfully.')}>Check connection</button>}
            <button type="button" className="button" disabled={working} onClick={() => void act(window.electron?.youtubeRemove, 'Saved credentials and sign-in removed from this PC.')}>Remove from HomeBot</button>
          </div>
          <a className="cnx-where" href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Manage or remove permission in your Google account</a>
        </>}
        {working && <button type="button" className="button cnx-connect-btn" onClick={() => void act(window.electron?.youtubeCancel)}>Cancel sign-in</button>}
        {!status && <button type="button" className="button cnx-connect-btn" disabled={busy} onClick={() => { setError(''); void load(); }}>Reload connection status</button>}
      </div>
    </section>
  );
}
