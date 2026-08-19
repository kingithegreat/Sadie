/**
 * Window behaviour, theme, notifications and message density.
 *
 * Moved verbatim out of SettingsPanel.tsx; the controls and their bindings are
 * unchanged. State comes from useSettingsCtx().
 */

import { useSettingsCtx } from './SettingsContext';


export default function GeneralSettingsTab() {
  const {
    localSettings,
    setLocalSettings,
    openSections,
    toggleSection,
  } = useSettingsCtx();

  return (
    <>
        {/* ── General ── */}
        <button type="button" className={`sp-section-toggle${openSections.general ? ' open' : ''}`} onClick={() => toggleSection('general')}>
          <span className="sp-section-arrow">{openSections.general ? '▾' : '▸'}</span> General
        </button>
        {openSections.general && <>
        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={localSettings.alwaysOnTop}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  alwaysOnTop: e.target.checked
                })
              }
            />
            <span>Always on top</span>
          </label>
          <small className="setting-hint">Keep the HomeBot window above all other windows.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">🎨 Theme</label>
          <div className="theme-selector">
            {(['dark', 'light', 'system'] as const).map(t => (
              <button
                key={t}
                className={`theme-btn ${(localSettings as any).theme === t || (!((localSettings as any).theme) && t === 'dark') ? 'active' : ''}`}
                onClick={() => setLocalSettings({ ...localSettings, theme: t } as any)}
                aria-label={`${t} theme`}
              >
                {t === 'dark' ? '🌙' : t === 'light' ? '☀️' : '💻'} {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <small className="setting-hint">Choose a colour scheme. System matches your OS preference.</small>
        </div>

        </>}

        {/* ── Appearance & Notifications ── */}
        <button type="button" className={`sp-section-toggle${openSections.appearance ? ' open' : ''}`} onClick={() => toggleSection('appearance')}>
          <span className="sp-section-arrow">{openSections.appearance ? '▾' : '▸'}</span> Appearance &amp; Notifications
        </button>
        {openSections.appearance && <>
        {/* Google Calendar ICS */}
        <div className="setting-group">
          <label className="setting-label">📅 Google Calendar</label>
          <input
            type="password"
            className="setting-input"
            value={(localSettings as any).calendarIcsUrl || ''}
            onChange={(e) =>
              setLocalSettings({ ...localSettings, calendarIcsUrl: e.target.value } as any)
            }
            placeholder="Paste your secret iCal URL from Google Calendar settings…"
          />
          <small className="setting-hint">
            Google Calendar → Settings → your calendar → "Secret address in iCal format". No sign-in required.
          </small>
        </div>

        {/* Notification Preferences */}
        <div className="setting-group">
          <label className="setting-label">🔔 Notifications</label>
          <label className="setting-label">
            <input
              type="checkbox"
              checked={(localSettings as any).notificationsEnabled !== false}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, notificationsEnabled: e.target.checked } as any)
              }
            />
            <span>Show toast notifications</span>
          </label>
          <label className="setting-label">
            <input
              type="checkbox"
              checked={!!(localSettings as any).notificationSound}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, notificationSound: e.target.checked } as any)
              }
            />
            <span>Play notification sound</span>
          </label>
          <label className="setting-label">Toast duration</label>
          <select
            className="setting-input"
            aria-label="Toast notification duration"
            value={(localSettings as any).notificationDuration ?? 8000}
            onChange={(e) =>
              setLocalSettings({ ...localSettings, notificationDuration: Number(e.target.value) } as any)
            }
          >
            <option value={3000}>Short (3s)</option>
            <option value={5000}>Medium (5s)</option>
            <option value={8000}>Long (8s)</option>
            <option value={15000}>Extra long (15s)</option>
          </select>
          <small className="setting-hint">Controls how long toast notifications stay visible.</small>
        </div>

        {/* Message Density */}
        <div className="setting-group">
          <label className="setting-label">📐 Message Density</label>
          <div className="density-options">
            {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
              <button
                key={d}
                className={`density-btn${(localSettings as any).messageDensity === d ? ' active' : ''}`}
                onClick={() => setLocalSettings({ ...localSettings, messageDensity: d } as any)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
          <small className="setting-hint">Controls spacing between messages in the chat.</small>
        </div>
        </>}

    </>
  );
}
