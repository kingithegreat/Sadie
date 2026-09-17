import { CAPTION_FONTS, resolveCaptionStyle, type CaptionStyle } from '../../shared/caption-style';

interface Props {
  /** Used in every control's accessible name, e.g. "Storyboard caption size". */
  label: string;
  value: unknown;
  disabled?: boolean;
  onChange: (style: CaptionStyle) => void;
}

/**
 * How burned-in captions look. Controlled by the saved project or video; the
 * sample is an on-screen approximation, and the export uses the same values
 * through FFmpeg's caption renderer.
 */
export function CaptionStyleSettings({ label, value, disabled, onChange }: Props) {
  let style: CaptionStyle;
  try { style = resolveCaptionStyle(value); } catch { style = resolveCaptionStyle(undefined); }
  const set = (patch: Partial<CaptionStyle>) => onChange({ ...style, ...patch });
  const sampleSize = style.size === 'small' ? '0.8rem' : style.size === 'large' ? '1.2rem' : '1rem';

  return <fieldset className="ms-output-settings ms-caption-style" disabled={disabled} aria-label={`${label} caption style`}>
    <legend>Caption style</legend>
    <label>Size{' '}
      <select className="ms-select" aria-label={`${label} caption size`} value={style.size}
        onChange={e => set({ size: e.target.value as CaptionStyle['size'] })}>
        <option value="small">Small</option>
        <option value="medium">Medium</option>
        <option value="large">Large</option>
      </select>
    </label>{' '}
    <label>Position{' '}
      <select className="ms-select" aria-label={`${label} caption position`} value={style.position}
        onChange={e => set({ position: e.target.value as CaptionStyle['position'] })}>
        <option value="bottom">Bottom</option>
        <option value="middle">Middle</option>
        <option value="top">Top</option>
      </select>
    </label>{' '}
    <label>Font{' '}
      <select className="ms-select" aria-label={`${label} caption font`} value={style.font}
        onChange={e => set({ font: e.target.value as CaptionStyle['font'] })}>
        {CAPTION_FONTS.map(font => <option key={font} value={font}>{font}</option>)}
      </select>
    </label>{' '}
    <label>Colour{' '}
      <input type="color" aria-label={`${label} caption colour`} value={style.color}
        onChange={e => set({ color: e.target.value })} />
    </label>{' '}
    <label>Background{' '}
      <select className="ms-select" aria-label={`${label} caption background`} value={style.background}
        onChange={e => set({ background: e.target.value as CaptionStyle['background'] })}>
        <option value="outline">Outline around letters</option>
        <option value="box">Dark box behind the line</option>
      </select>
    </label>
    <p className="ms-caption-style-sample" aria-label={`${label} caption sample`} style={{
      fontFamily: `'${style.font}', sans-serif`, fontWeight: 700, fontSize: sampleSize, color: style.color,
      background: style.background === 'box' ? 'rgba(0,0,0,0.75)' : 'transparent',
      textShadow: style.background === 'outline' ? '0 0 2px #000, 0 0 2px #000, 0 0 2px #000' : 'none',
      padding: '2px 6px', display: 'inline-block', margin: '6px 0 0',
    }}>Sample caption</p>
  </fieldset>;
}
