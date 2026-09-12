import { createStudioOutputSpec, resolveStudioOutputSpec, type StudioAspectRatio, type StudioOutputSpec } from '../../shared/media-output';
import './StudioOutputSettings.css';

interface Props {
  label: string;
  value: unknown;
  durationIntent?: 'short' | 'long';
  legacyRatio?: StudioAspectRatio;
  disabled?: boolean;
  saveHint: string;
  previewUrl?: string;
  onChange: (spec: StudioOutputSpec) => void;
}

/** Controlled by the actual job/project; no second copy of persisted settings. */
export function StudioOutputSettings({ label, value, durationIntent = 'short', legacyRatio, disabled, saveHint, previewUrl, onChange }: Props) {
  let spec: StudioOutputSpec;
  let error: string | undefined;
  try {
    spec = resolveStudioOutputSpec(value, durationIntent, legacyRatio);
  } catch (e) {
    error = e instanceof Error ? e.message : 'These output settings cannot be used.';
    spec = createStudioOutputSpec('16:9', durationIntent);
  }
  const variant = spec.variants[0];
  const resolution = Math.min(variant.width, variant.height) === 720 ? '720p' : '1080p';
  const changePreset = (ratio = variant.aspectRatio, size: '720p' | '1080p' = resolution, mode = variant.framing.mode) => {
    const next = createStudioOutputSpec(ratio, spec.durationIntent, size, mode);
    next.variants[0].framing = { ...variant.framing, mode };
    onChange(next);
  };

  return <fieldset className="ms-output-settings" disabled={disabled} aria-label={`${label} output settings`}>
    <legend>Output format</legend>
    {error ? <div role="alert">{error} <button type="button" className="ms-btn" onClick={() => onChange(spec)}>Use landscape defaults</button></div> : <>
      <div className="ms-output-settings-fields">
        <label>Picture shape
          <select className="ms-select" aria-label={`${label} picture shape`} value={variant.aspectRatio} onChange={e => changePreset(e.target.value as StudioAspectRatio)}>
            <option value="16:9">Landscape · 16:9</option>
            <option value="9:16">Portrait · 9:16</option>
            <option value="1:1">Square · 1:1</option>
          </select>
        </label>
        <label>Resolution
          <select className="ms-select" aria-label={`${label} resolution`} value={resolution} onChange={e => changePreset(variant.aspectRatio, e.target.value as '720p' | '1080p')}>
            <option value="720p">720p · smaller file</option>
            <option value="1080p">1080p · more detail</option>
          </select>
        </label>
        <label>Image framing
          <select className="ms-select" aria-label={`${label} image framing`} value={variant.framing.mode} onChange={e => changePreset(variant.aspectRatio, resolution, e.target.value as 'fit' | 'crop')}>
            <option value="fit">Fit entire image · black bars if needed</option>
            <option value="crop">Crop to fill · trims image edges</option>
          </select>
        </label>
        {variant.framing.mode === 'crop' && (['x', 'y'] as const).map(axis => <label key={axis}>
          {axis === 'x' ? 'Crop left ↔ right' : 'Crop top ↔ bottom'}
          <input aria-label={`${label} crop ${axis === 'x' ? 'horizontal' : 'vertical'} position`} type="range" min="0" max="1" step="0.05" value={variant.framing[axis]}
            onChange={e => onChange({ ...spec, variants: [{ ...variant, framing: { ...variant.framing, [axis]: Number(e.target.value) } }] })} />
        </label>)}
      </div>
      <p>{variant.width} × {variant.height} · {variant.fps} fps · one output file. Shape does not change the content length.</p>
      {value === undefined && legacyRatio && <p>Legacy framing retained until you change an output setting.</p>}
      <p>{saveHint} {variant.framing.mode === 'fit' ? 'Fit keeps the whole image and disables camera zoom.' : 'Crop applies to every shot; check faces and text before rendering.'}</p>
      {previewUrl && <figure className="ms-output-frame-preview">
        <div style={{ aspectRatio: `${variant.width}/${variant.height}`, width: Math.min(300, 240 * variant.width / variant.height), maxWidth: '100%' }}>
          <img src={previewUrl} alt="First shot with the selected output framing" style={{ objectFit: variant.framing.mode === 'fit' ? 'contain' : 'cover', objectPosition: `${variant.framing.x * 100}% ${variant.framing.y * 100}%` }} />
          <span className="ms-output-safe-guide" aria-hidden="true" />
        </div>
        <figcaption>First-shot framing preview · dashed inset is a guide only, not added to the video.</figcaption>
      </figure>}
    </>}
  </fieldset>;
}
