import React from 'react';

export default function TelemetryConsentModal({ open, onAccept, onDecline, onClose }: {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onClose?: () => void;
}) {
  if (!open) return null;

  return (
    <div data-role="telemetry-consent" className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[560px] max-w-[95vw] rounded-2xl bg-zinc-950 border border-zinc-800 p-4 shadow-lg">
        <h2 className="text-lg font-semibold mb-2">Telemetry Consent</h2>
        <p className="text-sm text-zinc-400 mb-4">Telemetry helps us improve SADIE by collecting anonymized usage statistics. Telemetry is anonymous and disabled by default. No personal or user content will be collected.</p>
        <div className="text-sm space-y-2 mb-4">
          <div>By agreeing, you enable anonymous usage telemetry for diagnostics and feature improvement. You may revoke this consent at any time in Settings.</div>
          <div className="text-zinc-500">Consent version: 1.0</div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800" onClick={() => { onDecline(); onClose?.(); }}>Decline</button>
          <button className="px-3 py-2 rounded-lg bg-indigo-600 text-white" onClick={() => { onAccept(); onClose?.(); }}>I agree</button>
        </div>
      </div>
    </div>
  );
}
