/**
 * Speech-to-text engine, language and microphone.
 *
 * Moved verbatim out of SettingsPanel.tsx; the controls and their bindings are
 * unchanged. State comes from useSettingsCtx().
 */

import { useSettingsCtx } from './SettingsContext';


export default function VoiceHotkeysTab() {
  const {
    localSettings,
    setLocalSettings,
    openSections,
    toggleSection,
    micDevices,
    refreshMicDevices,
  } = useSettingsCtx();

  return (
    <>
        {/* ── Voice (speech-to-text) ── */}
        <button type="button" className={`sp-section-toggle${openSections.voice ? ' open' : ''}`} onClick={() => toggleSection('voice')}>
          <span className="sp-section-arrow">{openSections.voice ? '▾' : '▸'}</span> Voice
        </button>
        {openSections.voice && <>
        <div className="setting-group">
          <label className="setting-label">🎤 Recognition engine</label>
          <select
            aria-label="Voice recognition engine"
            className="setting-input"
            value={localSettings.voiceEngine || 'whisper'}
            onChange={(e) => setLocalSettings({ ...localSettings, voiceEngine: e.target.value as any })}
          >
            <option value="whisper">Whisper (local AI — recommended)</option>
            <option value="sapi">Windows dictation (legacy)</option>
            <option value="webspeech">Web Speech (online)</option>
          </select>
          <small className="setting-hint">
            Whisper runs a local AI model that understands any accent with no training — this is the accurate option.
            Windows dictation is the old engine; if you stay on it, accuracy only improves by training your Windows
            voice profile (Control Panel → Speech Recognition → &quot;Train your computer to better understand you&quot;).
          </small>
        </div>

        {(localSettings.voiceEngine || 'whisper') === 'whisper' && <>
        <div className="setting-group">
          <label className="setting-label">Accuracy vs speed</label>
          <select
            aria-label="Whisper model size"
            className="setting-input"
            value={localSettings.whisperModel || 'base'}
            onChange={(e) => setLocalSettings({ ...localSettings, whisperModel: e.target.value as any })}
          >
            <option value="tiny">Fast (tiny, ~75 MB download)</option>
            <option value="base">Balanced (base, ~145 MB download) — recommended</option>
            <option value="small">Most accurate (small, ~470 MB download)</option>
          </select>
          <small className="setting-hint">
            Bigger models hear you better, especially with background noise or a strong accent. The model downloads
            once on first use and then works fully offline. If it still mishears you, step up one size.
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Language</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.voiceLanguage ?? 'en'}
            onChange={(e) => setLocalSettings({ ...localSettings, voiceLanguage: e.target.value.trim() })}
            placeholder="en"
            maxLength={8}
          />
          <small className="setting-hint">ISO code: en, es, fr, de, mi… Anything other than <code>en</code> switches to the multilingual model.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Stop after silence (seconds)</label>
          <input
            type="number"
            className="setting-input"
            min={1}
            max={10}
            value={localSettings.voiceSilenceStopSec ?? 2}
            onChange={(e) => setLocalSettings({ ...localSettings, voiceSilenceStopSec: Math.max(1, Math.min(10, Number(e.target.value) || 2)) })}
          />
          <small className="setting-hint">How long a pause ends the recording. Raise this if it cuts you off mid-sentence.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Microphone</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              aria-label="Microphone device"
              className="setting-input"
              value={localSettings.voiceMicDeviceId || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, voiceMicDeviceId: e.target.value || undefined })}
            >
              <option value="">System default</option>
              {micDevices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 6)}`}</option>
              ))}
            </select>
            <button type="button" className="sp-btn" onClick={refreshMicDevices}>↻</button>
          </div>
          <small className="setting-hint">
            Wrong or far-away mics are the top cause of bad recognition — pick your headset here. Click ↻ to rescan
            (grants a one-off mic permission to read device names).
          </small>
        </div>
        </>}
        </>}

    </>
  );
}
