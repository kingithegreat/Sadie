import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaCapabilityRegistry } from '../../shared/media-capability-registry';

interface Props {
  projectId: string;
  value?: string;
  disabled?: boolean;
  onChange: (videoModelRef: string) => void;
}

/**
 * PROV-1's video front door. It saves only a model the connected account
 * actually listed; PROV-4 consumes that saved choice when clip generation is
 * wired. No request that costs money is made here.
 */
export default function StoryboardVideoModelPicker({ projectId, value = '', disabled, onChange }: Props) {
  const [registry, setRegistry] = useState<MediaCapabilityRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron?.listMediaCapabilities?.({ refresh });
      if (!result?.success || !result.registry) throw new Error(result?.error || 'Could not check connected video models.');
      setRegistry(result.registry);
    } catch (err) {
      setError((err as Error)?.message || 'Could not check connected video models.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);
  const models = useMemo(() => registry?.videoModels.filter(model => model.usableIn.includes('shot-video')) ?? [], [registry]);
  const selected = models.find(model => model.ref === value);
  const textOnly = registry?.accounts.filter(account => account.status === 'text-only') ?? [];

  const choose = async (ref: string) => {
    if (!ref) return;
    setSaving(true);
    setError(null);
    try {
      const result = await window.electron?.mediaStoryboardSetVideoModel?.({ projectId, videoModelRef: ref });
      if (!result?.ok || !result.videoModelRef) throw new Error(result?.error || 'Could not save the shot video model.');
      onChange(result.videoModelRef);
    } catch (err) {
      setError((err as Error)?.message || 'Could not save the shot video model.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="ms-output-settings" aria-label="Shot video model" disabled={disabled || saving}>
      <legend>Shot video model</legend>
      <select className="ms-select" aria-label="Video model for generated shots" value={selected?.ref ?? ''} onChange={event => void choose(event.target.value)}>
        <option value="" disabled>{loading ? 'Checking connected accounts…' : models.length ? 'Choose a connected video model…' : 'No connected video model'}</option>
        {models.map(model => (
          <option key={model.ref} value={model.ref}>{model.displayName} · {model.accountLabel} · {model.costClass === 'paid' ? 'paid' : model.costClass}</option>
        ))}
      </select>{' '}
      <button type="button" className="ms-btn" disabled={loading || saving} onClick={() => void load(true)}>Check again</button>
      <p className="ms-frame-provider-status" role="note" aria-label="Shot video model status">
        {error || (selected
          ? `${selected.costLabel} ${selected.watermarkLabel} Saved for this storyboard; generating the clip is the next provider step.`
          : models.length
            ? 'Choose the account model future generated shot clips should use. This does not generate or charge anything.'
            : textOnly.length
              ? `${textOnly.map(account => account.label).join(', ')}: text only. No connected account listed a supported video model.`
              : 'No connected account listed a supported video model. Add or check an account in Settings.')}
      </p>
    </fieldset>
  );
}
