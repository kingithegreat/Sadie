

export default function TelemetryConsentModal({ open, onAccept, onDecline, onClose }: {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onClose?: () => void;
}) {
  if (!open) return null;

  return (
    <div data-role="telemetry-consent" className="hb-modal-overlay">
      <div className="hb-modal-card hb-modal-card-md">
        <h2 className="hb-modal-title">Telemetry Consent</h2>
        <p className="hb-modal-text">
          Telemetry helps us improve HomeBot by collecting anonymized usage statistics.
          Telemetry is anonymous and disabled by default. No personal or user content will be collected.
        </p>
        <div className="hb-modal-consent-detail">
          <div>By agreeing, you enable anonymous usage telemetry for diagnostics and feature improvement. You may revoke this consent at any time in Settings.</div>
          <div className="hb-modal-consent-version">Consent version: 1.0</div>
        </div>

        <div className="hb-modal-actions">
          <button className="hb-modal-btn hb-modal-btn-secondary" onClick={() => { onDecline(); onClose?.(); }}>Decline</button>
          <button className="hb-modal-btn hb-modal-btn-primary" onClick={() => { onAccept(); onClose?.(); }}>I agree</button>
        </div>
      </div>
    </div>
  );
}
