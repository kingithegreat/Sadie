import { useCallback, useEffect, useState } from 'react';
import type { MediaCapabilityRegistry } from '../../../shared/media-capability-registry';

function costBadge(cost: 'free' | 'plan-limits' | 'paid'): string {
  if (cost === 'plan-limits') return 'Plan limits';
  return cost === 'paid' ? 'Paid' : 'Free';
}

/** The same account registry used by Storyboard's media pickers, shown whole. */
export default function MediaCapabilitiesSection() {
  const apiAvailable = typeof window.electron?.listMediaCapabilities === 'function';
  const [registry, setRegistry] = useState<MediaCapabilityRegistry | null>(null);
  const [loading, setLoading] = useState(apiAvailable);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron?.listMediaCapabilities?.({ refresh });
      if (!result?.success || !result.registry) throw new Error(result?.error || 'Media account check was unavailable.');
      setRegistry(result.registry);
    } catch (err) {
      setError((err as Error)?.message || 'Media account check was unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (apiAvailable) void load(false); }, [apiAvailable, load]);

  return (
    <section className="setting-group" aria-labelledby="media-capabilities-heading">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h3 id="media-capabilities-heading" style={{ marginBottom: 4 }}>Image &amp; video accounts</h3>
          <small className="setting-hint">Only models listed for each saved account become media choices.</small>
        </div>
        <button type="button" className="button button-secondary" disabled={loading || !apiAvailable} onClick={() => void load(true)}>
          {loading ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {error && <p className="setting-hint error-hint" role="alert">{error}</p>}
      {!loading && !error && registry?.accounts.length === 0 && (
        <p className="setting-hint">No cloud account is connected. Save a provider key or subscription above first.</p>
      )}

      {registry?.accounts.map(account => (
        <article key={account.id} data-testid={`media-account-${account.provider}`} style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--border-color, rgba(255,255,255,.12))', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong>{account.label}</strong>
            <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              {account.status === 'text-only' ? 'Text only' : account.status === 'unverified' ? 'Media unverified' : account.status === 'error' ? 'Needs attention' : `${account.models.length} media ${account.models.length === 1 ? 'model' : 'models'}`}
            </span>
          </div>
          <p className="setting-hint" style={{ margin: '5px 0 0' }}>{account.statusLabel}</p>
          {account.models.length > 0 && (
            <ul aria-label={`${account.label} media models`} style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {account.models.map(model => (
                <li key={model.ref} style={{ marginBottom: 6 }}>
                  <strong>{model.displayName}</strong>{' '}
                  <span>({model.kind} · {costBadge(model.costClass)})</span>
                  <div className="setting-hint">{model.costLabel} {model.watermarkLabel}</div>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
