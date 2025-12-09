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

  if (!open) return null;

  const handleSubmit = () => {
    // Mark firstRun as false and persist
    onSave({ ...draft, firstRun: false });
    onClose();
  };

  const handleSkip = () => {
    // Mark firstRun false and keep defaults set so we don't show again
    onSave({ ...draft, firstRun: false });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[560px] max-w-[95vw] rounded-2xl bg-zinc-950 border border-zinc-800 p-4 shadow-lg">
        <h2 className="text-lg font-semibold mb-2">Welcome to SADIE</h2>
        <p className="text-sm text-zinc-400 mb-4">Let's get started — a few initial options to make SADIE safe and private by default.</p>

        <div className="space-y-3 text-sm mb-4">
          <label className="block">
            <div className="text-zinc-400 mb-1">Telemetry</div>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!draft.telemetryEnabled}
                onChange={(e) => {
                  if (e.target.checked) {
                    setShowTelemetryModal(true);
                  } else {
                    setDraft({ ...draft, telemetryEnabled: false });
                  }
                }}
              />
              <span className="ml-1">Allow anonymous telemetry (opt-in)</span>
            </label>
          </label>
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

          <label className="block"> 
            <div className="text-zinc-400 mb-1">Permissions</div>
            <small className="text-zinc-500 block mb-1">Enable individual tools SADIE can use. Dangerous operations are disabled by default.</small>
            <div className="space-y-2">
              {(Object.keys(draft.permissions || {}) as string[]).map((k) => (
                <label className="inline-flex items-center gap-2" key={k}>
                  <input
                    type="checkbox"
                    checked={!!draft.permissions?.[k]}
                    onChange={(e) => setDraft({ ...draft, permissions: { ...(draft.permissions || {}), [k]: e.target.checked } })}
                  />
                  <span className="capitalize">{k.replace(/_/g, ' ')}</span>
                </label>
              ))}
            </div>
          </label>

          <label className="block">
            <div className="text-zinc-400 mb-1">Default NBA team</div>
            <input
              type="text"
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2"
              value={draft.defaultTeam || ''}
              onChange={(e) => setDraft({ ...draft, defaultTeam: e.target.value })}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={handleSkip} className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">Skip</button>
          <button onClick={handleSubmit} className="px-3 py-2 rounded-lg bg-indigo-600 text-white">Finish</button>
        </div>
      </div>
    </div>
  );
}
