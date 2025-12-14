import React, { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';
import TelemetryConsentModal from './TelemetryConsentModal';

export default function FirstRunModal({
  open,
  settings,
  onSave,
  onClose
}: {
  open: boolean;
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const PERMISSION_DESCRIPTIONS: Record<string, string> = {
    delete_file: 'Allows permanent deletion of files',
    move_file: 'Allows moving files between folders',
    launch_app: 'Allows launching installed applications',
    screenshot: 'Allows capture of screen contents'
  };

  if (!open) return null;

  const handleSubmit = async () => {
    // Mark firstRun as false and persist
    // Telemetry is required for the app; ensure it's recorded on first-run persist
    const payload = { ...draft, firstRun: false, telemetryEnabled: true, telemetryConsentTimestamp: new Date().toISOString() } as any;
    // Persist immediately via the electron bridge to reduce race windows
    try {
      console.log('[E2E] FirstRun saving payload', payload);
      await (window as any).electron.saveSettings?.(payload);
    } catch (e) {
      console.warn('FirstRun immediate save failed:', e);
    }
    onSave(payload);
    onClose();
  };

  const handleSkip = async () => {
    // Mark firstRun false and keep defaults set so we don't show again
    // Even when skipping, ensure telemetry is recorded as required
    const payload = { ...draft, firstRun: false, telemetryEnabled: true, telemetryConsentTimestamp: new Date().toISOString() } as any;
    try {
      console.log('[E2E] FirstRun saving payload (skip)', payload);
      await (window as any).electron.saveSettings?.(payload);
    } catch (e) {
      console.warn('FirstRun immediate save failed (skip):', e);
    }
    onSave(payload);
    onClose();
  };

  return (
    <>
      {/* Semi-transparent overlay - NOT full black */}
      <div className="first-run-overlay">
        <div className="first-run-modal">
          {/* Header */}
          <div className="first-run-header">
            <h1 className="first-run-title">Welcome to SADIE</h1>
            <p className="first-run-subtitle">
              Let's get started — a few initial options to make SADIE safe and private by default.
            </p>
          </div>

          {/* Scrollable content area */}
          <div className="first-run-content">
            {/* Telemetry section */}
            <div className="first-run-section">
              <div className="first-run-label">Telemetry (required)</div>
              <label className="first-run-checkbox">
                <input
                  type="checkbox"
                  checked={true}
                  disabled
                />
                <span className="first-run-checkbox-text">Telemetry is anonymous and required</span>
              </label>
            </div>

            {/* Permissions section - SCROLLABLE */}
            <div className="first-run-section">
              <div className="first-run-label">Permissions</div>
              <small className="first-run-description">
                Enable individual tools SADIE can use. Dangerous operations are disabled by default.
              </small>
              <div className="permissions-container">
                {(Object.keys(draft.permissions || {}) as string[]).map((k) => (
                  <div key={k} className="permission-item">
                    <label className="first-run-checkbox">
                      <input
                        type="checkbox"
                        checked={!!draft.permissions?.[k]}
                        onChange={(e) => setDraft({
                          ...draft,
                          permissions: { ...(draft.permissions || {}), [k]: e.target.checked }
                        })}
                      />
                      <span className="first-run-checkbox-text capitalize">
                        {k.replace(/_/g, ' ')}
                      </span>
                    </label>
                    {PERMISSION_DESCRIPTIONS[k] && (
                      <small className="permission-warning">
                        {PERMISSION_DESCRIPTIONS[k]}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Default team section */}
            <div className="first-run-section">
              <div className="first-run-label">Default NBA team</div>
              <input
                type="text"
                className="first-run-input"
                value={draft.defaultTeam || ''}
                onChange={(e) => setDraft({ ...draft, defaultTeam: e.target.value })}
                placeholder="e.g., Lakers, Celtics, Warriors"
              />
            </div>
          </div>

          {/* Fixed footer with buttons - ALWAYS VISIBLE */}
          <div className="first-run-footer">
            <button
              onClick={handleSkip}
              className="first-run-btn first-run-btn-secondary"
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              className="first-run-btn first-run-btn-primary"
            >
              Finish
            </button>
          </div>
        </div>
      </div>

      {/* Telemetry consent modal */}
      <TelemetryConsentModal
        open={showTelemetryModal}
        onAccept={() => {
          setDraft({ ...draft, telemetryEnabled: true });
          setShowTelemetryModal(false);
        }}
        onDecline={() => {
          setDraft({ ...draft, telemetryEnabled: false });
          setShowTelemetryModal(false);
        }}
        onClose={() => setShowTelemetryModal(false)}
      />
    </>
  );
}
