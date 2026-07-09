import { useEffect, useRef } from 'react';

const TITLE_ID = 'hb-permission-modal-title';
const INTRO_ID = 'hb-permission-modal-intro';
const REASON_ID = 'hb-permission-modal-reason';

export default function PermissionModal({ open, missingPermissions, reason, requestId, onClose }: {
  open: boolean;
  missingPermissions: string[];
  reason?: string;
  requestId?: string;
  onClose: () => void;
}) {
  const active = open && !!requestId;

  const cardRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Accessibility: focus management, focus trap, and Escape-to-cancel.
  // Hooks must run unconditionally (rules-of-hooks) — the effect no-ops when
  // the modal is not active, so nothing happens until it is actually shown.
  useEffect(() => {
    if (!active) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Focus the safest default action (Cancel) so keyboard users start on the
    // least-destructive choice rather than "Always allow".
    cancelBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Escape is treated as an explicit decline — same as Cancel.
        e.preventDefault();
        (window as any).electron.sendPermissionResponse(requestId!, 'cancel');
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const card = cardRef.current;
        if (!card) return;
        const focusables = Array.from(
          card.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus to whatever was focused before the modal opened.
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [active, requestId, onClose]);

  if (!active) return null;

  const allowOnce = () => {
    (window as any).electron.sendPermissionResponse(requestId!, 'allow_once', missingPermissions);
    onClose();
  };

  const alwaysAllow = async () => {
    try {
      const settings = await (window as any).electron.getSettings();
      const perms = settings.permissions || {};
      for (const p of missingPermissions) perms[p] = true;
      await (window as any).electron.saveSettings({ permissions: perms });
    } catch (e) { /* ignore */ }
    (window as any).electron.sendPermissionResponse(requestId!, 'always_allow', missingPermissions);
    onClose();
  };

  const cancel = () => {
    (window as any).electron.sendPermissionResponse(requestId!, 'cancel');
    onClose();
  };

  return (
    <div data-role="permission-modal" className="hb-modal-overlay">
      <div
        ref={cardRef}
        className="hb-modal-card hb-modal-card-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={`${INTRO_ID} ${REASON_ID}`}
      >
        <h2 id={TITLE_ID} className="hb-modal-title">Permission Required</h2>
        <p id={INTRO_ID} className="hb-modal-text">This action requires the following permissions:</p>
        <div className="hb-modal-consent-detail" role="list" aria-label="Requested permissions">
          {missingPermissions.map((p) => (
            <div key={p} className="hb-modal-perm-item" role="listitem">{p.replace(/_/g, ' ')}</div>
          ))}
        </div>
        <div id={REASON_ID} className="hb-modal-muted">{reason || 'This action will modify files on your system.'}</div>
        <p className="hb-modal-muted hb-modal-perm-hint">
          <strong>Allow once</strong> applies only to this action. <strong>Always allow</strong> saves these permissions for future actions until you change them in Settings.
        </p>

        <div className="hb-modal-actions">
          <button ref={cancelBtnRef} type="button" className="hb-modal-btn hb-modal-btn-secondary" onClick={cancel}>Cancel</button>
          <button type="button" className="hb-modal-btn hb-modal-btn-warning" onClick={allowOnce}>Allow once</button>
          <button type="button" className="hb-modal-btn hb-modal-btn-primary" onClick={alwaysAllow}>Always allow</button>
        </div>
      </div>
    </div>
  );
}
