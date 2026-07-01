import type { UpgradePrompt } from '../../shared/types';

/**
 * Shown whenever a Pro-gated IPC call resolves to a GateBlockedResponse.
 * Reuses the existing `hb-modal-*` styling used by SettingsModal.
 */
export function UpgradeModal({
  prompt,
  onClose,
}: {
  prompt: UpgradePrompt | null;
  onClose: () => void;
}) {
  if (!prompt) return null;

  return (
    <div className="hb-modal-overlay">
      <div className="hb-modal-card hb-modal-card-sm">
        <h2 className="hb-modal-title">⭐ {prompt.title || 'Upgrade to Pro'}</h2>
        <p style={{ opacity: 0.85, lineHeight: 1.5, margin: '4px 0 16px' }}>
          {prompt.message || 'This feature requires HomeBot Pro.'}
        </p>
        <div className="hb-modal-actions">
          <button className="hb-modal-btn hb-modal-btn-secondary" onClick={onClose}>
            Not now
          </button>
          <button
            className="hb-modal-btn hb-modal-btn-primary"
            onClick={() => {
              window.electron?.openExternalUrl?.(prompt.upgradeUrl);
              onClose();
            }}
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}

export default UpgradeModal;
