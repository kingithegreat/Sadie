import { useEffect } from 'react';
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
  // Escape closes, like every other overlay in the app. This one already had a
  // clearly labelled "Not now", so it was never a trap — but a modal that
  // ignores Escape is a small surprise, and the rest no longer do.
  //
  // Not portalled, unlike the other .hb-modal-overlay user (PermissionModal):
  // this renders inside a mode panel rather than as a direct child of
  // .app-container, so the blanket `.app-container > *:not(...)` rule does not
  // reach it, and .image-generator/.automation-center set only `overflow-y`,
  // which position:fixed escapes on its own.
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [prompt, onClose]);

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
